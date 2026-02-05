import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";

import { logD, logE, logI, logW } from "./logcat.js";
import {
  MOCK_LOCATION_BLOCKED_MESSAGE,
  STORAGE_ACTIVE_SHIFT_KEY,
  STORAGE_LAST_BG_DELIVERY_AT_KEY,
  STORAGE_TRACKING_ISSUE_KEY,
  TRACKING_TASK_NAME,
} from "./trackingConstants.js";
import { initTrackingDb, insertBreadcrumbPoints } from "./trackingDb.js";
import { flushQueuedPoints, pauseShiftTracking } from "./trackingService.js";

type ActiveShiftState = {
  shiftId: string;
  employeeId: string;
  workspaceId: string;
  deviceId: string;
  paused?: boolean;
};

let dbReady = false;
let isFlushing = false;

async function ensureDb() {
  if (dbReady) return;
  await initTrackingDb();
  dbReady = true;
  logI("TRACKING_TASK", "DB ready");
}

async function loadActiveShift(): Promise<ActiveShiftState | null> {
  const raw = await AsyncStorage.getItem(STORAGE_ACTIVE_SHIFT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveShiftState;
  } catch {
    logW("TRACKING_TASK", "loadActiveShift: invalid JSON");
    return null;
  }
}

// IMPORTANT: defineTask must be imported at app startup (e.g., in _layout.tsx)
// so Android can wake up the JS runtime for location updates.
TaskManager.defineTask(TRACKING_TASK_NAME, async ({ data, error }: any) => {
  if (error) {
    console.warn("[TRACKING_TASK] error:", error);
    logE("TRACKING_TASK", "defineTask:error", error);
    return;
  }

  const shift = await loadActiveShift();
  if (!shift) {
    // No active shift; ignore any stray deliveries.
    logD("TRACKING_TASK", "no active shift; ignoring delivery");
    return;
  }

  if (shift.paused) {
    // Shift is paused; ignore updates (service should be stopped anyway).
    logD("TRACKING_TASK", "shift paused; ignoring delivery", shift);
    return;
  }

  const payload = data as any;
  const locations: Location.LocationObject[] = payload?.locations ?? [];
  if (!locations.length) {
    logD("TRACKING_TASK", "no locations in payload");
    return;
  }

  const mockCount = locations.filter((l) => l?.mocked === true).length;
  if (mockCount > 0) {
    logW("TRACKING_TASK", "mock location detected; pausing shift", {
      shiftId: shift.shiftId,
      count: locations.length,
      mockCount,
    });
    await AsyncStorage.setItem(
      STORAGE_TRACKING_ISSUE_KEY,
      JSON.stringify({
        type: "MOCK_LOCATION",
        message: MOCK_LOCATION_BLOCKED_MESSAGE,
        at: Date.now(),
      }),
    ).catch(() => null);
    await pauseShiftTracking().catch(() => null);
    return;
  }

  // Useful for debugging: record that Android actually delivered a background update.
  // If this stops updating while tracking is ON, OS/battery restrictions are likely.
  const deliveredAt = Date.now();
  await AsyncStorage.setItem(STORAGE_LAST_BG_DELIVERY_AT_KEY, String(deliveredAt)).catch(() => null);
  logI("TRACKING_TASK", "background delivery", {
    shiftId: shift.shiftId,
    count: locations.length,
    deliveredAt,
  });

  await ensureDb();

  const points = locations
    .map((l) => ({
      shiftId: shift.shiftId,
      employeeId: shift.employeeId,
      deviceId: shift.deviceId,
      ts: l.timestamp,
      latitude: l.coords.latitude,
      longitude: l.coords.longitude,
      accuracyM: l.coords.accuracy ?? null,
      speedMps: l.coords.speed ?? null,
      bearingDeg: l.coords.heading ?? null,
      isMock: typeof l.mocked === "boolean" ? l.mocked : null,
    }))
    // guard against NaN
    .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude));

  if (points.length) {
    logI("TRACKING_TASK", "enqueue points", {
      shiftId: shift.shiftId,
      count: points.length,
      firstTs: points[0]?.ts,
      lastTs: points[points.length - 1]?.ts,
    });

    await insertBreadcrumbPoints(points);
  }

  // Best-effort flush one batch (avoid concurrent flush loops)
  if (isFlushing) return;
  isFlushing = true;
  try {
    await flushQueuedPoints({ maxBatches: 1 }).catch(() => null);
  } finally {
    isFlushing = false;
  }
});
