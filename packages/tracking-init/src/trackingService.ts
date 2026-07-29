import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import * as Location from "expo-location";
import Constants from "expo-constants";
import { Linking, PermissionsAndroid, Platform } from "react-native";

import { getOrCreateDeviceId } from "./deviceId.js";
import {
  DEFAULT_DISTANCE_INTERVAL_M,
  DEFAULT_TIME_INTERVAL_MS,
  STORAGE_ACTIVE_SESSION_KEY,
  TRACKING_NOTIFICATION_BODY,
  TRACKING_NOTIFICATION_TITLE,
  TRACKING_TASK_NAME,
} from "./trackingConstants.js";
import { enqueueTrackingPointForActiveSession } from "./queue.js";

export type TrackingStrategy = "BACKGROUND_TASK" | "FOREGROUND_WATCH";

export type TrackingCollectorOptions = {
  timeIntervalMs: number;
  distanceIntervalM: number;
};

export type TrackingPermissionResult =
  | { granted: true; warning?: string }
  | { granted: false; reason: string };

export type ActiveTrackingSession = {
  sessionId: string;
  deviceId: string;
  startedAt: number;
  paused?: boolean;
  strategy?: TrackingStrategy;
  permissionWarning?: string;
  collectorOptions?: TrackingCollectorOptions;
};

let foregroundWatchSubscription: Location.LocationSubscription | null = null;

function isExpoGoAndroid(): boolean {
  return Platform.OS === "android" && Constants.appOwnership === "expo";
}

async function ensureNotificationPermission() {
  if (Platform.OS !== "android") return { granted: true as const };

  const version =
    typeof Platform.Version === "number"
      ? Platform.Version
      : parseInt(String(Platform.Version), 10);

  if (Number.isNaN(version) || version < 33) return { granted: true as const };

  const perm = PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS as any;
  try {
    const already = await PermissionsAndroid.check(perm);
    if (already) return { granted: true as const };

    const res = await PermissionsAndroid.request(perm);
    if (res === PermissionsAndroid.RESULTS.GRANTED) return { granted: true as const };

    return {
      granted: false as const,
      reason: "Notification permission denied (required to show the tracking notification)",
    } satisfies TrackingPermissionResult;
  } catch {
    return {
      granted: false as const,
      reason: "Unable to request notification permission",
    } satisfies TrackingPermissionResult;
  }
}

export async function ensureTrackingPermissions(): Promise<TrackingPermissionResult> {
  const notif = await ensureNotificationPermission();
  if (!notif.granted) return notif;

  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) {
    return {
      granted: false as const,
      reason: "Foreground location permission not granted",
    };
  }

  const gpsOn = await Location.hasServicesEnabledAsync();
  if (!gpsOn) {
    return { granted: false as const, reason: "Location services (GPS) are turned off" };
  }

  // Background permission is required for true background tracking in an APK.
  // In Expo Go (Android) it won't work reliably anyway, so we don't hard-fail there.
  try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (!bg.granted) {
      if (isExpoGoAndroid()) {
        return {
          granted: true as const,
          warning: "Background location not granted. Tracking may work only while app is open.",
        };
      }
      return {
        granted: false as const,
        reason:
          'Background location is required. Please set Location permission to "Allow all the time".',
      };
    }
  } catch {
    if (!isExpoGoAndroid()) {
      return {
        granted: false as const,
        reason:
          'Unable to request background location permission. Please enable "Allow all the time" in Settings.',
      };
    }
  }

  return { granted: true as const };
}

export async function getActiveSession(): Promise<ActiveTrackingSession | null> {
  const raw = await AsyncStorage.getItem(STORAGE_ACTIVE_SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveTrackingSession;
  } catch {
    return null;
  }
}

async function saveActiveSession(state: ActiveTrackingSession) {
  await AsyncStorage.setItem(STORAGE_ACTIVE_SESSION_KEY, JSON.stringify(state));
}

export async function clearActiveSession() {
  await AsyncStorage.removeItem(STORAGE_ACTIVE_SESSION_KEY).catch(() => null);
}

async function startForegroundWatch(timeIntervalMs: number, distanceIntervalM: number) {
  if (foregroundWatchSubscription) return;

  foregroundWatchSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: timeIntervalMs,
      distanceInterval: distanceIntervalM,
    },
    async (location: Location.LocationObject) => {
      await enqueueTrackingPointForActiveSession(location).catch(() => null);
    },
  );
}

async function stopForegroundWatch() {
  if (!foregroundWatchSubscription) return;
  foregroundWatchSubscription.remove();
  foregroundWatchSubscription = null;
}

async function stopBackgroundTask() {
  const isStarted = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK_NAME).catch(() => false);
  if (isStarted) {
    await Location.stopLocationUpdatesAsync(TRACKING_TASK_NAME).catch(() => null);
  }
}

async function startBackgroundTask(timeIntervalMs: number, distanceIntervalM: number) {
  const isStarted = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK_NAME).catch(() => false);
  if (isStarted) return;

  await Location.startLocationUpdatesAsync(TRACKING_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    timeInterval: timeIntervalMs,
    distanceInterval: distanceIntervalM,
    deferredUpdatesInterval: Math.max(30_000, timeIntervalMs),
    deferredUpdatesDistance: distanceIntervalM,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: TRACKING_NOTIFICATION_TITLE,
      notificationBody: TRACKING_NOTIFICATION_BODY,
    },
  });
}

export async function startTracking(params?: {
  sessionId?: string;
  timeIntervalMs?: number;
  distanceIntervalM?: number;
}) {
  // Request deviceId first (requested by product requirement)
  const deviceId = await getOrCreateDeviceId();

  const perm = await ensureTrackingPermissions();
  if (!perm.granted) throw new Error(perm.reason);

  const existing = await getActiveSession();
  const sessionId = params?.sessionId || existing?.sessionId || `sess_${Date.now()}`;
  const timeIntervalMs =
    params?.timeIntervalMs ?? existing?.collectorOptions?.timeIntervalMs ?? DEFAULT_TIME_INTERVAL_MS;
  const distanceIntervalM =
    params?.distanceIntervalM ??
    existing?.collectorOptions?.distanceIntervalM ??
    DEFAULT_DISTANCE_INTERVAL_M;

  const strategy: TrackingStrategy = isExpoGoAndroid() ? "FOREGROUND_WATCH" : "BACKGROUND_TASK";

  if (existing && !existing.paused) {
    const serviceRunning =
      strategy === "FOREGROUND_WATCH"
        ? foregroundWatchSubscription !== null
        : await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK_NAME).catch(() => false);
    if (serviceRunning) return existing;
  }

  const active: ActiveTrackingSession = {
    sessionId,
    deviceId,
    startedAt: existing?.startedAt ?? Date.now(),
    paused: false,
    strategy,
    permissionWarning: perm.warning,
    collectorOptions: { timeIntervalMs, distanceIntervalM },
  };

  await saveActiveSession(active);

  // Start collectors.
  // - Expo Go Android: background task delivery is not reliable, so we use a foreground watcher.
  // - Dev Build / Production: background task delivery works and uses an Android Foreground Service notification.
  if (strategy === "FOREGROUND_WATCH") {
    await startForegroundWatch(timeIntervalMs, distanceIntervalM);
  } else {
    await startBackgroundTask(timeIntervalMs, distanceIntervalM);
    // Also keep a foreground watcher while the app is open (helps reduce "first fix" latency).
    await startForegroundWatch(timeIntervalMs, distanceIntervalM).catch(() => null);
  }

  // Best-effort: if online, open settings deep link isn't needed. If offline, points will queue.
  const net = await NetInfo.fetch().catch(() => null);
  if (net && (net.isConnected === false || net.isInternetReachable === false)) {
    // No-op; queue will be used automatically.
  }

  return active;
}

export async function pauseTracking() {
  const active = await getActiveSession();
  if (!active) return;

  await stopForegroundWatch();
  await stopBackgroundTask();
  active.paused = true;
  await saveActiveSession(active);
  return active;
}

export async function resumeTracking(params?: { timeIntervalMs?: number; distanceIntervalM?: number }) {
  const active = await getActiveSession();
  if (!active) throw new Error("No active session to resume");

  const perm = await ensureTrackingPermissions();
  if (!perm.granted) throw new Error(perm.reason);

  const timeIntervalMs =
    params?.timeIntervalMs ?? active.collectorOptions?.timeIntervalMs ?? DEFAULT_TIME_INTERVAL_MS;
  const distanceIntervalM =
    params?.distanceIntervalM ??
    active.collectorOptions?.distanceIntervalM ??
    DEFAULT_DISTANCE_INTERVAL_M;

  active.paused = false;
  active.strategy = isExpoGoAndroid() ? "FOREGROUND_WATCH" : "BACKGROUND_TASK";
  active.collectorOptions = { timeIntervalMs, distanceIntervalM };
  await saveActiveSession(active);

  if (active.strategy === "FOREGROUND_WATCH") {
    await startForegroundWatch(timeIntervalMs, distanceIntervalM);
  } else {
    await startBackgroundTask(timeIntervalMs, distanceIntervalM);
    await startForegroundWatch(timeIntervalMs, distanceIntervalM).catch(() => null);
  }

  return active;
}

export async function stopTracking() {
  await stopForegroundWatch();
  await stopBackgroundTask();
  await clearActiveSession();
}

export async function openAppSettings() {
  await Linking.openSettings().catch(() => null);
}
