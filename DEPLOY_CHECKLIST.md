# Deploy checklist — Telegram-only v2

- [ ] Обрано дозволені Telegram-канали для `TG_CHANNELS`.
- [ ] Створено Cloudflare KV namespace `SUBSCRIPTIONS`.
- [ ] KV `id` вставлено у `worker/wrangler.toml`.
- [ ] У Cloudflare додано `INGEST_TOKEN`; для push — також VAPID secrets.
- [ ] Worker задеплоєно та `/health` показує `ingestTokenConfigured: true`.
- [ ] URL Worker вставлено у кореневий `config.js`.
- [ ] У `wrangler.toml` `ALLOWED_ORIGIN` змінено з `*` на URL GitHub Pages.
- [ ] Bridge запущено на always-on хостингу з секретами, що не зберігаються у Git.
- [ ] GitHub Pages: Source = GitHub Actions.
- [ ] PWA встановлено на телефон.
- [ ] У PWA вибрано населений пункт.
- [ ] Увімкнено «Фонові push-сповіщення».
- [ ] Перевірено, що назва/область/район/громада у вибраному результаті правильні.
