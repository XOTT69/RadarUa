import asyncio
import logging
import os
from datetime import timezone
from typing import Any

import httpx
from telethon import TelegramClient, events

from parser import parse_message

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("radarua-telegram")

API_ID = int(os.environ["TG_API_ID"])
API_HASH = os.environ["TG_API_HASH"]
SESSION = os.getenv("TG_SESSION", "radarua")
CHANNELS = [x.strip() for x in os.environ.get("TG_CHANNELS", "").split(",") if x.strip()]
RADAR_API_URL = os.environ["RADAR_API_URL"].rstrip("/")
INGEST_TOKEN = os.environ["RADAR_INGEST_TOKEN"]
TTL_MINUTES = int(os.getenv("EVENT_TTL_MINUTES", "120"))

if not CHANNELS:
    raise RuntimeError("TG_CHANNELS is empty. Add only public/authorized channel usernames or IDs explicitly.")

client = TelegramClient(SESSION, API_ID, API_HASH)
http = httpx.AsyncClient(timeout=12.0, headers={"User-Agent": "RadarUa-Telegram-Bridge/1.0"})


def source_name(event: Any) -> str:
    chat = getattr(event, "chat", None)
    if chat is None:
        return f"telegram:{event.chat_id}"
    username = getattr(chat, "username", None)
    title = getattr(chat, "title", None)
    return f"telegram:@{username}" if username else f"telegram:{title or event.chat_id}"


async def post_event(payload: dict):
    response = await http.post(
        f"{RADAR_API_URL}/api/monitoring/events",
        json=payload,
        headers={"Authorization": f"Bearer {INGEST_TOKEN}"},
    )
    if response.status_code not in (200, 201):
        raise RuntimeError(f"ingest {response.status_code}: {response.text[:300]}")
    return response.json()


@client.on(events.NewMessage(chats=CHANNELS))
async def on_message(event):
    text = event.raw_text or ""
    parsed = parse_message(text)
    if not parsed or not parsed.location:
        return

    timestamp = event.message.date
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)

    # Передаємо лише назву згаданої/цільової місцевості. Worker сам геокодує її
    # до центру населеного пункту і навмисно не приймає live-координати цілі.
    payload = {
        "id": f"tg-{event.chat_id}-{event.message.id}",
        "type": parsed.type,
        "title": parsed.title,
        "detail": parsed.detail,
        "location": parsed.location,
        "course": None,
        "confidence": parsed.confidence,
        "source": source_name(event),
        "timestamp": timestamp.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "ttlMinutes": TTL_MINUTES,
        "meta": {
            "sourceMessageId": f"{event.chat_id}:{event.message.id}",
            "locationInterpretation": "named_or_destination_locality_not_confirmed_target_position",
        },
    }

    try:
        result = await post_event(payload)
        log.info("Ingested %s -> %s (%s)", parsed.type, parsed.location, result.get("event", {}).get("id"))
    except Exception:
        log.exception("Failed to ingest Telegram message %s/%s", event.chat_id, event.message.id)


async def main():
    log.info("Starting bridge for %d explicitly configured channels", len(CHANNELS))
    await client.start()
    me = await client.get_me()
    log.info("Telegram authorized as %s", getattr(me, "username", None) or getattr(me, "id", "unknown"))
    await client.run_until_disconnected()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    finally:
        asyncio.run(http.aclose())
