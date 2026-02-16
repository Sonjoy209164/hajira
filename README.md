# @hajiracm Tracking SDK

Consent-based location tracking for Expo/React Native apps, with a small, platform-agnostic TypeScript core.

This repo contains three npm packages:

- `@hajiracm/tracking-core`: shared types + a tiny `fetch` API client
- `@hajiracm/tracking-expo`: Expo/React Native implementation (permissions, background tasks, offline queue, upload)
- `@hajiracm/tracking-init`: Expo/React Native “starter” that only initiates tracking + queues points in `AsyncStorage` (no SQLite / no upload)

For a quick local demo app, run: `bash scripts/create-tracking-init-demo.sh`

## What It’s For (Use Cases)

Typical use cases:

- Field workforce / shift breadcrumb tracking
- Family/location sharing **with explicit opt-in** (e.g. “Share my live location with my partner”)
- Safety check-ins and “share while I’m traveling” modes

This SDK is **not** intended for covert tracking. Always get explicit consent from the person sharing their location, provide clear UI that location sharing is on, and make it easy to stop at any time.

## How It Works (High Level)

On the **tracker** device (phone that shares location):

1. Start a “shift” (session) with your backend.
2. Collect location updates (background task in Dev Build/Production; foreground fallback in Expo Go on Android).
3. Store points in a local SQLite queue.
4. Upload points in batches when online.

On the **viewer** device (phone that watches):

1. Call your backend to get the latest shift and points.
2. Render the latest point (and optionally a path) on a map UI.

## Install

Core only:

```bash
npm i @hajiracm/tracking-core
```

Expo implementation:

```bash
npm i @hajiracm/tracking-expo @hajiracm/tracking-core
```

`@hajiracm/tracking-expo` requires these peer deps in your app:

```bash
npx expo install expo-location expo-task-manager expo-sqlite expo-constants
npx expo install @react-native-async-storage/async-storage @react-native-community/netinfo
```

Init-only (no upload / no SQLite):

```bash
npm i @hajiracm/tracking-init @hajiracm/tracking-core
```

`@hajiracm/tracking-init` requires these peer deps in your app:

```bash
npx expo install expo-location expo-task-manager expo-constants
npx expo install @react-native-async-storage/async-storage @react-native-community/netinfo
```

## Backend Requirement

`@hajiracm/tracking-expo` **uploads to your backend**. You must provide a `baseUrl` for API calls. (`@hajiracm/tracking-init` does not upload; it only queues points.)

You can configure it using environment variables (simple) or in code (more flexible).

### Option A: Environment variables (Expo)

Set at build time:

- `EXPO_PUBLIC_API_BASE_URL` (required)
- `EXPO_PUBLIC_API_KEY` (optional)

`@hajiracm/tracking-core` also checks some common Node/Next.js env names:

- base url: `TRACKING_API_BASE_URL`, `BE_HOST`, `NEXT_PUBLIC_BE_HOST`
- api key: `TRACKING_API_KEY`, `API_KEY`

### Option B: Configure in code (recommended for apps)

```ts
import "@hajiracm/tracking-expo/trackingTask";
import { configureTrackingApiClient } from "@hajiracm/tracking-expo";
import { createTrackingFetchClient } from "@hajiracm/tracking-core";

configureTrackingApiClient(
  createTrackingFetchClient({
    baseUrl: "https://api.example.com",
    apiKey: undefined,
  }),
);
```

## Quickstart: Tracker App (Expo)

Import the task once at startup (required for background delivery):

```ts
import "@hajiracm/tracking-expo/trackingTask";
```

Start/pause/resume/stop tracking:

```ts
import {
  startShiftTracking,
  pauseShiftTracking,
  resumeShiftTracking,
  stopShiftTracking,
} from "@hajiracm/tracking-expo";

await startShiftTracking({
  employeeId: "HUSBAND_123",
  workspaceId: "COUPLE_1",
});

// ... later
await pauseShiftTracking();
await resumeShiftTracking();
await stopShiftTracking();
```

Useful helpers:

```ts
import { getActiveShift, flushQueuedPoints, getTrackingIssue } from "@hajiracm/tracking-expo";

const active = await getActiveShift(); // shows if a shift is active/paused
const issue = await getTrackingIssue(); // e.g. mock-location detection (Android)
await flushQueuedPoints({ maxBatches: 1 }); // manual upload attempt
```

### Expo Go vs Dev Build / Production

- **Dev Build / Production**: background tracking works via `expo-task-manager` + `expo-location`
- **Expo Go (Android)**: background tasks are not reliable; the SDK falls back to a foreground watcher (works only while the app is open)

## Quickstart: Viewer App (fetch latest point)

In the “viewer” app you typically call your backend to fetch the latest points:

```ts
import { createTrackingFetchClient } from "@hajiracm/tracking-core";

const api = createTrackingFetchClient({
  baseUrl: "https://api.example.com",
});

const shifts = await api.listShifts({ employeeId: "HUSBAND_123", limit: 1 });
if (shifts.success && shifts.shifts[0]) {
  const shiftId = shifts.shifts[0].shiftId;
  const points = await api.getShiftPoints({ shiftId, limit: 1 });
  // points.points[0] -> render on a map
}
```

## API Overview

### `@hajiracm/tracking-core`

- `createTrackingFetchClient({ baseUrl, apiKey?, ... })`
- `getDefaultTrackingEnvConfig()`
- Types: `TrackingPoint`, `TrackingShiftSummary`, `TrackingApiClient`, etc.

### `@hajiracm/tracking-expo` (main app-facing API)

- Session control: `startShiftTracking`, `pauseShiftTracking`, `resumeShiftTracking`, `stopShiftTracking`
- Upload: `flushQueuedPoints`
- State: `getActiveShift`, `clearActiveShift`
- Permissions: `ensureTrackingPermissions`
- Issues: `getTrackingIssue`, `clearTrackingIssue`
- Logging: `logD`, `logI`, `logW`, `logE`, plus `getLogcatEntries()` and `subscribeLogcat()`

## Backend Endpoints (Contract)

Your backend should implement:

- `POST /tracking/shifts/start`
- `POST /tracking/shifts/end`
- `POST /tracking/points/batch`
- `GET /tracking/shifts`
- `GET /tracking/shifts/:shiftId/points`

Request/response shapes are defined in `@hajiracm/tracking-core` types:

- `TrackingStartShiftRequest/Response`
- `TrackingEndShiftRequest/Response`
- `TrackingUploadPointsBatchRequest/Response`
- `TrackingListShiftsRequest/Response`
- `TrackingGetShiftPointsRequest/Response`

## Security Notes (Important)

- Authenticate both tracker and viewer users on your backend.
- Do not trust `employeeId`/`workspaceId` coming from the client without verifying access.
- Consider encrypting stored points at rest and restricting access by user/relationship.

## License

MIT
