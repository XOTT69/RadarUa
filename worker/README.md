# RadarUa API v2 (Cloudflare Worker)

## Що робить
- `GET /health` — стан API.
- `GET /api/threats` — активні офіційні тривоги з alerts.in.ua.
- `GET /api/places?q=...` — пошук населеного пункту через Nominatim з кешем.
- Параметри `place`, `oblast`, `district`, `hromada`, `lat`, `lon` дозволяють визначити, чи офіційна тривога стосується вибраного населеного пункту.

## Deploy
1. Створити API token на alerts.in.ua.
2. `npx wrangler secret put ALERTS_TOKEN`
3. `npx wrangler deploy`
4. URL Worker записати у `config.js` фронтенду як `apiBaseUrl`.

Публічний Nominatim призначений для невеликого навантаження. Пошук у PWA має debounce, Worker кешує відповіді. Для великої аудиторії замініть геокодер на власний Nominatim/комерційний провайдер.
