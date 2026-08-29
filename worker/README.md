# RadarUa Worker — public Telegram mode

Cloudflare Worker + Cron reads the public web view of selected Telegram channels plus the free NEPTUN snapshot, deduplicates them, geocodes named localities, exposes realtime WebSocket/API to the PWA and optionally sends Web Push.

**No alerts.in.ua / UkraineAlarm key is required in this version.**

## Source allowlist
Set `SOURCE_ALLOWLIST` in `wrangler.toml` to public Telegram usernames (comma-separated). The scheduled scanner reads only these public `t.me/s/<username>` pages. No Telegram credentials or separate bridge host are needed.

`NEPTUN_API_URL`, `NEPTUN_ALERTS_URL` and `NEPTUN_RAIONS_GEOJSON_URL` are public, keyless read-only endpoints. The PWA must keep a visible NEPTUN attribution link when this integration is enabled.

## Required
1. Create KV for push subscriptions (even if push is not configured yet):
   `npx wrangler kv namespace create SUBSCRIPTIONS`
2. Put the returned KV id into `wrangler.toml`.
3. Deploy:
   `npm install && npm run deploy`
5. Put the Worker URL into root `config.js`.

## Optional push
Run `npm run vapid`, then set `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` as Worker secrets/vars.

## Public endpoints
- `GET /health`
- `GET /api/status` — public-channel scanner freshness
- `GET /api/threats`
- `GET /api/places?q=...`
- `GET /api/stream` (WebSocket)
- `GET /api/monitoring/events`

## Optional protected ingest endpoints
- `POST /api/monitoring/events`
- `POST /api/bridge/heartbeat`

Both require `Authorization: Bearer <INGEST_TOKEN>` when enabled for manual/legacy ingestion. They are not required by the public-channel scanner.

## Dedupe
Events of the same type + same named locality inside a 6-minute window are merged. Multiple independent channels raise `sourceCount` and `corroborated`, instead of creating overlapping markers.

## Geocoding caveat
Public Nominatim is rate limited; this Worker serializes requests to <=1/s and caches results for 7 days. For a large public service, switch to a self-hosted/paid geocoder or a local Ukraine settlement dataset.
