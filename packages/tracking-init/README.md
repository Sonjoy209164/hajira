# @hajiracm/tracking-init

Small Expo/React Native helper package that **initiates tracking**:

- Checks/creates a `deviceId`
- Requests required runtime permissions
- Starts background tracking via `expo-task-manager` + `expo-location` (**Android foreground service notification included**)
- Falls back to foreground `watchPositionAsync` on Expo Go (Android)
- Queues points to `AsyncStorage` (**no SQLite / no DB**)

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
