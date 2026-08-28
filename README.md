# RadarUa — Telegram Online 2.0

RadarUa is a PWA for **near-realtime Telegram monitoring around a user-selected Ukrainian locality**. This release intentionally works **without alerts.in.ua / UkraineAlarm or any other air-alert API**.

> **Safety:** the feed is informational and is not an official air-raid warning system. A point on the map is the centroid of a locality/region mentioned by a source. It is **not** a verified live coordinate or trajectory of an aircraft, missile or UAV. Absence of fresh Telegram messages does not mean the area is safe.

## What this release does

- Choose and save your own city / town / village.
- Optional GPS → reverse-geocode to a locality; continuous live GPS is not sent to the backend.
- Radius 5–100 km and **Only my area** mode.
- Telegram event types: UAV, missile/ballistics, KAB, aviation, explosions/air defence, source-reported clear.
- Realtime WebSocket from Cloudflare Durable Object to the PWA.
- Telegram bridge using an authenticated MTProto user session.
- New + edited channel posts.
- Per-channel short-term context for sequences such as “UAV …” → “Course toward Vasylkiv”.
- Startup backfill after bridge restarts.
- SQLite outbox and exponential retry when the backend is unavailable.
- Bridge heartbeat and source-health state (`online / stale / offline`).
- Server-side geocoding cache and <=1 Nominatim request/sec.
- Regional aliases such as `Київщина`, `Сумщина`, `Чернігівщина` are treated as regions rather than fake precise points.
- Cross-channel deduplication: same type + locality in a 6-minute window becomes one event; multiple sources increase `sourceCount`/confidence.
- Optional Web Push filtered by the saved locality/radius.
- GitHub Pages frontend-only deployment; bridge/Worker/secrets are not published as the site artifact.

## Architecture

```text
Telegram channels (explicitly configured)
            │ MTProto / Telethon
            ▼
   telegram-bridge (always on)
   parser + context + SQLite outbox
            │ Bearer ingest token
            ▼
     Cloudflare Worker
   Durable Object + dedupe
     │      │       │
 geocode   WS      Push
     │      │       │
     └──────┴───────┘
            ▼
        RadarUa PWA
      GitHub Pages
```

## Important: “without API” means without an air-alert API

To receive arbitrary public channel updates reliably, Telegram requires a legitimate Telegram client authorization. Telegram documents that a third-party client needs its own `api_id` and `api_hash`; create them at `my.telegram.org → API development tools`. Keep both credentials and the resulting session secret private.

This project **does not scrape `t.me/s/...`** as a fallback. Public-web scraping is intentionally not the production path.

## 1. Deploy the Cloudflare Worker

```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create SUBSCRIPTIONS
```

Put the returned KV id into `worker/wrangler.toml`, then create a long random ingest secret:

```bash
npx wrangler secret put INGEST_TOKEN
npm run deploy
```

Check:

```bash
curl https://YOUR-WORKER.workers.dev/health
```

A healthy Worker can still report Telegram `offline` until the bridge is running.

### Production CORS and source allowlist

After setup, change:

```toml
ALLOWED_ORIGIN = "https://xott69.github.io"
SOURCE_ALLOWLIST = "channel_one,channel_two"
```

Use the exact usernames configured in the bridge. Keep `SOURCE_ALLOWLIST=""` only while setting up/testing.

## 2. Configure the frontend

In root `config.js`:

```js
apiBaseUrl: 'https://YOUR-WORKER.workers.dev',
```

Commit to `main`. The included Pages workflow publishes only:

- `index.html`
- `app.js`
- `styles.css`
- `config.js`
- `manifest.webmanifest`
- `sw.js`
- `data/feed.js`
- icons

## 3. Configure Telegram realtime

See `telegram-bridge/README.md`.

Short version:

```bash
cd telegram-bridge
pip install -r requirements.txt
python login.py
```

Store the generated `TG_SESSION_STRING` only in your hosting secret manager. Copy `.env.example` → `.env` locally/host-side and set:

```dotenv
TG_API_ID=...
TG_API_HASH=...
TG_SESSION_STRING=...
TG_CHANNELS=channel_one,channel_two
RADAR_API_URL=https://YOUR-WORKER.workers.dev
RADAR_INGEST_TOKEN=...
```

For reliable live channel updates, the authorized Telegram account should be subscribed to the configured channels. Automatic joining is **off** by default.

Run it on an always-on host:

```bash
docker compose -f docker-compose.example.yml up -d --build
```

GitHub Actions/GitHub Pages cannot themselves keep an MTProto listener alive 24/7.

## 4. Optional Web Push

The realtime map works without push. To add background push:

```bash
cd worker
npm run vapid
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
npm run deploy
```

For `VAPID_SUBJECT`, use a contact `mailto:` or HTTPS URL.

## 5. Choose “my locality”

Open the PWA and:

1. Search manually by name (`Знайти` or Enter; no autocomplete).
2. Pick the correct result.
3. Choose radius, e.g. 25 km.
4. Enable **Only my area**.
5. Optionally enable Push.

The public Nominatim service is used only for explicit search/reverse-geocode and event locality resolution. Worker requests are serialized and cached.

## Event semantics

- **destination** — source says the object is heading toward the named place;
- **near** — source says it is near/in the area of the named place;
- **route** — source mentions the place as part of a route;
- **region** — e.g. `Київщина`; relevance is determined by the selected oblast, not distance to the oblast centroid.

RadarUa never extrapolates a trajectory from these messages.

## Source handling

Only configure channels you have deliberately selected and whose content/use conditions you are prepared to follow. RadarUa stores a short normalized event, source label, message id/link and recent event history required to operate the service; it is not intended as a bulk Telegram archive.

## Tests

```bash
node --check app.js
node --check data/feed.js
node --check sw.js
node --check worker/src/index.js
cd telegram-bridge
python -m unittest -v
python -m py_compile bridge.py parser.py login.py
```

`IMPLEMENTATION_PLAN.md` documents the design decisions and failure modes. `RELEASE_CHECKLIST.md` is the deployment checklist.
