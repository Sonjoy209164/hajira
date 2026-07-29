import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";

import {
  STORAGE_LAST_BG_DELIVERY_AT_KEY,
  STORAGE_LAST_POINT_QUEUED_AT_KEY,
  TRACKING_TASK_NAME,
} from "./trackingConstants.js";
import {
  getActiveSession,
  startTracking,
  stopTracking,
  type ActiveTrackingSession,
} from "./trackingService.js";

export type TrackingHealthReason =
  | "NO_ACTIVE_SESSION"
  | "PAUSED"
  | "SERVICE_STOPPED"
  | "NO_DELIVERY"
  | "STALE"
  | "HEALTHY";

export type TrackingHealth = {
  healthy: boolean;
  reason: TrackingHealthReason;
  checkedAt: number;
  session: ActiveTrackingSession | null;
  serviceRunning: boolean;
  lastBackgroundDeliveryAt: number | null;
  lastPointQueuedAt: number | null;
  staleAfterMs: number;
};

async function readTimestamp(key: string): Promise<number | null> {
  const raw = await AsyncStorage.getItem(key).catch(() => null);
  const value = raw == null ? NaN : Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

export async function getTrackingHealth(options?: {
  staleAfterMs?: number;
}): Promise<TrackingHealth> {
  const checkedAt = Date.now();
  const staleAfterMs = Math.max(1_000, options?.staleAfterMs ?? 5 * 60_000);
  const session = await getActiveSession().catch(() => null);
  const lastBackgroundDeliveryAt = await readTimestamp(STORAGE_LAST_BG_DELIVERY_AT_KEY);
  const lastPointQueuedAt = await readTimestamp(STORAGE_LAST_POINT_QUEUED_AT_KEY);

  if (!session) {
    return {
      healthy: false,
      reason: "NO_ACTIVE_SESSION",
      checkedAt,
      session,
      serviceRunning: false,
      lastBackgroundDeliveryAt,
      lastPointQueuedAt,
      staleAfterMs,
    };
  }
  if (session.paused) {
    return {
      healthy: true,
      reason: "PAUSED",
      checkedAt,
      session,
      serviceRunning: false,
      lastBackgroundDeliveryAt,
      lastPointQueuedAt,
      staleAfterMs,
    };
  }

  const serviceRunning =
    session.strategy === "FOREGROUND_WATCH"
      ? true // Expo does not expose foreground watch subscription state across modules.
      : await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK_NAME).catch(() => false);
  const freshestAt = Math.max(lastBackgroundDeliveryAt ?? 0, lastPointQueuedAt ?? 0) || null;
  const reason: TrackingHealthReason = !serviceRunning
    ? "SERVICE_STOPPED"
    : freshestAt == null
      ? "NO_DELIVERY"
      : checkedAt - freshestAt >= staleAfterMs
        ? "STALE"
        : "HEALTHY";

  return {
    healthy: reason === "HEALTHY",
    reason,
    checkedAt,
    session,
    serviceRunning,
    lastBackgroundDeliveryAt,
    lastPointQueuedAt,
    staleAfterMs,
  };
}

export async function recoverTracking(options?: {
  staleAfterMs?: number;
  restartWhenStale?: boolean;
}): Promise<{ restarted: boolean; before: TrackingHealth; after: TrackingHealth }> {
  const before = await getTrackingHealth(options);
  const restartable =
    before.session != null &&
    !before.session.paused &&
    (before.reason === "SERVICE_STOPPED" ||
      (options?.restartWhenStale === true &&
        (before.reason === "STALE" || before.reason === "NO_DELIVERY")));

  if (!restartable) return { restarted: false, before, after: before };

  const session = before.session!;
  await stopTracking();
  await startTracking({
    sessionId: session.sessionId,
    timeIntervalMs: session.collectorOptions?.timeIntervalMs,
    distanceIntervalM: session.collectorOptions?.distanceIntervalM,
  });
  return {
    restarted: true,
    before,
    after: await getTrackingHealth(options),
  };
}
