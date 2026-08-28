# RadarUa Worker — Telegram-only mode

Cloudflare Worker + Durable Object receives parsed monitoring events from `telegram-bridge`, deduplicates them, geocodes named localities, exposes realtime WebSocket/API to the PWA and optionally sends Web Push.

**No alerts.in.ua / UkraineAlarm key is required in this version.**

## Source allowlist
After the bridge works, set `SOURCE_ALLOWLIST` in `wrangler.toml` to the configured channel usernames (comma-separated). This prevents a leaked ingest token from being used to inject arbitrary source labels.

## Required
1. Create KV for push subscriptions (even if push is not configured yet):
   `npx wrangler kv namespace create SUBSCRIPTIONS`
2. Put the returned KV id into `wrangler.toml`.
3. Create ingest secret:
   `npx wrangler secret put INGEST_TOKEN`
4. Deploy:
   `npm install && npm run deploy`
5. Put the Worker URL into root `config.js`.

## Optional push
Run `npm run vapid`, then set `VAPID_SUBJECT`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` as Worker secrets/vars.

## Public endpoints
- `GET /health`
- `GET /api/status` — Telegram bridge/channel freshness
- `GET /api/threats`
- `GET /api/places?q=...`
- `GET /api/stream` (WebSocket)
- `GET /api/monitoring/events`

## Protected endpoints
- `POST /api/monitoring/events`
- `POST /api/bridge/heartbeat`

Both require `Authorization: Bearer <INGEST_TOKEN>`.

## Dedupe
Events of the same type + same named locality inside a 6-minute window are merged. Multiple independent channels raise `sourceCount` and `corroborated`, instead of creating overlapping markers.

## Geocoding caveat
Public Nominatim is rate limited; this Worker serializes requests to <=1/s and caches results for 7 days. For a large public service, switch to a self-hosted/paid geocoder or a local Ukraine settlement dataset.
