import AsyncStorage from "@react-native-async-storage/async-storage";
import NetInfo from "@react-native-community/netinfo";
import * as Location from "expo-location";
import Constants from "expo-constants";
import { Alert, Linking, PermissionsAndroid, Platform } from "react-native";

import { logD, logE, logI, logW } from "./logcat.js";
import {
  DEFAULT_DISTANCE_INTERVAL_M,
  DEFAULT_TIME_INTERVAL_MS,
  DEFAULT_UPLOAD_BATCH_SIZE,
  MOCK_LOCATION_BLOCKED_MESSAGE,
  STORAGE_ACTIVE_SHIFT_KEY,
  STORAGE_BATTERY_PROMPTED_KEY,
  STORAGE_TRACKING_ISSUE_KEY,
  STORAGE_TRACKING_REQUIREMENTS_ACK_KEY,
  TRACKING_NOTIFICATION_BODY,
  TRACKING_NOTIFICATION_TITLE,
  TRACKING_TASK_NAME,
  type TrackingIssue,
} from "./trackingConstants.js";
import {
  ensureShiftState,
  getPendingBatch,
  incrementFailure,
  initTrackingDb,
  markAckedAndPrune,
} from "./trackingDb.js";
import { apiEndShift, apiStartShift, apiUploadBreadcrumbBatch } from "./trackingApi.js";
import { getOrCreateDeviceId } from "./trackingDevice.js";

/**
 * Strategy notes:
 * - Expo Go on Android cannot run background location tasks (TaskManager).
 *   In that case we fall back to foreground watchPositionAsync while the app is open.
 * - In Dev Build / Production, we use startLocationUpdatesAsync with foregroundService notification.
 */
type TrackingStrategy = "BACKGROUND_TASK" | "FOREGROUND_WATCH";

export type ActiveShiftState = {
  shiftId: string;
  employeeId: string;
  workspaceId: string;
  deviceId: string;
  paused?: boolean;
  strategy?: TrackingStrategy;
};

let foregroundWatchSubscription: Location.LocationSubscription | null = null;
let foregroundAutoFlushInProgress = false;
let lastForegroundAutoFlushAt = 0;

export async function getTrackingIssue(): Promise<TrackingIssue | null> {
  const raw = await AsyncStorage.getItem(STORAGE_TRACKING_ISSUE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<TrackingIssue> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.type !== "MOCK_LOCATION") return null;
    if (typeof parsed.message !== "string" || !parsed.message) return null;
    if (typeof parsed.at !== "number") return null;
    return parsed as TrackingIssue;
  } catch {
    return null;
  }
}

async function setTrackingIssue(issue: TrackingIssue) {
  await AsyncStorage.setItem(STORAGE_TRACKING_ISSUE_KEY, JSON.stringify(issue)).catch(() => null);
}

export async function clearTrackingIssue() {
  await AsyncStorage.removeItem(STORAGE_TRACKING_ISSUE_KEY).catch(() => null);
}

async function assertNoMockLocation(source: string) {
  // Expo only exposes `mocked` on Android. (iOS doesn't provide a reliable signal here.)
  if (Platform.OS !== "android") return;

  // Use last known first (fast), then fall back to a fresh fix.
  let loc = await Location.getLastKnownPositionAsync().catch(() => null);
  if (!loc) {
    loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
      mayShowUserSettingsDialog: true,
    }).catch(() => null);
  }

  const mocked = loc?.mocked;
  logD("TRACKING_SVC", "assertNoMockLocation", { source, mocked });

  if (mocked === true) {
    await setTrackingIssue({
      type: "MOCK_LOCATION",
      message: MOCK_LOCATION_BLOCKED_MESSAGE,
      at: Date.now(),
    });
    throw new Error(MOCK_LOCATION_BLOCKED_MESSAGE);
  }

  // Only clear when we *know* it's not mocked.
  if (mocked === false) {
    await clearTrackingIssue();
  }
}

async function maybeAutoFlushQueuedPoints(source: string) {
  // If the device is online, try to upload immediately so "queued" stays near zero.
  // We still enqueue first for reliability; immediate flush makes it effectively "direct send".
  const now = Date.now();
  if (foregroundAutoFlushInProgress) return;
  if (now - lastForegroundAutoFlushAt < 15_000) return; // throttle

  const net = await NetInfo.fetch().catch(() => null);
  if (!net?.isConnected || net.isInternetReachable === false) {
    logD("TRACKING_SVC", "autoFlush:offline", { source, net });
    return;
  }

  foregroundAutoFlushInProgress = true;
  lastForegroundAutoFlushAt = now;
  try {
    logD("TRACKING_SVC", "autoFlush:online -> flushQueuedPoints", { source });
    await flushQueuedPoints({ maxBatches: 1 });
  } catch (e) {
    // Keep points queued; they'll upload on next attempt/manual flush.
    logW("TRACKING_SVC", "autoFlush failed (kept queued)", { source, error: String(e) });
  } finally {
    foregroundAutoFlushInProgress = false;
  }
}

function isExpoGoAndroid(): boolean {
  return Platform.OS === "android" && Constants.appOwnership === "expo";
}

export async function openBatteryOptimizationSettings() {
  if (Platform.OS !== "android") return;
  // In Expo-managed JS we can't force "Unrestricted" or reliably deep-link to every OEM's
  // battery optimization screen without a native module. Best-effort: open app settings.
  await Linking.openSettings().catch(() => null);
}

async function maybePromptBatteryOptimization() {
  if (Platform.OS !== "android") return;
  if (isExpoGoAndroid()) return;

  const prompted = await AsyncStorage.getItem(STORAGE_BATTERY_PROMPTED_KEY);
  if (prompted) return;
  await AsyncStorage.setItem(STORAGE_BATTERY_PROMPTED_KEY, "1");

  // Keep it simple: inform user once. OEMs vary and we can't programmatically force "Unrestricted".
  Alert.alert(
    "Allow background tracking",
    "To keep tracking working with the screen locked, please set Battery usage to Unrestricted/No restrictions and disable battery optimization for this app.",
    [
      { text: "Not now", style: "cancel" },
      {
        text: "Open settings",
        onPress: () => {
          openBatteryOptimizationSettings().catch(() => null);
        },
      },
    ],
  );
}

async function ensureUserAcknowledgedTrackingRequirements(): Promise<boolean> {
  // We can *enforce* background location permission (we do).
  // We cannot programmatically force OEM settings like "Unrestricted battery" or "Auto-start".
  // This gate is a UX tool: explain requirements and block start until user acknowledges.
  if (Platform.OS !== "android") return true;
  if (isExpoGoAndroid()) return true;

  const ack = await AsyncStorage.getItem(STORAGE_TRACKING_REQUIREMENTS_ACK_KEY);
  if (ack) return true;

  // Verify background permission again (this is enforceable).
  const bg = await Location.getBackgroundPermissionsAsync().catch(() => null);
  if (!bg?.granted) {
    Alert.alert(
      "Allow location all the time",
      'Please set Location permission to "Allow all the time" so tracking works when the screen is locked.',
      [
        { text: "Cancel", style: "cancel" },
        { text: "Open settings", onPress: () => Linking.openSettings().catch(() => null) },
      ],
    );
    return false;
  }

  return await new Promise<boolean>((resolve) => {
    Alert.alert(
      "Background tracking requirements",
      [
        "To keep tracking working with the screen locked, please ensure:",
        '1) Location permission: "Allow all the time"',
        '2) Battery usage: "Unrestricted / No restrictions"',
        "3) Auto-start/background activity allowed (OEM setting)",
        "",
        "If you skip these, background tracking may stop and the app will not be usable for continuous tracking.",
      ].join("\n"),
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        {
          text: "Open app settings",
          onPress: async () => {
            await Linking.openSettings().catch(() => null);
            resolve(false);
          },
        },
        {
          text: "I enabled them",
          onPress: async () => {
            await AsyncStorage.setItem(STORAGE_TRACKING_REQUIREMENTS_ACK_KEY, "1").catch(
              () => null,
            );
            resolve(true);
          },
        },
      ],
    );
  });
}

export async function getActiveShift(): Promise<ActiveShiftState | null> {
  const raw = await AsyncStorage.getItem(STORAGE_ACTIVE_SHIFT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveShiftState;
  } catch {
    logW("TRACKING_SVC", "getActiveShift: invalid JSON in AsyncStorage");
    return null;
  }
}

export async function clearActiveShift() {
  logI("TRACKING_SVC", "clearActiveShift");
  await AsyncStorage.removeItem(STORAGE_ACTIVE_SHIFT_KEY);
}

async function saveActiveShift(state: ActiveShiftState) {
  logD("TRACKING_SVC", "saveActiveShift", state);
  await AsyncStorage.setItem(STORAGE_ACTIVE_SHIFT_KEY, JSON.stringify(state));
}

async function ensureNotificationPermission() {
  if (Platform.OS !== "android") return { granted: true as const };

  // Android 13+ requires POST_NOTIFICATIONS runtime permission for showing FGS notifications.
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

    logW("TRACKING_SVC", "ensureNotificationPermission: denied");
    return {
      granted: false as const,
      reason:
        "Notification permission denied (required to show the tracking notification)",
    };
  } catch {
    logE("TRACKING_SVC", "ensureNotificationPermission: request failed");
    return {
      granted: false as const,
      reason: "Unable to request notification permission",
    };
  }
}

export async function ensureTrackingPermissions() {
  logI("TRACKING_SVC", "ensureTrackingPermissions:start");
  const notif = await ensureNotificationPermission();
  if (!notif.granted) {
    logW("TRACKING_SVC", "ensureTrackingPermissions: notification not granted", notif);
    return { granted: false as const, reason: notif.reason };
  }

  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) {
    logW("TRACKING_SVC", "ensureTrackingPermissions: foreground not granted", fg);
    return { granted: false as const, reason: "Foreground location permission not granted" };
  }

  const gpsOn = await Location.hasServicesEnabledAsync();
  if (!gpsOn) {
    logW("TRACKING_SVC", "ensureTrackingPermissions: GPS is off");
    return { granted: false as const, reason: "Location services (GPS) are turned off" };
  }

  // Background permission is required for true background tracking in an APK.
  // In Expo Go on Android it won't work anyway, so we don't hard-fail there.
  try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    if (!bg.granted) {
      logW("TRACKING_SVC", "ensureTrackingPermissions: background not granted", bg);
      if (isExpoGoAndroid()) {
        return {
          granted: true as const,
          warning:
            "Background location not granted. Tracking may work only while app is open.",
        } as any;
      }
      // In a real APK we want locked-screen tracking, so require "Allow all the time".
      Alert.alert(
        "Allow location all the time",
        'Please set Location permission to "Allow all the time" so tracking works when the screen is locked.',
        [
          { text: "Cancel", style: "cancel" },
          { text: "Open settings", onPress: () => Linking.openSettings().catch(() => null) },
        ],
      );
      return {
        granted: false as const,
        reason:
          'Background location is required. Please set Location permission to "Allow all the time".',
      };
    }
  } catch {
    logW("TRACKING_SVC", "ensureTrackingPermissions: background permission request failed");
    if (!isExpoGoAndroid()) {
      return {
        granted: false as const,
        reason:
          'Unable to request background location permission. Please enable "Allow all the time" in Settings.',
      };
    }
  }

  logI("TRACKING_SVC", "ensureTrackingPermissions:ok");
  // Prompt user once to disable battery optimization (manual step).
  maybePromptBatteryOptimization().catch(() => null);
  return { granted: true as const };
}

async function startForegroundWatch(
  shiftId: string,
  timeIntervalMs: number,
  distanceIntervalM: number,
) {
  if (foregroundWatchSubscription) return;

  logI("TRACKING_SVC", "startForegroundWatch", { shiftId, timeIntervalMs, distanceIntervalM });
  foregroundWatchSubscription = await Location.watchPositionAsync(
    {
      accuracy: Location.Accuracy.High,
      timeInterval: timeIntervalMs,
      distanceInterval: distanceIntervalM,
    },
    async (location: Location.LocationObject) => {
      if (Platform.OS === "android" && location?.mocked === true) {
        logW("TRACKING_SVC", "foreground: mock location detected; pausing shift", {
          shiftId,
          ts: location?.timestamp,
        });
        await setTrackingIssue({
          type: "MOCK_LOCATION",
          message: MOCK_LOCATION_BLOCKED_MESSAGE,
          at: Date.now(),
        });
        await pauseShiftTracking().catch(() => null);
        return;
      }

      // Expo Go fallback: enqueue points directly in foreground.
      // This is NOT used in dev build/prod; the background task handles it there.
      try {
        const { insertPointFromLocation } = await import("./trackingDb" as any);
        if (typeof (insertPointFromLocation as any) === "function") {
          logD("TRACKING_SVC", "foreground:location", {
            ts: location?.timestamp,
            lat: location?.coords?.latitude,
            lng: location?.coords?.longitude,
            acc: location?.coords?.accuracy,
            speed: location?.coords?.speed,
            heading: location?.coords?.heading,
          });
          await (insertPointFromLocation as any)(shiftId, location);
          // Expo Go doesn't reliably run the background task, so flush here while online.
          await maybeAutoFlushQueuedPoints("foreground-watch");
        }
      } catch {
        logW("TRACKING_SVC", "foreground: insertPointFromLocation failed");
        // If you don't have insertPointFromLocation, do nothing here.
        // Your UI will still show "TRACKING", but no points will queue in Expo Go.
      }
    },
  );
}

async function stopForegroundWatch() {
  if (!foregroundWatchSubscription) return;
  logI("TRACKING_SVC", "stopForegroundWatch");
  foregroundWatchSubscription.remove();
  foregroundWatchSubscription = null;
}

async function stopBackgroundTask() {
  const isStarted = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK_NAME);
  if (isStarted) {
    logI("TRACKING_SVC", "stopBackgroundTask");
    await Location.stopLocationUpdatesAsync(TRACKING_TASK_NAME);
  }
}

async function startBackgroundTask(timeIntervalMs: number, distanceIntervalM: number) {
  const isStarted = await Location.hasStartedLocationUpdatesAsync(TRACKING_TASK_NAME);
  if (isStarted) return;

  logI("TRACKING_SVC", "startBackgroundTask", { timeIntervalMs, distanceIntervalM });
  await Location.startLocationUpdatesAsync(TRACKING_TASK_NAME, {
    accuracy: Location.Accuracy.High,
    timeInterval: timeIntervalMs,
    distanceInterval: distanceIntervalM,

    // Helps OS batch a bit instead of waking up too often.
    deferredUpdatesInterval: Math.max(30_000, timeIntervalMs),
    deferredUpdatesDistance: distanceIntervalM,

    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,

    // Android foreground service: notification is REQUIRED.
    foregroundService: {
      notificationTitle: TRACKING_NOTIFICATION_TITLE,
      notificationBody: TRACKING_NOTIFICATION_BODY,
    },
  });
}

export async function startShiftTracking(params: {
  employeeId: string;
  workspaceId: string;
  timeIntervalMs?: number;
  distanceIntervalM?: number;
}) {
  logI("TRACKING_SVC", "startShiftTracking:start", params);
  const perm = await ensureTrackingPermissions();
  if (!perm.granted) throw new Error((perm as any).reason);

  // Hard gate on APK: user must acknowledge OS requirements for continuous tracking.
  const ok = await ensureUserAcknowledgedTrackingRequirements();
  if (!ok) {
    throw new Error(
      "Background tracking requirements not satisfied. Please enable 'Allow all the time' + Unrestricted battery and try again.",
    );
  }

  await assertNoMockLocation("startShiftTracking");
  await initTrackingDb();

  const deviceId = await getOrCreateDeviceId();
  const existing = await getActiveShift();
  if (existing?.shiftId && !existing.paused) {
    // already running
    logI("TRACKING_SVC", "startShiftTracking:alreadyRunning", existing);
    return existing;
  }

  const timeIntervalMs = params.timeIntervalMs ?? DEFAULT_TIME_INTERVAL_MS;
  const distanceIntervalM = params.distanceIntervalM ?? DEFAULT_DISTANCE_INTERVAL_M;

  // Start shift on backend first (source of truth)
  const startRes = await apiStartShift({
    employeeId: params.employeeId,
    workspaceId: params.workspaceId,
    deviceId,
  });

  if (!startRes.success) {
    logE("TRACKING_SVC", "startShiftTracking:apiStartShift failed", startRes);
    throw new Error(startRes.error || "Failed to start shift");
  }

  const strategy: TrackingStrategy = isExpoGoAndroid() ? "FOREGROUND_WATCH" : "BACKGROUND_TASK";
  if (strategy === "FOREGROUND_WATCH") {
    logW(
      "TRACKING_SVC",
      "Expo Go Android detected: using foreground watch only (no background task delivery)",
    );
  }

  const active: ActiveShiftState = {
    shiftId: startRes.shiftId,
    employeeId: params.employeeId,
    workspaceId: params.workspaceId,
    deviceId,
    paused: false,
    strategy,
  };

  await saveActiveShift(active);
  await ensureShiftState(active.shiftId);

  logI("TRACKING_SVC", "startShiftTracking:collectorStart", active);
  // IMPORTANT:
  // - Expo Go Android: cannot run background task; fallback watch works only while app is open.
  // - Dev Build / Production: background task works (with notification).
  if (strategy === "FOREGROUND_WATCH") {
    await startForegroundWatch(active.shiftId, timeIntervalMs, distanceIntervalM);
  } else {
    await startBackgroundTask(timeIntervalMs, distanceIntervalM);
  }

  return active;
}

export async function pauseShiftTracking() {
  const active = await getActiveShift();
  if (!active) return;

  logI("TRACKING_SVC", "pauseShiftTracking", active);
  if (active.strategy === "FOREGROUND_WATCH") {
    await stopForegroundWatch();
  } else {
    await stopBackgroundTask();
  }

  active.paused = true;
  await saveActiveShift(active);
  return active;
}

export async function resumeShiftTracking(params?: {
  timeIntervalMs?: number;
  distanceIntervalM?: number;
}) {
  const active = await getActiveShift();
  if (!active) throw new Error("No active shift to resume");

  logI("TRACKING_SVC", "resumeShiftTracking:start", { active, params });
  const perm = await ensureTrackingPermissions();
  if (!perm.granted) throw new Error((perm as any).reason);

  const ok = await ensureUserAcknowledgedTrackingRequirements();
  if (!ok) {
    throw new Error(
      "Background tracking requirements not satisfied. Please enable 'Allow all the time' + Unrestricted battery and try again.",
    );
  }

  await assertNoMockLocation("resumeShiftTracking");
  const timeIntervalMs = params?.timeIntervalMs ?? DEFAULT_TIME_INTERVAL_MS;
  const distanceIntervalM = params?.distanceIntervalM ?? DEFAULT_DISTANCE_INTERVAL_M;

  active.paused = false;

  // Determine strategy again (in case appOwnership differs between dev/prod)
  active.strategy = isExpoGoAndroid() ? "FOREGROUND_WATCH" : "BACKGROUND_TASK";
  await saveActiveShift(active);

  logI("TRACKING_SVC", "resumeShiftTracking:collectorStart", active);
  if (active.strategy === "FOREGROUND_WATCH") {
    await startForegroundWatch(active.shiftId, timeIntervalMs, distanceIntervalM);
  } else {
    await startBackgroundTask(timeIntervalMs, distanceIntervalM);
  }

  return active;
}

export async function stopShiftTracking() {
  const active = await getActiveShift();
  if (!active) return;

  logI("TRACKING_SVC", "stopShiftTracking:start", active);
  // Try a best-effort flush before ending.
  await flushQueuedPoints({ maxBatches: 1 }).catch(() => null);

  await stopForegroundWatch();
  await stopBackgroundTask();

  // Notify backend that shift ended (best-effort).
  await apiEndShift(active).catch(() => null);
  await clearActiveShift();
  await clearTrackingIssue();
  logI("TRACKING_SVC", "stopShiftTracking:done");
}

export async function flushQueuedPoints(options?: { maxBatches?: number }) {
  const active = await getActiveShift();
  if (!active) {
    logW("TRACKING_SVC", "flushQueuedPoints:noActiveShift");
    return { uploaded: 0 };
  }

  const maxBatches = options?.maxBatches ?? 3;
  let uploaded = 0;

  logI("TRACKING_SVC", "flushQueuedPoints:start", { shiftId: active.shiftId, maxBatches });
  for (let i = 0; i < maxBatches; i++) {
    const batch = await getPendingBatch(active.shiftId, DEFAULT_UPLOAD_BATCH_SIZE);
    if (!batch.rows.length) break;

    const batchStartLocalId = batch.rows[0].local_id as number;
    const batchEndLocalId = batch.rows[batch.rows.length - 1].local_id as number;
    logD("TRACKING_SVC", "flushQueuedPoints:batch", {
      i,
      size: batch.rows.length,
      batchStartLocalId,
      batchEndLocalId,
    });

    const points = batch.rows.map((r) => ({
      pointId: `${active.deviceId}:${active.shiftId}:${r.local_id}`,
      ts: Number(r.ts),
      latitude: Number(r.latitude),
      longitude: Number(r.longitude),
      queuedAt: r.created_at !== null && r.created_at !== undefined ? Number(r.created_at) : null,
      accuracyM: r.accuracy_m !== null ? Number(r.accuracy_m) : null,
      speedMps: r.speed_mps !== null ? Number(r.speed_mps) : null,
      bearingDeg: r.bearing_deg !== null ? Number(r.bearing_deg) : null,
      isMock: r.is_mock === 1,
    }));

    const res = await apiUploadBreadcrumbBatch({
      shiftId: active.shiftId,
      employeeId: active.employeeId,
      workspaceId: active.workspaceId,
      deviceId: active.deviceId,
      batchStartLocalId,
      batchEndLocalId,
      points,
    });

    if (!res.success || res.ackUpToLocalId == null) {
      await incrementFailure(active.shiftId);
      logE("TRACKING_SVC", "flushQueuedPoints:uploadFailed", res);
      throw new Error(!res.success ? res.error : "Upload failed (missing ackUpToLocalId)");
    }

    await markAckedAndPrune(active.shiftId, Number(res.ackUpToLocalId));
    uploaded += points.length;
    logI("TRACKING_SVC", "flushQueuedPoints:ack", { ackUpToLocalId: res.ackUpToLocalId, uploaded });
  }

  logI("TRACKING_SVC", "flushQueuedPoints:done", { uploaded });
  return { uploaded };
}
