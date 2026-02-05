import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LocationObject } from "expo-location";
import * as SQLite from "expo-sqlite";

import { logD, logE, logI, logW } from "./logcat.js";
import { STORAGE_ACTIVE_SHIFT_KEY } from "./trackingConstants.js";

export type BreadcrumbPoint = {
  shiftId: string;
  employeeId: string;
  deviceId: string;
  ts: number; // epoch ms
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  speedMps?: number | null;
  bearingDeg?: number | null;
  isMock?: boolean | null;
};

type UploadState = {
  shiftId: string;
  lastAckedLocalId: number;
  consecutiveFailures: number;
  lastAttemptAt: number;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function fpFromPoint(p: {
  ts: number;
  latitude: number;
  longitude: number;
  accuracyM?: number | null;
  speedMps?: number | null;
  bearingDeg?: number | null;
  isMock?: boolean | null;
}) {
  // Use rounded coords so we don't treat tiny float noise as a different point.
  const lat = Math.round(p.latitude * 1e6);
  const lng = Math.round(p.longitude * 1e6);
  const acc = p.accuracyM ?? null;
  const spd = p.speedMps ?? null;
  const brg = p.bearingDeg ?? null;
  const mock = p.isMock ? 1 : 0;
  return `${p.ts}|${lat}|${lng}|${acc}|${spd}|${brg}|${mock}`;
}

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync("tracking.db");
  }
  return dbPromise;
}

async function execAsync(sql: string) {
  const db = await getDb();
  await db.execAsync(sql);
}

async function runAsync(sql: string, params: any[] = []) {
  const db = await getDb();
  const stmt = await db.prepareAsync(sql);
  try {
    return await stmt.executeAsync(params);
  } finally {
    await stmt.finalizeAsync();
  }
}

async function getFirstAsync<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const db = await getDb();
  const stmt = await db.prepareAsync(sql);
  try {
    const res: any = await stmt.executeAsync(params);
    return ((await res.getFirstAsync()) ?? null) as T | null;
  } finally {
    await stmt.finalizeAsync();
  }
}

async function getAllAsync<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const db = await getDb();
  const stmt = await db.prepareAsync(sql);
  try {
    const res: any = await stmt.executeAsync(params);
    return ((await res.getAllAsync()) ?? []) as T[];
  } finally {
    await stmt.finalizeAsync();
  }
}

async function getLastPointForShift(shiftId: string): Promise<{
  ts: number;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  speed_mps: number | null;
  bearing_deg: number | null;
  is_mock: number | null;
} | null> {
  return await getFirstAsync<any>(
    `SELECT ts, latitude, longitude, accuracy_m, speed_mps, bearing_deg, is_mock
     FROM tracking_points
     WHERE shift_id = ?
     ORDER BY local_id DESC
     LIMIT 1;`,
    [shiftId],
  );
}

export async function initTrackingDb() {
  // WAL improves write performance on mobile and reduces "database is locked" risks.
  logI("TRACKING_DB", "initTrackingDb");
  await execAsync("PRAGMA journal_mode = WAL;");

  await execAsync(
    `CREATE TABLE IF NOT EXISTS tracking_upload_state (
      shift_id TEXT PRIMARY KEY NOT NULL,
      last_acked_local_id INTEGER NOT NULL DEFAULT 0,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      last_attempt_at INTEGER NOT NULL DEFAULT 0
    );`,
  );

  await execAsync(
    `CREATE TABLE IF NOT EXISTS tracking_points (
      local_id INTEGER PRIMARY KEY AUTOINCREMENT,
      shift_id TEXT NOT NULL,
      employee_id TEXT NOT NULL,
      device_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy_m REAL,
      speed_mps REAL,
      bearing_deg REAL,
      is_mock INTEGER,
      created_at INTEGER NOT NULL
    );`,
  );

  await execAsync(
    `CREATE INDEX IF NOT EXISTS idx_tracking_points_shift_local
      ON tracking_points (shift_id, local_id);`,
  );

  await execAsync(
    `CREATE INDEX IF NOT EXISTS idx_tracking_points_employee_ts
      ON tracking_points (employee_id, ts);`,
  );
}

export async function ensureShiftState(shiftId: string) {
  await runAsync(`INSERT OR IGNORE INTO tracking_upload_state (shift_id) VALUES (?);`, [shiftId]);
}

export async function insertBreadcrumbPoints(points: BreadcrumbPoint[]) {
  if (!points.length) return;

  // Normalize + defensively dedupe: Android/OS sometimes delivers repeated points with same timestamp/coords.
  // We drop exact repeats to avoid server rows with the same ts/location multiple times.
  const normalized = points
    .map((p) => ({
      ...p,
      ts: Number.isFinite(p.ts) ? p.ts : Date.now(),
      latitude: Number(p.latitude),
      longitude: Number(p.longitude),
      accuracyM: p.accuracyM ?? null,
      speedMps: p.speedMps ?? null,
      bearingDeg: p.bearingDeg ?? null,
      isMock: p.isMock ?? null,
    }))
    .filter((p) => p.shiftId && Number.isFinite(p.latitude) && Number.isFinite(p.longitude));

  if (!normalized.length) return;

  const shiftId = normalized[0].shiftId;
  logD("TRACKING_DB", "insertBreadcrumbPoints", { count: normalized.length, shiftId });

  // Compare against the most recently stored point for this shift to avoid cross-batch duplicates.
  let lastFp: string | null = null;
  try {
    const last = await getLastPointForShift(shiftId);
    if (last) {
      lastFp = fpFromPoint({
        ts: Number(last.ts),
        latitude: Number(last.latitude),
        longitude: Number(last.longitude),
        accuracyM: last.accuracy_m,
        speedMps: last.speed_mps,
        bearingDeg: last.bearing_deg,
        isMock: last.is_mock === 1,
      });
    }
  } catch {
    // ignore
  }

  const db = await getDb();
  await db.execAsync("BEGIN");

  const insertSql = `INSERT INTO tracking_points (
    shift_id, employee_id, device_id, ts, latitude, longitude,
    accuracy_m, speed_mps, bearing_deg, is_mock, created_at
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`;

  const stmt = await db.prepareAsync(insertSql);

  try {
    await ensureShiftState(shiftId);

    let prevInsertedFp: string | null = lastFp;
    let inserted = 0;
    const createdAtBase = Date.now();
    let createdAtOffset = 0;

    for (const p of normalized) {
      // Defensive: ignore mixed-shift arrays
      if (p.shiftId !== shiftId) continue;

      const fp = fpFromPoint(p);
      if (fp === prevInsertedFp) {
        logD("TRACKING_DB", "insertBreadcrumbPoints:skipDuplicate", { shiftId, ts: p.ts });
        continue;
      }

      await stmt.executeAsync([
        p.shiftId,
        p.employeeId,
        p.deviceId,
        p.ts,
        p.latitude,
        p.longitude,
        p.accuracyM ?? null,
        p.speedMps ?? null,
        p.bearingDeg ?? null,
        p.isMock ? 1 : 0,
        createdAtBase + createdAtOffset++,
      ]);

      prevInsertedFp = fp;
      inserted++;
    }
    await db.execAsync("COMMIT");
    if (inserted !== normalized.length) {
      logI("TRACKING_DB", "insertBreadcrumbPoints:deduped", {
        shiftId,
        inserted,
        dropped: normalized.length - inserted,
      });
    }
  } catch (e) {
    logE("TRACKING_DB", "insertBreadcrumbPoints: transaction failed", e);
    await db.execAsync("ROLLBACK");
    throw e;
  } finally {
    await stmt.finalizeAsync();
  }
}

export async function getUploadState(shiftId: string): Promise<UploadState> {
  await ensureShiftState(shiftId);

  const row = await getFirstAsync<any>(
    `SELECT
      shift_id as shiftId,
      last_acked_local_id as lastAckedLocalId,
      consecutive_failures as consecutiveFailures,
      last_attempt_at as lastAttemptAt
     FROM tracking_upload_state
     WHERE shift_id = ?
     LIMIT 1;`,
    [shiftId],
  );

  return {
    shiftId,
    lastAckedLocalId: Number(row?.lastAckedLocalId ?? 0),
    consecutiveFailures: Number(row?.consecutiveFailures ?? 0),
    lastAttemptAt: Number(row?.lastAttemptAt ?? 0),
  };
}

export async function setUploadState(shiftId: string, patch: Partial<UploadState>) {
  const current = await getUploadState(shiftId);
  const next: UploadState = { ...current, ...patch, shiftId };

  await runAsync(
    `UPDATE tracking_upload_state
     SET last_acked_local_id = ?, consecutive_failures = ?, last_attempt_at = ?
     WHERE shift_id = ?;`,
    [next.lastAckedLocalId, next.consecutiveFailures, next.lastAttemptAt, shiftId],
  );
}

export async function getPendingBatch(shiftId: string, limit: number) {
  const state = await getUploadState(shiftId);

  const rows = await getAllAsync<any>(
    `SELECT local_id, ts, latitude, longitude, accuracy_m, speed_mps, bearing_deg, is_mock, created_at
     FROM tracking_points
     WHERE shift_id = ? AND local_id > ?
     ORDER BY local_id ASC
     LIMIT ?;`,
    [shiftId, state.lastAckedLocalId, limit],
  );

  logD("TRACKING_DB", "getPendingBatch", {
    shiftId,
    limit,
    lastAckedLocalId: state.lastAckedLocalId,
    rows: rows.length,
  });
  return { lastAckedLocalId: state.lastAckedLocalId, rows };
}

export async function markAckedAndPrune(shiftId: string, ackUpToLocalId: number) {
  const state = await getUploadState(shiftId);
  if (ackUpToLocalId <= state.lastAckedLocalId) return;

  logI("TRACKING_DB", "markAckedAndPrune", { shiftId, from: state.lastAckedLocalId, to: ackUpToLocalId });
  await setUploadState(shiftId, {
    lastAckedLocalId: ackUpToLocalId,
    consecutiveFailures: 0,
    lastAttemptAt: Date.now(),
  });

  await runAsync(`DELETE FROM tracking_points WHERE shift_id = ? AND local_id <= ?;`, [
    shiftId,
    ackUpToLocalId,
  ]);
}

export async function incrementFailure(shiftId: string) {
  const state = await getUploadState(shiftId);
  logW("TRACKING_DB", "incrementFailure", { shiftId, consecutiveFailures: state.consecutiveFailures + 1 });
  await setUploadState(shiftId, {
    consecutiveFailures: state.consecutiveFailures + 1,
    lastAttemptAt: Date.now(),
  });
}

export async function getQueueCount(shiftId: string): Promise<number> {
  const state = await getUploadState(shiftId);

  const row = await getFirstAsync<any>(
    `SELECT COUNT(*) as cnt
     FROM tracking_points
     WHERE shift_id = ? AND local_id > ?;`,
    [shiftId, state.lastAckedLocalId],
  );

  return Number(row?.cnt ?? 0);
}

export async function resetShiftQueue(shiftId: string) {
  await runAsync(`DELETE FROM tracking_points WHERE shift_id = ?;`, [shiftId]);
  await runAsync(`DELETE FROM tracking_upload_state WHERE shift_id = ?;`, [shiftId]);
}

export async function getRecentPointsForShift(
  shiftId: string,
  limit: number = 5000
): Promise<
  {
    ts: number;
    latitude: number;
    longitude: number;
    accuracyM: number | null;
    speedMps: number | null;
  }[]
> {
  const rows = await getAllAsync<any>(
    `SELECT ts, latitude, longitude, accuracy_m, speed_mps
     FROM tracking_points
     WHERE shift_id = ?
     ORDER BY ts ASC
     LIMIT ?;`,
    [shiftId, limit]
  );

  return rows
    .map((r) => ({
      ts: Number(r.ts),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      accuracyM: r.accuracy_m === null || r.accuracy_m === undefined ? null : Number(r.accuracy_m),
      speedMps: r.speed_mps === null || r.speed_mps === undefined ? null : Number(r.speed_mps),
    }))
    .filter(
      (p) =>
        Number.isFinite(p.ts) &&
        Number.isFinite(p.latitude) &&
        Number.isFinite(p.longitude)
    );
}

export async function getPointsForEmployee(params: {
  employeeId: string;
  sinceTs?: number | null;
  limit?: number;
}): Promise<
  {
    ts: number;
    latitude: number;
    longitude: number;
    accuracyM: number | null;
    speedMps: number | null;
  }[]
> {
  const limit = Math.max(1, Math.min(Number(params.limit ?? 20000), 50000));
  const sinceTs = params.sinceTs ?? null;

  const rows =
    sinceTs == null
      ? await getAllAsync<any>(
          `SELECT ts, latitude, longitude, accuracy_m, speed_mps
           FROM tracking_points
           WHERE employee_id = ?
           ORDER BY ts ASC
           LIMIT ?;`,
          [params.employeeId, limit],
        )
      : await getAllAsync<any>(
          `SELECT ts, latitude, longitude, accuracy_m, speed_mps
           FROM tracking_points
           WHERE employee_id = ? AND ts >= ?
           ORDER BY ts ASC
           LIMIT ?;`,
          [params.employeeId, sinceTs, limit],
        );

  return rows
    .map((r) => ({
      ts: Number(r.ts),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      accuracyM:
        r.accuracy_m === null || r.accuracy_m === undefined
          ? null
          : Number(r.accuracy_m),
      speedMps:
        r.speed_mps === null || r.speed_mps === undefined ? null : Number(r.speed_mps),
    }))
    .filter(
      (p) =>
        Number.isFinite(p.ts) &&
        Number.isFinite(p.latitude) &&
        Number.isFinite(p.longitude),
    );
}

type ActiveShiftState = {
  shiftId: string;
  employeeId: string;
  workspaceId: string;
  deviceId: string;
  paused?: boolean;
};

async function loadActiveShift(): Promise<ActiveShiftState | null> {
  const raw = await AsyncStorage.getItem(STORAGE_ACTIVE_SHIFT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveShiftState;
  } catch {
    logW("TRACKING_DB", "loadActiveShift: invalid JSON");
    return null;
  }
}

/**
 * Foreground tracking path (Expo Go Android fallback).
 * trackingService.ts dynamically imports this function, so it must exist for points to be enqueued.
 */
export async function insertPointFromLocation(shiftId: string, location: LocationObject | any) {
  const shift = await loadActiveShift();
  if (!shift || shift.shiftId !== shiftId || shift.paused) return;

  const coords = location?.coords;
  const latitude = Number(coords?.latitude);
  const longitude = Number(coords?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

  logD("TRACKING_DB", "insertPointFromLocation", {
    shiftId,
    ts: location?.timestamp,
    lat: latitude,
    lng: longitude,
    acc: coords?.accuracy,
  });

  const point: BreadcrumbPoint = {
    shiftId,
    employeeId: shift.employeeId,
    deviceId: shift.deviceId,
    ts: typeof location?.timestamp === "number" ? location.timestamp : Date.now(),
    latitude,
    longitude,
    accuracyM: coords?.accuracy ?? null,
    speedMps: coords?.speed ?? null,
    bearingDeg: coords?.heading ?? null,
    isMock: typeof (location as any)?.mocked === "boolean" ? (location as any).mocked : null,
  };

  await insertBreadcrumbPoints([point]);
}
