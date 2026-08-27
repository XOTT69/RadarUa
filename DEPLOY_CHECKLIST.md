# Deploy checklist — v3

- [ ] Отримано token alerts.in.ua.
- [ ] Створено Cloudflare KV namespace `SUBSCRIPTIONS`.
- [ ] KV `id` вставлено у `worker/wrangler.toml`.
- [ ] Згенеровано VAPID public/private keys.
- [ ] У Cloudflare додано secrets: `ALERTS_TOKEN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`.
- [ ] Worker задеплоєно та `/health` показує `alertsTokenConfigured: true`, `pushConfigured: true`.
- [ ] URL Worker вставлено у кореневий `config.js`.
- [ ] GitHub Pages: Source = GitHub Actions.
- [ ] PWA встановлено на телефон.
- [ ] У PWA вибрано населений пункт.
- [ ] Увімкнено «Фонові push-сповіщення».
- [ ] Перевірено, що назва/область/район/громада у вибраному результаті правильні.
