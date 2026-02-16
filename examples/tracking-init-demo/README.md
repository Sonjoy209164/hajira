# tracking-init-demo

Small Expo app showing how to use `@hajiracm/tracking-init` to:

- request permissions
- start background/foreground location tracking
- queue points in `AsyncStorage`
- print every collected point continuously in the Metro console

## Run

```bash
npm install
npx expo start -c
```

Then scan the QR with Expo Go (or run a Dev Build).

## How it’s used (code)

Side-effect import at startup (required so Android can deliver background updates):

```ts
import "@hajiracm/tracking-init/trackingTask";
```

Enable continuous console logging (prints on every collected point):

```ts
import { setTrackingInitDebugLogging } from "@hajiracm/tracking-init";

setTrackingInitDebugLogging(true);
```

Start/stop tracking:

```ts
import { startTracking, stopTracking } from "@hajiracm/tracking-init";

await startTracking({ sessionId: "demo" });
// ...later
await stopTracking();
```

Read/drain queued points (you can upload these yourself):

```ts
import { drainQueuedTrackingPoints } from "@hajiracm/tracking-init";

const points = await drainQueuedTrackingPoints({ sessionId: "demo", limit: 50 });
console.log("drained", points.length);
```

Full demo UI lives in `App.tsx`.

## Permissions

This demo writes required permissions into `app.json`.

- Android: `ACCESS_COARSE_LOCATION`, `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `POST_NOTIFICATIONS`
- iOS: Location permission strings + background mode `location`

## Notes

- **Dev Build / Production**: background task delivery works.
- **Expo Go (Android)**: background task delivery is not reliable; the SDK falls back to a foreground watcher (works while app is open).

## Monorepo / local file deps

This app installs the package via:

- `@hajiracm/tracking-init`: `file:../../packages/tracking-init`

When using local workspace packages like this, Metro needs `metro.config.js` (included) so it can watch and resolve symlinked packages.

