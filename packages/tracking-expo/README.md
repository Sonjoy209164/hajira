# @hajira/tracking-expo

Expo/React Native implementation of Hajira **continuous shift tracking**.

What you get:
- Shift lifecycle: `startShiftTracking`, `pauseShiftTracking`, `resumeShiftTracking`, `stopShiftTracking`
- Background collection (Dev Build / Production) via `expo-task-manager` + `expo-location`
- Expo Go fallback (Android): foreground `watchPositionAsync` while app is open
- Offline queue in `expo-sqlite` + batch upload
- Built-in `AsyncStorage` log buffer (`@hajira/tracking-expo/logcat`)

## Install

```bash
npm i @hajira/tracking-expo
```

Note: this repo currently exports **TypeScript source** from the package. If your bundler doesn’t transpile TS from dependencies, run the package build and switch exports to `dist/`.

## Required peer deps (your app must already have these)

- `expo-location`, `expo-task-manager`, `expo-sqlite`, `expo-constants`
- `@react-native-async-storage/async-storage`
- `@react-native-community/netinfo`

## Setup (Expo app)

1) Import the task once at startup (side-effect import):

```ts
import "@hajira/tracking-expo/trackingTask";
```

2) Ensure Android permissions are declared in your `app.json` / config:

- `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`
- `ACCESS_BACKGROUND_LOCATION` (recommended for locked-screen tracking)
- `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`
- `POST_NOTIFICATIONS` (Android 13+)

3) Configure API env (default client):

- `EXPO_PUBLIC_API_BASE_URL`
- `EXPO_PUBLIC_API_KEY` (optional if your backend doesn’t require it)

Or inject your own client:

```ts
import { configureTrackingApiClient } from "@hajira/tracking-expo";
// configureTrackingApiClient(myClient)
```

## Usage

```ts
import { startShiftTracking, stopShiftTracking } from "@hajira/tracking-expo";

await startShiftTracking({ employeeId: "E1", workspaceId: "W1" });
// ... later
await stopShiftTracking();
```

## Logcat (in-app logs)

```ts
import { logI } from "@hajira/tracking-expo/logcat";
logI("TRACKING", "hello");
```
