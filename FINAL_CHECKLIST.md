# Final deployment checklist

- [ ] Отримано `alerts.in.ua` API token.
- [ ] Створено Cloudflare KV `SUBSCRIPTIONS` і ID вставлено у `worker/wrangler.toml`.
- [ ] Додано Cloudflare secrets: `ALERTS_TOKEN`, `INGEST_TOKEN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- [ ] Worker розгорнуто; `/health` повертає `ok: true`.
- [ ] URL Worker записано в `config.js` як `apiBaseUrl`.
- [ ] `ALLOWED_ORIGIN` обмежено до GitHub Pages origin.
- [ ] GitHub Pages використовує GitHub Actions.
- [ ] У PWA вибрано свій населений пункт.
- [ ] Push перевірено на реальному пристрої.
- [ ] Telegram bridge запускається лише з дозволеними джерелами (якщо використовується).
