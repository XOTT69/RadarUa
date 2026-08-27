# Telegram bridge — RadarUa Final 1.0

Опціональний bridge читає **лише явно перелічені публічні/дозволені Telegram-канали**, знаходить повідомлення з типом загрози та назвою місцевості й надсилає нормалізовану подію у RadarUa Worker.

Він не надсилає live-координати або вектор руху. Backend геокодує лише назву згаданої/цільової місцевості до її центра.

## 1. Telegram API credentials

Створіть `api_id` / `api_hash` для власного Telegram client за офіційною процедурою Telegram. Не публікуйте `api_hash` та session-файл.

## 2. Налаштування

```bash
cp .env.example .env
```

Заповніть:

```env
TG_API_ID=123456
TG_API_HASH=...
TG_SESSION=radarua
TG_CHANNELS=@public_channel_1,@public_channel_2
RADAR_API_URL=https://YOUR-WORKER.workers.dev
RADAR_INGEST_TOKEN=...
EVENT_TTL_MINUTES=120
```

Використовуйте лише джерела, для яких у вас є право/дозвіл на автоматизоване читання та повторне використання даних.

## 3. Запуск без Docker

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python bridge.py
```

Перший запуск Telethon попросить авторизувати Telegram-акаунт і створить session-файл. Він у `.gitignore`.

## Docker

```bash
mkdir -p sessions
cp docker-compose.example.yml docker-compose.yml
docker compose up -d --build
```

## Parser tests

```bash
python -m unittest -v test_parser.py
```
