import http from "node:http";
import { URL } from "node:url";

import { createSaveQueue, loadStore } from "./store.js";

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "127.0.0.1";
const API_KEY = process.env.JAMAI_API_KEY ? String(process.env.JAMAI_API_KEY) : null;

const DB_PATH = process.env.JAMAI_DB_PATH || new URL("../data/db.json", import.meta.url).pathname;

let store = await loadStore(DB_PATH);
const { queueSave } = createSaveQueue({ filePath: DB_PATH, getState: () => store });

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-CM-API-KEY",
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    ...corsHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readApiKey(req) {
  const raw = req.headers["x-cm-api-key"];
  if (Array.isArray(raw)) return raw[0] ? String(raw[0]) : null;
  return raw ? String(raw) : null;
}

function assertAuth(req, res) {
  if (!API_KEY) return true;
  const provided = readApiKey(req);
  if (provided && provided === API_KEY) return true;
  sendJson(res, 401, { success: false, error: "Unauthorized" });
  return false;
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return null;
  return JSON.parse(raw);
}

function coerceLimit(v, fallback, max) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

function coerceTs(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function makeShiftId() {
  return globalThis.crypto?.randomUUID
    ? globalThis.crypto.randomUUID()
    : `shift_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

const server = http.createServer(async (req, res) => {
  try {
    if (!req.url || !req.method) {
      sendJson(res, 400, { success: false, error: "Bad request" });
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const { pathname } = url;

    if (pathname === "/health") {
      sendJson(res, 200, { ok: true });
      return;
    }

    // Auth for all /tracking routes.
    if (pathname.startsWith("/tracking/")) {
      if (!assertAuth(req, res)) return;
    }

    // POST /tracking/shifts/start
    if (req.method === "POST" && pathname === "/tracking/shifts/start") {
      const body = await readJsonBody(req);
      const employeeId = body?.employeeId ? String(body.employeeId) : "";
      const workspaceId = body?.workspaceId ? String(body.workspaceId) : "";
      const deviceId = body?.deviceId ? String(body.deviceId) : "";
      if (!employeeId || !workspaceId || !deviceId) {
        sendJson(res, 400, { success: false, error: "employeeId, workspaceId, deviceId are required" });
        return;
      }

      const shiftId = makeShiftId();
      const now = Date.now();
      store.shifts.push({
        shiftId,
        employeeId,
        workspaceId,
        deviceId,
        startTime: now,
        endTime: null,
      });
      queueSave();
      sendJson(res, 200, { success: true, shiftId });
      return;
    }

    // POST /tracking/shifts/end
    if (req.method === "POST" && pathname === "/tracking/shifts/end") {
      const body = await readJsonBody(req);
      const shiftId = body?.shiftId ? String(body.shiftId) : "";
      if (!shiftId) {
        sendJson(res, 400, { success: false, error: "shiftId is required" });
        return;
      }
      const shift = store.shifts.find((s) => s.shiftId === shiftId);
      if (!shift) {
        sendJson(res, 404, { success: false, error: "Shift not found" });
        return;
      }
      shift.endTime = Date.now();
      queueSave();
      sendJson(res, 200, { success: true });
      return;
    }

    // POST /tracking/points/batch
    if (req.method === "POST" && pathname === "/tracking/points/batch") {
      const body = await readJsonBody(req);
      const shiftId = body?.shiftId ? String(body.shiftId) : "";
      if (!shiftId) {
        sendJson(res, 400, { success: false, error: "shiftId is required" });
        return;
      }
      const shift = store.shifts.find((s) => s.shiftId === shiftId);
      if (!shift) {
        sendJson(res, 404, { success: false, error: "Shift not found" });
        return;
      }

      const batchEndLocalId =
        typeof body?.batchEndLocalId === "number" ? body.batchEndLocalId : null;
      const points = Array.isArray(body?.points) ? body.points : [];

      const existing = new Set(
        store.points.filter((p) => p.shiftId === shiftId).map((p) => String(p.pointId)),
      );

      let inserted = 0;
      const receivedAt = Date.now();
      for (const p of points) {
        const pointId = p?.pointId ? String(p.pointId) : "";
        const latitude = Number(p?.latitude);
        const longitude = Number(p?.longitude);
        const ts = typeof p?.ts === "number" ? p.ts : null;
        if (!pointId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
        if (existing.has(pointId)) continue;

        store.points.push({
          shiftId,
          employeeId: String(body?.employeeId ?? shift.employeeId),
          workspaceId: String(body?.workspaceId ?? shift.workspaceId),
          deviceId: String(body?.deviceId ?? shift.deviceId),
          pointId,
          ts,
          latitude,
          longitude,
          accuracyM: p?.accuracyM ?? null,
          speedMps: p?.speedMps ?? null,
          bearingDeg: p?.bearingDeg ?? null,
          isMock: p?.isMock ?? null,
          receivedAt,
        });
        existing.add(pointId);
        inserted++;
      }

      queueSave();
      sendJson(res, 200, { success: true, inserted, ackUpToLocalId: batchEndLocalId });
      return;
    }

    // GET /tracking/shifts?employeeId=...&workspaceId=...&fromTs=&toTs=&limit=
    if (req.method === "GET" && pathname === "/tracking/shifts") {
      const employeeId = url.searchParams.get("employeeId")?.trim() ?? "";
      const workspaceId = url.searchParams.get("workspaceId")?.trim() ?? "";
      const fromTs = coerceTs(url.searchParams.get("fromTs"));
      const toTs = coerceTs(url.searchParams.get("toTs"));
      const limit = coerceLimit(url.searchParams.get("limit"), 50, 500);

      if (!employeeId) {
        sendJson(res, 400, { success: false, error: "employeeId is required" });
        return;
      }

      let shifts = store.shifts.filter((s) => String(s.employeeId) === employeeId);
      if (workspaceId) shifts = shifts.filter((s) => String(s.workspaceId) === workspaceId);
      if (fromTs != null) shifts = shifts.filter((s) => Number(s.startTime ?? 0) >= fromTs);
      if (toTs != null) shifts = shifts.filter((s) => Number(s.startTime ?? 0) <= toTs);

      shifts.sort((a, b) => Number(b.startTime ?? 0) - Number(a.startTime ?? 0));
      const out = shifts.slice(0, limit).map((s) => ({
        shiftId: String(s.shiftId),
        employeeId: s.employeeId,
        workspaceId: s.workspaceId,
        deviceId: String(s.deviceId),
        startTime: typeof s.startTime === "number" ? s.startTime : null,
        endTime: typeof s.endTime === "number" ? s.endTime : null,
      }));

      sendJson(res, 200, { success: true, count: out.length, shifts: out });
      return;
    }

    // GET /tracking/shifts/:shiftId/points?fromTs=&toTs=&limit=
    {
      const m = pathname.match(/^\/tracking\/shifts\/([^/]+)\/points$/);
      if (req.method === "GET" && m) {
        const shiftId = decodeURIComponent(m[1]);
        const fromTs = coerceTs(url.searchParams.get("fromTs"));
        const toTs = coerceTs(url.searchParams.get("toTs"));
        const limit = coerceLimit(url.searchParams.get("limit"), 5000, 20000);

        let points = store.points.filter((p) => String(p.shiftId) === shiftId);
        if (fromTs != null) points = points.filter((p) => Number(p.ts ?? 0) >= fromTs);
        if (toTs != null) points = points.filter((p) => Number(p.ts ?? 0) <= toTs);

        points.sort((a, b) => Number(a.ts ?? 0) - Number(b.ts ?? 0));
        points = points.slice(0, limit);

        const out = points.map((p) => ({
          pointId: String(p.pointId),
          ts: typeof p.ts === "number" ? p.ts : null,
          latitude: Number(p.latitude),
          longitude: Number(p.longitude),
          accuracyM: p.accuracyM ?? null,
          speedMps: p.speedMps ?? null,
          bearingDeg: p.bearingDeg ?? null,
          isMock: p.isMock ?? null,
          receivedAt: typeof p.receivedAt === "number" ? p.receivedAt : null,
        }));

        sendJson(res, 200, { success: true, shiftId, count: out.length, points: out });
        return;
      }
    }

    sendJson(res, 404, { success: false, error: "Not found" });
  } catch (e) {
    sendJson(res, 500, { success: false, error: String(e?.message ?? e ?? "Server error") });
  }
});

server.listen(PORT, HOST, () => {
  const hostLabel = HOST === "127.0.0.1" ? "localhost" : HOST;
  console.log(`[jamai-api] listening on http://${hostLabel}:${PORT}`);
  if (API_KEY) console.log(`[jamai-api] auth enabled (X-CM-API-KEY required)`);
  console.log(`[jamai-api] db: ${DB_PATH}`);
});
