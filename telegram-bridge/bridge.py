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
    raise RuntimeError("TG_CHANNELS is empty. Add public channel usernames/IDs explicitly.")

client = TelegramClient(SESSION, API_ID, API_HASH)
http = httpx.AsyncClient(timeout=12.0, headers={"User-Agent": "RadarUa-Telegram-Bridge/3.0"})


def source_name(event: Any) -> str:
    chat = getattr(event, "chat", None)
    if chat is None:
        return f"telegram:{event.chat_id}"
    username = getattr(chat, "username", None)
    title = getattr(chat, "title", None)
    return f"telegram:@{username}" if username else f"telegram:{title or event.chat_id}"


async def best_place(location: str):
    try:
        response = await http.get(f"{RADAR_API_URL}/api/places", params={"q": location})
        response.raise_for_status()
        items = response.json().get("items", [])
        if not items:
            return None
        target = location.casefold().strip()
        exact = [p for p in items if str(p.get("name", "")).casefold().strip() == target]
        return (exact or items)[0]
    except Exception as exc:
        log.warning("Geocoding failed for %r: %s", location, exc)
        return None


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
    if not parsed:
        return

    place = await best_place(parsed.location) if parsed.location else None
    timestamp = event.message.date
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)

    payload = {
        "id": f"tg-{event.chat_id}-{event.message.id}",
        "type": parsed.type,
        "title": parsed.title,
        "detail": parsed.detail,
        "location": parsed.location,
        "course": parsed.course,
        "confidence": "medium" if place else parsed.confidence,
        "source": source_name(event),
        "timestamp": timestamp.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
        "ttlMinutes": TTL_MINUTES,
        "meta": {
            "monitoring": True,
            "telegramChatId": str(event.chat_id),
            "telegramMessageId": event.message.id,
            "count": parsed.count,
            "parser": "radarua-v3",
            "locationInterpretation": "named_or_destination_location_not_confirmed_target_position",
        },
    }
    if place:
        payload.update({"lat": place["lat"], "lon": place["lon"]})
        payload["meta"].update({
            "geocodedPlace": place.get("name"),
            "oblast": place.get("oblast", ""),
            "district": place.get("district", ""),
            "hromada": place.get("hromada", ""),
        })

    try:
        result = await post_event(payload)
        log.info("Ingested %s %s (%s)", parsed.type, parsed.location or "without location", result.get("event", {}).get("id"))
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
