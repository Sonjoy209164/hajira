# @hajira/tracking-core

Core (platform-agnostic) building blocks for the Hajira **shift breadcrumb tracking** system:

- Shared types (`TrackingPoint`, `TrackingShiftSummary`, etc.)
- A small `fetch`-based API client (`createTrackingFetchClient`)
- Helper to read default env config (`getDefaultTrackingEnvConfig`)

## Install

```bash
npm i @hajira/tracking-core
```

## Usage (Next.js / Node 18+ / Expo)

```ts
import { createTrackingFetchClient } from "@hajira/tracking-core";

const api = createTrackingFetchClient({
  baseUrl: process.env.BE_HOST!,
  apiKey: process.env.API_KEY,
});

const res = await api.listShifts({ employeeId: "123", limit: 50 });
```

Note: this repo currently exports **TypeScript source** from the package. In Next.js you may need `transpilePackages`.

## Environment helper

`getDefaultTrackingEnvConfig()` searches (in order):

- `TRACKING_API_BASE_URL`, `EXPO_PUBLIC_API_BASE_URL`, `BE_HOST`, `NEXT_PUBLIC_BE_HOST`
- `TRACKING_API_KEY`, `EXPO_PUBLIC_API_KEY`, `API_KEY`
