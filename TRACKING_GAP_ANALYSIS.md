# Tracking gap analysis: Shukhee FIP vs Hajira packages

Reviewed source: `/home/sonjoy-roy/shukhi/shukhee-fip`, with emphasis on the
Expo application's tracking, GPS trail, sync, attendance GPS, diagnostics and
watchdog flows.

## Added to `@hajiracm/all-time-tracking-expo`

| Shukhee capability | Previous package gap | Library implementation |
| --- | --- | --- |
| Detect a killed background location service | No public health API | `getTrackingHealth` reports session, service, delivery and queue health |
| Restart stopped/stale tracking | `startTracking` returned early for an apparently active stored session | `recoverTracking`, plus native-service verification inside `startTracking` |
| Restart with the original tracking cadence | Interval settings were not stored | `collectorOptions` persisted with the active session |
| Judge capture health from durable evidence | Delivery timestamp was written before queue success | Delivery is marked only after a valid point is queued; queue time is also stored |
| Avoid losing points when SQLite/API processing fails | `drainQueuedTrackingPoints` deleted before downstream success | `peekQueuedTrackingPoints` + `acknowledgeQueuedTrackingPoints` |
| Bounded GPS acquisition for check-in and forms | App maintained its own timeout/retry/fallback utility | `acquireGpsFix` supports retries, per-attempt timeout, accuracy limit, cached fallback and mock rejection |

## Kept application-specific

These are valuable in Shukhee but should remain adapters or become separate,
configurable packages rather than defaults in `tracking-init`:

- Shukhee's SQLite schema, motion-state labels, 25 m movement threshold,
  45-second walking-point throttle and 10-minute still heartbeat.
- Battery sampling through `expo-battery` and idempotency keys through
  `expo-crypto`; both would add peer dependencies and product policy.
- The `/sync/push` payload, acknowledgement format, login-session recovery and
  per-user database opening.
- Bengali incident notifications, escalation timing and the
  `expo-background-fetch` watchdog task. The generic package now exposes the
  health/recovery primitive an app-level scheduled task can call.
- Attendance/SSK geofences, face verification, server-side mock-location
  enforcement, Bangladesh administrative-area lookup and UI warnings.
- Client log upload and tracking-health API records, which depend on Shukhee's
  backend contract.

## Recommended next extraction

If those policies need to be reused across multiple products, add optional
packages instead of expanding the minimal initializer:

1. `@hajiracm/tracking-watchdog` for Background Fetch scheduling and
   configurable incident callbacks/notifications.
2. `@hajiracm/tracking-sqlite` for durable storage, motion filtering and
   upload acknowledgements.
3. Generic geofence helpers in `tracking-core` for distance and inside/outside
   evaluation, leaving enforcement policy to each app.
