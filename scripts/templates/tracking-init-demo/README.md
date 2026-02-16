# tracking-init-demo

This app demonstrates `@hajiracm/tracking-init`.

## Run

```bash
npm install
npx expo start -c
```

## Code

Required startup import (background task registration):

```ts
import "@hajiracm/tracking-init/trackingTask";
```

Enable continuous console logging:

```ts
import { setTrackingInitDebugLogging } from "@hajiracm/tracking-init";
setTrackingInitDebugLogging(true);
```

Start tracking + drain queued points:

```ts
import { startTracking, drainQueuedTrackingPoints } from "@hajiracm/tracking-init";

await startTracking({ sessionId: "demo" });
const points = await drainQueuedTrackingPoints({ sessionId: "demo", limit: 50 });
console.log(points);
```

