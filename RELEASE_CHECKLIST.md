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

## Public Telegram collector
- [ ] `SOURCE_ALLOWLIST` contains only deliberately selected public channel usernames.
- [ ] No private channels or `t.me/+...` invite links are configured.
- [ ] `/api/status` reports `public_telegram_web`, `online` and the expected channel count after the first scheduled run.

## Realtime test
- [ ] Wait for a source message or invoke a local scheduled-event test.
- [ ] Event arrives without a page reload over WebSocket.
- [ ] Event marker says it is an approximate locality point.
- [ ] A duplicate from another channel merges and increments source count.
- [ ] When all public source pages are unreachable for >5 minutes, UI stops claiming the collector is online.

## Optional Push
- [ ] VAPID keys configured.
- [ ] Push enabled in PWA after selecting locality.
- [ ] Relevant event produces push.
- [ ] A `clear` push says it is source-reported, not official.
