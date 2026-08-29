# Final deployment checklist — public Telegram v2.1

- [ ] Вказано публічні дозволені джерела у `SOURCE_ALLOWLIST`.
- [ ] Створено Cloudflare KV `SUBSCRIPTIONS` і ID вставлено у `worker/wrangler.toml`.
- [ ] Додано Cloudflare secrets: `INGEST_TOKEN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- [ ] Worker розгорнуто; `/health` повертає `ok: true`.
- [ ] URL Worker записано в `config.js` як `apiBaseUrl`.
- [ ] `ALLOWED_ORIGIN` обмежено до GitHub Pages origin.
- [ ] GitHub Pages використовує GitHub Actions.
- [ ] У PWA вибрано свій населений пункт.
- [ ] Push перевірено на реальному пристрої.
- [ ] Через 2–3 хвилини після deploy `/api/status` показує `public_telegram_web` та `online`.
