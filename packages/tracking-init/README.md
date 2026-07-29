# @hajiracm/tracking-init

Reliable background GPS location tracking for Expo and React Native. It combines
foreground and background geolocation, offline location queues, Android
foreground-service support, tracking health checks, recovery APIs, and
mock-location-aware GPS fixes.

Use it for employee tracking, field-force tracking, workforce attendance,
delivery tracking, breadcrumb trails, route tracking, or any Expo application
that needs resilient background location collection without coupling tracking
to a particular backend.

## Features

`@hajiracm/tracking-init`:

- Checks/creates a `deviceId`
- Requests required runtime permissions
- Starts background tracking via `expo-task-manager` + `expo-location` (**Android foreground service notification included**)
- Falls back to foreground `watchPositionAsync` on Expo Go (Android)
- Queues points to `AsyncStorage` (**no SQLite / no DB**)
- Exposes health checks and recovery for stopped/stale collectors
- Acquires reliable one-off GPS fixes with timeout, retry, accuracy and mock-location controls
- Supports loss-safe queue processing with peek + acknowledgement

This package does **not** upload to your backend. Your app can read/drain the queue and upload however you want.

## Install

```bash
npm i @hajiracm/tracking-init @hajiracm/tracking-core
```

Peer deps (install in your app):

```bash
npx expo install expo-location expo-task-manager expo-constants
npx expo install @react-native-async-storage/async-storage @react-native-community/netinfo
```

## Setup (required)

Import the task once at app startup (side-effect import):

```ts
import "@hajiracm/tracking-init/trackingTask";
```

## Required permissions (Expo config)

In your Expo app config (`app.json` / `app.config.js`), make sure Android permissions are declared:

- `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`
- `ACCESS_BACKGROUND_LOCATION` (recommended for locked-screen tracking)
- `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`
- `POST_NOTIFICATIONS` (Android 13+)

For iOS, set permission strings and enable background mode `location` (required for background updates).

## Usage

```ts
import {
  setTrackingInitDebugLogging,
  startTracking,
  stopTracking,
  drainQueuedTrackingPoints,
} from "@hajiracm/tracking-init";

// Prints every collected point to the JS console:
setTrackingInitDebugLogging(true);

await startTracking({ sessionId: "shift_123" });

// ... later (e.g. when online)
const points = await drainQueuedTrackingPoints({ sessionId: "shift_123", limit: 200 });
// upload points yourself...

await stopTracking();
```

### Loss-safe queue processing

`drainQueuedTrackingPoints` removes points immediately. If processing can fail,
peek first and acknowledge only after the points are stored or uploaded:

```ts
import {
  acknowledgeQueuedTrackingPoints,
  peekQueuedTrackingPoints,
} from "@hajiracm/tracking-init";

const points = await peekQueuedTrackingPoints({ sessionId: "shift_123", limit: 200 });
await saveOrUpload(points);
await acknowledgeQueuedTrackingPoints({
  sessionId: "shift_123",
  pointIds: points.map((point) => point.pointId),
});
```

### Health checks and recovery

```ts
import { getTrackingHealth, recoverTracking } from "@hajiracm/tracking-init";

const health = await getTrackingHealth({ staleAfterMs: 5 * 60_000 });

// Always restarts a stopped native service. Set restartWhenStale to also
// restart a running service that has stopped delivering points.
const result = await recoverTracking({
  staleAfterMs: 5 * 60_000,
  restartWhenStale: true,
});
```

The collector interval and distance settings are persisted in the active
session, so recovery restarts with the same settings.

### Reliable one-off GPS fix

Call `ensureTrackingPermissions` first if the app has not already requested
location permission.

```ts
import { acquireGpsFix, ensureTrackingPermissions } from "@hajiracm/tracking-init";

await ensureTrackingPermissions();
const result = await acquireGpsFix({
  attempts: 3,
  timeoutMs: 12_000,
  requiredAccuracyM: 50,
  maximumAgeMs: 2 * 60_000,
  rejectMocked: true,
});
```

## Expo Go vs Dev Build / Production

- **Dev Build / Production**: background tracking works via `expo-task-manager` + `expo-location` (Android runs as a Foreground Service with a notification)
- **Expo Go (Android)**: background task delivery is not reliable; this package falls back to a foreground watcher (works only while the app is open)

## Demo app

From this repo root, run:

```bash
bash scripts/create-tracking-init-demo.sh
cd examples/tracking-init-demo
npx expo start -c
```

If you install this package via npm `"file:"` (symlink) in a monorepo, Metro may need a `metro.config.js` that adds your workspace `packages/` to `watchFolders` and resolves deps from the app’s `node_modules` (the demo generator writes this automatically).

## Share / publish

### Publish to npm

From this repo:

```bash
cd packages/tracking-init
npm version patch
npm run build
npm publish
```

If this is your first publish for a scoped package, you may need:

```bash
npm publish --access public
```

### Share as a tarball (no npm publish)

```bash
cd packages/tracking-init
npm run build
npm pack
```

This creates a `.tgz` you can send to someone. They can install it with:

```bash
npm i ./hajiracm-tracking-init-<version>.tgz
```
