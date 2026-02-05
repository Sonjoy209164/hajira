# jamai-api (demo backend)

Tiny Node.js backend implementing the endpoint contract used by:

- `@hajiracm/tracking-core`
- `@hajiracm/tracking-expo`

This is a **demo** server (JSON file storage). Do not use as-is for production.

## Run

```bash
cd apps/jamai-api
npm run dev
```

Server listens on `http://localhost:3000` by default.

## Environment

- `PORT` (default: `3000`)
- `HOST` (default: `127.0.0.1`) — set to `0.0.0.0` to allow LAN devices to reach it
- `JAMAI_API_KEY` (optional) — if set, requests must include `X-CM-API-KEY: <key>`
- `JAMAI_DB_PATH` (optional) — path to JSON storage file (default: `apps/jamai-api/data/db.json`)

## Endpoints

- `POST /tracking/shifts/start`
- `POST /tracking/shifts/end`
- `POST /tracking/points/batch`
- `GET /tracking/shifts`
- `GET /tracking/shifts/:shiftId/points`
