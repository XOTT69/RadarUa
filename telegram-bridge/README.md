# RadarUa Telegram bridge

Це near-realtime джерело RadarUa. Воно читає **лише явно задані** Telegram-канали через MTProto, парсить нові/відредаговані повідомлення та передає події у Cloudflare Worker.

## Чому не Bot API
Для сторонніх публічних каналів бот зазвичай не отримує всі `channel_post`, якщо його не додали до каналу. Для моніторингу явно дозволених/публічних джерел тут використовується user-authorized MTProto client (Telethon).

## Перший вхід
1. Створіть власні `api_id` і `api_hash` на `my.telegram.org` → **API development tools**.
2. Локально встановіть залежності: `pip install -r requirements.txt`.
3. Запустіть `python login.py`.
4. Введіть номер, код Telegram і 2FA-пароль, якщо він увімкнений.
5. Отриманий `TG_SESSION_STRING` збережіть як **secret** у хостингу. Не додавайте його в GitHub.

## Надійність
- `NewMessage` + `MessageEdited`.
- backfill останніх повідомлень після рестарту;
- SQLite outbox: подія не губиться, якщо Worker тимчасово недоступний;
- exponential retry;
- heartbeat раз на 30 секунд;
- deterministic message IDs — повторна доставка не створює дубль;
- 5-хвилинний контекст на канал: короткі пости на кшталт «Курсом на Васильків» можуть успадкувати тип загрози лише від недавнього явного повідомлення того самого каналу.

## Запуск Docker
Скопіюйте `.env.example` у `.env` і заповніть значення. У `TG_CHANNELS` вкажіть лише ті публічні/дозволені джерела, які ви свідомо обрали та маєте право використовувати. Акаунт Telegram має бути підписаний на ці канали для надійних live-updates. `AUTO_JOIN_CHANNELS=false` за замовчуванням.

Запуск:

```bash
docker compose -f docker-compose.example.yml up -d --build
```

Bridge має працювати на **always-on** хості (VPS/Render/Railway/Fly тощо). GitHub Pages не може сам постійно слухати Telegram.

## Важливо
Подія на карті — це центр **названого/цільового населеного пункту**, який згаданий у повідомленні. Це не телеметрія і не точна координата повітряної цілі.
