export const TRACKING_TASK_NAME = "FIELD_BREADCRUMB_TASK";

// Upload
export const DEFAULT_UPLOAD_BATCH_SIZE = 200;

// Baseline "field workforce" defaults. Tune from product needs.
// timeInterval = min time between updates (Android); distanceInterval = min meters moved.
export const DEFAULT_TIME_INTERVAL_MS = 60_000; // 60s
export const DEFAULT_DISTANCE_INTERVAL_M = 0; // 30 meters

// Foreground Service notification (Android)
export const TRACKING_NOTIFICATION_TITLE = "Shift tracking is running";
export const TRACKING_NOTIFICATION_BODY = "Your location is being recorded for this shift.";

// Storage keys
export const STORAGE_DEVICE_ID_KEY = "tracking.deviceId";
export const STORAGE_ACTIVE_SHIFT_KEY = "tracking.activeShift";
export const STORAGE_BATTERY_PROMPTED_KEY = "tracking.batteryOptimizationPrompted.v1";
export const STORAGE_LAST_BG_DELIVERY_AT_KEY = "tracking.lastBackgroundDeliveryAt.v1";
export const STORAGE_TRACKING_REQUIREMENTS_ACK_KEY = "tracking.requirementsAck.v1";
export const STORAGE_TRACKING_ISSUE_KEY = "tracking.issue.v1";

export const MOCK_LOCATION_BLOCKED_MESSAGE =
  "Mock location detected. Disable mock location (Developer options → Select mock location app → None) and try again.";

export type { TrackingIssue, TrackingIssueType, TrackingMode } from "@hajiracm/tracking-core";
