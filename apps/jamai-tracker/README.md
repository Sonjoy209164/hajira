# JamaiTracker (demo app)

Consent-based location sharing demo app using:

- `@hajiracm/tracking-expo` (tracker device)
- `@hajiracm/tracking-core` (viewer device)

## 1) Start the backend

```bash
cd apps/jamai-api
npm run dev
```

## 2) Run the Expo app

```bash
cd apps/jamai-tracker
npm install
npx expo start
```

Optional env defaults:

- Copy `apps/jamai-tracker/.env.example` to `apps/jamai-tracker/.env`
- Expo reads `EXPO_PUBLIC_*` variables at build time

Background tracking note:

- Expo Go (Android) does **not** reliably deliver background tasks; the SDK falls back to a foreground watcher.
- For real background tracking, use a Dev Build / Production build.

Map note (Android red screen `RNMapsAirModule could not be found`):

- Some Expo runtimes (including Expo Go) may not include native maps.
- The demo app will fall back to “Open in Maps” if the embedded map is unavailable.
- To enable the embedded map, create a Dev Build (custom client) that includes `react-native-maps`.

## Base URL tips

- Android emulator: `http://10.0.2.2:3000`
- iOS simulator: `http://localhost:3000`
- Physical device: `http://<your-LAN-IP>:3000` (phone and computer must be on same Wi‑Fi)
  - Start backend with `HOST=0.0.0.0 npm run dev` so your phone can reach it
