# RadarUa Telegram Online — release checklist

## Frontend / GitHub Pages
- [ ] Files are in repository root, not nested in `RadarUa-Final/`.
- [ ] `config.js` has the deployed Worker URL.
- [ ] Settings → Pages → Source = GitHub Actions.
- [ ] Pages workflow is green.
- [ ] PWA opens at `https://xott69.github.io/RadarUa/`.
- [ ] Locality search works only on button/Enter.
- [ ] “Only my area” and radius work.

## Worker
- [ ] KV `SUBSCRIPTIONS` exists and its id is in `worker/wrangler.toml`.
- [ ] `INGEST_TOKEN` is set as a Worker secret.
- [ ] Worker deploy is successful.
- [ ] `/health` returns `ok: true`.
- [ ] `ALLOWED_ORIGIN` is changed from `*` to the GitHub Pages origin after setup.
- [ ] `SOURCE_ALLOWLIST` is set after final source selection.

## Telegram bridge
- [ ] Own Telegram `api_id` / `api_hash` created.
- [ ] `TG_SESSION_STRING` generated locally and stored only as a secret.
- [ ] Telegram account is subscribed to all configured channels.
- [ ] `TG_CHANNELS` contains only deliberately selected sources.
- [ ] Bridge is on an always-on host.
- [ ] `/api/status` reports `online` and the expected channel count.
- [ ] SQLite outbox volume is persistent.

## Realtime test
- [ ] Send a test event with `tools/send_test_event.py` or wait for a source message.
- [ ] Event arrives without a page reload over WebSocket.
- [ ] Event marker says it is an approximate locality point.
- [ ] A duplicate from another channel merges and increments source count.
- [ ] After stopping bridge >90 sec, UI stops claiming Telegram is online.

## Optional Push
- [ ] VAPID keys configured.
- [ ] Push enabled in PWA after selecting locality.
- [ ] Relevant event produces push.
- [ ] A `clear` push says it is source-reported, not official.
