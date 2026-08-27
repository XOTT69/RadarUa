# RadarUa v3 — персональна зона + background push

v3 містить усе з v2 та додає **фонові Web Push-сповіщення**, які можуть приходити після закриття PWA.

## Можливості
- вибір і збереження населеного пункту;
- адміністративна релевантність: область / район / громада / місто;
- режим **«Тільки моя зона»** та радіус 5–100 км;
- GPS без обов'язкового зберігання на сервері;
- офіційні активні тривоги через alerts.in.ua;
- PWA + service worker + offline shell;
- Web Push через VAPID;
- серверне зберігання push-підписок у Cloudflare KV;
- cron раз на хвилину: push надсилається лише коли стан конкретної зони змінився **inactive → active** або **active → inactive**;
- автоматичне видалення протермінованих push-підписок (HTTP 404/410);
- опціональний normalized monitoring feed для грубих публічних повідомлень по населеному пункту/громаді/району/області.

## Безпека даних
Для background push Worker навмисно зберігає лише `name`, `oblast`, `district`, `hromada` та push subscription. GPS-координати домашньої точки в push-сховище не записуються.

## Важливе обмеження
Карта показує адміністративні статуси та грубі інформаційні події. Вона **не відображає точні live-координати або траєкторії повітряних цілей** і не замінює офіційні системи оповіщення.

# Розгортання

## 1. Токен alerts.in.ua
Отримайте персональний API token: https://devs.alerts.in.ua/

## 2. Cloudflare KV
```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create SUBSCRIPTIONS
```

Команда поверне `id`. Вставте його в `worker/wrangler.toml` замість `REPLACE_WITH_KV_ID`.

## 3. VAPID ключі
```bash
npx web-push generate-vapid-keys
```

Потім збережіть секрети:
```bash
npx wrangler secret put ALERTS_TOKEN
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
```

`VAPID_SUBJECT` — наприклад `mailto:you@example.com`.

## 4. Deploy Worker
```bash
npm run deploy
```

Перевірка:
```bash
curl https://YOUR-WORKER.workers.dev/health
```

Очікується `pushConfigured: true` та `alertsTokenConfigured: true`.

## 5. Frontend
Впишіть URL Worker у кореневий `config.js`:
```js
window.RADAR_CONFIG = {
  version: '3.0.0',
  mode: 'api',
  apiBaseUrl: 'https://YOUR-WORKER.workers.dev',
  refreshMs: 15000,
  defaultRadiusKm: 25,
  maxRadiusKm: 100,
  defaultOnlyMyArea: true,
  enableBrowserNotifications: true,
  enableBackgroundPush: true
};
```

## 6. GitHub Pages
**Settings → Pages → Source: GitHub Actions**. Workflow `.github/workflows/pages.yml` уже є.

На iPhone встановіть PWA через Safari: **Поділитися → На початковий екран**, потім відкрийте встановлений RadarUa і дозвольте push.

# Опціональний monitoring feed

Worker підтримує `MONITOR_FEED_URL`. Це має бути ваш або дозволений сторонній JSON endpoint. Формат:
```json
{
  "items": [
    {
      "id": "event-123",
      "type": "drone",
      "title": "Моніторингове повідомлення",
      "detail": "Повідомлення стосується громади",
      "locality": "Назва населеного пункту",
      "hromada": "Назва громади",
      "district": "Назва району",
      "oblast": "Назва області",
      "timestamp": "2026-08-27T20:00:00Z",
      "source": "назва джерела"
    }
  ]
}
```

Навмисно не передбачений контракт для точних live-координат цілей. Події відображаються як грубий статус адміністративної зони.

Secrets/vars:
```bash
npx wrangler secret put MONITOR_FEED_URL
# якщо потрібна авторизація:
npx wrangler secret put MONITOR_FEED_TOKEN
```

# Локальний запуск
Frontend:
```bash
python3 -m http.server 8080
```
Worker:
```bash
cd worker
cp .dev.vars.example .dev.vars
npm install
npm run dev
```
