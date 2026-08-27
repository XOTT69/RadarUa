# RadarUa API — Cloudflare Worker

Backend для RadarUa Final 1.0: офіційні активні тривоги, пошук населеного пункту, monitoring feed, WebSocket realtime та Web Push.

## API

- `GET /health`
- `GET /api/places?q=...`
- `GET /api/threats?...`
- `GET /api/stream` — WebSocket
- `GET /api/monitoring/events`
- `POST /api/monitoring/events` — `Authorization: Bearer <INGEST_TOKEN>`
- `GET /api/push/config`
- `POST /api/push/subscribe`
- `POST|DELETE /api/push/unsubscribe`

## Точність даних

Офіційні тривоги зіставляються з вибраною адміністративною зоною. Їхні координати на загальній карті — умовні display-точки.

Monitoring ingest вимагає назву населеного пункту/території. Backend геокодує її до центра місцевості. Це **не позиція повітряної цілі**.

## Setup

```bash
npm install
npx wrangler kv namespace create SUBSCRIPTIONS
```

Вставте KV ID у `wrangler.toml`.

```bash
npm run vapid
npx wrangler secret put ALERTS_TOKEN
npx wrangler secret put INGEST_TOKEN
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
npm run deploy
```

У production обмежте `ALLOWED_ORIGIN` до origin GitHub Pages.
