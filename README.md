# RadarUa — Final 1.0

Готовий PWA-проєкт для GitHub Pages + Cloudflare Worker. Основний сценарій — один раз вибрати **свій населений пункт** і отримувати статус офіційної тривоги та, за бажанням, моніторингові події у своєму радіусі.

> **Важливо:** RadarUa — інформаційний сервіс і не замінює офіційні сирени, застосунок «Повітряна тривога», повідомлення органів влади чи правила перебування в укритті. Моніторингові точки — центр згаданої місцевості, а не підтверджена позиція ракети/БПЛА.

## Що є у фінальній версії

- PWA для iOS/Android/desktop і GitHub Pages.
- Пошук міста, села або селища по Україні.
- Визначення населеного пункту через GPS.
- Збереження вибраного населеного пункту локально на пристрої.
- Визначення релевантної офіційної тривоги за областю / районом / громадою / містом.
- Режим **«Показувати тільки мою зону»**.
- Радіус моніторингових подій 5–100 км.
- Карта, фільтри БПЛА / ракети / авіація / тривоги.
- Cloudflare Worker як backend-проксі для секретного токена `alerts.in.ua`.
- Realtime WebSocket через Durable Object.
- Web Push: початок/відбій офіційної тривоги та релевантні моніторингові події.
- Захищений ingest endpoint для дозволених моніторингових джерел.
- Опціональний Telegram bridge на Telethon.
- Кешування Nominatim і обмеження частоти геокодування.
- Leaflet 1.9.4 зафіксований через конкретну версію + SRI.

## Структура

```text
.
├── index.html
├── app.js
├── config.js
├── styles.css
├── manifest.webmanifest
├── sw.js
├── data/feed.js
├── assets/icons/
├── worker/                 # Cloudflare API, realtime, push
├── telegram-bridge/        # опціональний Telegram ingest
└── .github/workflows/      # GitHub Pages + Worker deploy
```

## 1. Отримайте токен alerts.in.ua

Потрібен персональний API token `alerts.in.ua`. Він зберігається **тільки** як Cloudflare secret і не потрапляє у frontend.

## 2. Розгорніть Cloudflare Worker

```bash
cd worker
npm install
npx wrangler login
npx wrangler kv namespace create SUBSCRIPTIONS
```

Вставте отриманий KV `id` у `worker/wrangler.toml` замість `REPLACE_WITH_KV_ID`.

Згенеруйте VAPID keys:

```bash
npm run vapid
```

Додайте secrets:

```bash
npx wrangler secret put ALERTS_TOKEN
npx wrangler secret put INGEST_TOKEN
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
```

`INGEST_TOKEN` — довгий випадковий секрет для прийому моніторингових подій. `VAPID_SUBJECT` — контактний `mailto:` або HTTPS URL.

Deploy:

```bash
npm run deploy
```

Перевірка:

```bash
curl https://YOUR-WORKER.workers.dev/health
```

## 3. Підключіть frontend до Worker

У кореневому `config.js` вставте URL Worker:

```js
apiBaseUrl: 'https://YOUR-WORKER.workers.dev',
```

Для production також змініть у `worker/wrangler.toml`:

```toml
ALLOWED_ORIGIN = "https://XOTT69.github.io"
```

Якщо GitHub Pages використовує project URL, браузерний `Origin` усе одно буде `https://XOTT69.github.io`.

## 4. GitHub Pages

Завантажте вміст цієї папки в корінь репозиторію `XOTT69/RadarUa` і зробіть commit у `main`.

Далі: **Settings → Pages → Source → GitHub Actions**. Workflow `.github/workflows/pages.yml` публікує тільки frontend-файли; backend, bridge і secrets у Pages artifact не потрапляють.

## 5. Свій населений пункт

Після відкриття PWA:

1. Введіть, наприклад, `Чабани`.
2. Оберіть правильний населений пункт зі списку.
3. Задайте радіус, наприклад 25 км.
4. Залиште увімкненим «Показувати тільки мою зону».
5. За бажанням увімкніть моніторинг і Push.

GPS потрібен лише для визначення населеного пункту. Для push backend отримує адміністративний вибір; точна GPS-позиція не зберігається як live location.

## 6. Моніторингові джерела

`telegram-bridge/` є опціональним. Використовуйте лише публічні/дозволені канали, умови яких дозволяють автоматизоване читання/повторне використання. Bridge передає **назву згаданої місцевості**, а Worker сам геокодує її до центра населеного пункту.

Деталі: `telegram-bridge/README.md`.

## Перевірки

```bash
node --check app.js
node --check data/feed.js
node --check worker/src/index.js
cd telegram-bridge && python -m unittest -v test_parser.py
```

Для локального frontend:

```bash
python3 -m http.server 8080
```

Потім відкрийте `http://localhost:8080`.
