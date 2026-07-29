export const TRACKING_TASK_NAME = "HAJIRA_TRACKING_INIT_TASK";

// Baseline defaults (tune per product needs)
export const DEFAULT_TIME_INTERVAL_MS = 60_000; // 60s
export const DEFAULT_DISTANCE_INTERVAL_M = 0; // 0m => time-based updates

// Android Foreground Service notification (required for background location updates)
export const TRACKING_NOTIFICATION_TITLE = "Tracking is running";
export const TRACKING_NOTIFICATION_BODY = "Your location is being recorded.";

// Storage keys
export const STORAGE_DEVICE_ID_KEY = "tracking.deviceId";
export const STORAGE_ACTIVE_SESSION_KEY = "trackingInit.activeSession.v1";
export const STORAGE_QUEUE_KEY_PREFIX = "trackingInit.queue.v1:";
export const STORAGE_LAST_BG_DELIVERY_AT_KEY = "trackingInit.lastBackgroundDeliveryAt.v1";
export const STORAGE_LAST_POINT_QUEUED_AT_KEY = "trackingInit.lastPointQueuedAt.v1";
