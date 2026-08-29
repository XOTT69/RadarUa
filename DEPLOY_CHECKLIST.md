# Deploy checklist — public Telegram v2.1

- [ ] Обрано публічні Telegram-канали для `SOURCE_ALLOWLIST`.
- [ ] Створено Cloudflare KV namespace `SUBSCRIPTIONS`.
- [ ] KV `id` вставлено у `worker/wrangler.toml`.
- [ ] Worker задеплоєно; через 2–3 хвилини `/health` показує `monitoring.state: "online"`.
- [ ] URL Worker вставлено у кореневий `config.js`.
- [ ] У `wrangler.toml` `ALLOWED_ORIGIN` змінено з `*` на URL GitHub Pages.
- [ ] Переконатися, що в `SOURCE_ALLOWLIST` немає приватних каналів або інвайт-посилань.
- [ ] GitHub Pages: Source = GitHub Actions.
- [ ] PWA встановлено на телефон.
- [ ] У PWA вибрано населений пункт.
- [ ] Увімкнено «Фонові push-сповіщення».
- [ ] Перевірено, що назва/область/район/громада у вибраному результаті правильні.
