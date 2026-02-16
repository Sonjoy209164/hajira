import AsyncStorage from "@react-native-async-storage/async-storage";
import type { TrackingPointUpload } from "@hajiracm/tracking-core";
import type { LocationObject } from "expo-location";

import { isTrackingInitDebugLoggingEnabled } from "./debug.js";
import { STORAGE_ACTIVE_SESSION_KEY, STORAGE_QUEUE_KEY_PREFIX } from "./trackingConstants.js";

export type QueuedTrackingPoint = TrackingPointUpload & {
  queuedAt: number;
  isMock: boolean;
};

type ActiveSessionState = {
  sessionId: string;
  deviceId: string;
  paused?: boolean;
};

function key(sessionId: string) {
  return `${STORAGE_QUEUE_KEY_PREFIX}${sessionId}`;
}

function fpFromPoint(p: { ts: number; latitude: number; longitude: number; accuracyM?: number | null }) {
  const lat = Math.round(p.latitude * 1e6);
  const lng = Math.round(p.longitude * 1e6);
  const acc = p.accuracyM ?? null;
  return `${p.ts}|${lat}|${lng}|${acc}`;
}

let writeChain: Promise<void> = Promise.resolve();
async function withWriteLock(fn: () => Promise<void>) {
  writeChain = writeChain.then(fn, fn);
  return writeChain;
}

async function getActiveSession(): Promise<ActiveSessionState | null> {
  const raw = await AsyncStorage.getItem(STORAGE_ACTIVE_SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveSessionState;
  } catch {
    return null;
  }
}

export async function enqueueTrackingPoint(params: {
  sessionId: string;
  deviceId: string;
  location: LocationObject;
  maxQueueSize?: number;
}) {
  const coords = params.location?.coords;
  const latitude = Number(coords?.latitude);
  const longitude = Number(coords?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;

  const ts =
    typeof (params.location as any)?.timestamp === "number" ? (params.location as any).timestamp : Date.now();

  const roundedLat = Math.round(latitude * 1e6);
  const roundedLng = Math.round(longitude * 1e6);

  const point: QueuedTrackingPoint = {
    pointId: `${params.deviceId}:${params.sessionId}:${ts}:${roundedLat}:${roundedLng}`,
    ts,
    queuedAt: Date.now(),
    latitude,
    longitude,
    accuracyM: coords?.accuracy ?? null,
    speedMps: coords?.speed ?? null,
    bearingDeg: coords?.heading ?? null,
    isMock: Boolean((params.location as any)?.mocked),
  };

  if (isTrackingInitDebugLoggingEnabled()) {
    console.log("[TRACKING_INIT] point", {
      sessionId: params.sessionId,
      ts: point.ts,
      latitude: point.latitude,
      longitude: point.longitude,
      accuracyM: point.accuracyM ?? null,
      speedMps: point.speedMps ?? null,
      bearingDeg: point.bearingDeg ?? null,
      isMock: point.isMock,
      queuedAt: point.queuedAt,
    });
  }

  const maxQueueSize = Math.max(10, Math.min(Number(params.maxQueueSize ?? 5000), 50_000));

  await withWriteLock(async () => {
    const raw = await AsyncStorage.getItem(key(params.sessionId));
    let list: QueuedTrackingPoint[] = [];
    try {
      list = raw ? (JSON.parse(raw) as QueuedTrackingPoint[]) : [];
    } catch {
      list = [];
    }

    const last = list[list.length - 1];
    if (last && fpFromPoint(last) === fpFromPoint(point)) return;

    list.push(point);
    if (list.length > maxQueueSize) {
      list = list.slice(list.length - maxQueueSize);
    }

    await AsyncStorage.setItem(key(params.sessionId), JSON.stringify(list));
  });
}

export async function enqueueTrackingPointForActiveSession(location: LocationObject, opts?: { maxQueueSize?: number }) {
  const session = await getActiveSession();
  if (!session || session.paused) return;
  await enqueueTrackingPoint({
    sessionId: session.sessionId,
    deviceId: session.deviceId,
    location,
    maxQueueSize: opts?.maxQueueSize,
  });
}

export async function readQueuedTrackingPoints(params: { sessionId: string }): Promise<QueuedTrackingPoint[]> {
  const raw = await AsyncStorage.getItem(key(params.sessionId));
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as QueuedTrackingPoint[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function clearQueuedTrackingPoints(params: { sessionId: string }) {
  await AsyncStorage.removeItem(key(params.sessionId)).catch(() => null);
}

export async function drainQueuedTrackingPoints(params: { sessionId: string; limit?: number }) {
  const limit = params.limit == null ? null : Math.max(1, Math.min(Number(params.limit), 50_000));

  let drained: QueuedTrackingPoint[] = [];
  await withWriteLock(async () => {
    const all = await readQueuedTrackingPoints({ sessionId: params.sessionId });
    if (!all.length) return;

    drained = limit == null ? all : all.slice(0, limit);
    const remaining = limit == null ? [] : all.slice(limit);
    if (!remaining.length) {
      await clearQueuedTrackingPoints({ sessionId: params.sessionId });
    } else {
      await AsyncStorage.setItem(key(params.sessionId), JSON.stringify(remaining));
    }
  });

  return drained;
}
