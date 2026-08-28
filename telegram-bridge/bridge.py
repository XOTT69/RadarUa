import asyncio
import json
import logging
import os
import sqlite3
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import httpx
from telethon import TelegramClient, events
from telethon.sessions import StringSession
from telethon.tl.functions.channels import JoinChannelRequest

from parser import parse_message, detect_type

BRIDGE_VERSION = "2.0.0"
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("radarua-telegram")

API_ID = int(os.environ["TG_API_ID"])
API_HASH = os.environ["TG_API_HASH"]
SESSION_STRING = os.getenv("TG_SESSION_STRING", "").strip()
SESSION_PATH = os.getenv("TG_SESSION", "/data/radarua")
CHANNELS = [x.strip() for x in os.environ.get("TG_CHANNELS", "").split(",") if x.strip()]
RADAR_API_URL = os.environ["RADAR_API_URL"].rstrip("/")
INGEST_TOKEN = os.environ["RADAR_INGEST_TOKEN"]
BACKFILL_MESSAGES = max(0, min(100, int(os.getenv("BACKFILL_MESSAGES", "20"))))
MAX_MESSAGE_AGE_MINUTES = max(5, min(1440, int(os.getenv("MAX_MESSAGE_AGE_MINUTES", "180"))))
HEARTBEAT_SECONDS = max(15, min(300, int(os.getenv("HEARTBEAT_SECONDS", "30"))))
QUEUE_DB = Path(os.getenv("QUEUE_DB", "/data/outbox.sqlite3"))
BRIDGE_ID = os.getenv("BRIDGE_ID", "primary")[:80]
CONTEXT_TTL_SECONDS = max(60, min(900, int(os.getenv("CONTEXT_TTL_SECONDS", "300"))))
AUTO_JOIN_CHANNELS = os.getenv("AUTO_JOIN_CHANNELS", "false").strip().lower() in {"1", "true", "yes", "on"}

if not CHANNELS:
    raise RuntimeError("TG_CHANNELS is empty. Configure public/authorized channel usernames or IDs explicitly.")

QUEUE_DB.parent.mkdir(parents=True, exist_ok=True)

def make_client():
    if SESSION_STRING:
        return TelegramClient(StringSession(SESSION_STRING), API_ID, API_HASH, auto_reconnect=True, connection_retries=None)
    Path(SESSION_PATH).parent.mkdir(parents=True, exist_ok=True)
    return TelegramClient(SESSION_PATH, API_ID, API_HASH, auto_reconnect=True, connection_retries=None)

client = make_client()
http = httpx.AsyncClient(timeout=15.0, headers={"User-Agent": f"RadarUa-Telegram-Bridge/{BRIDGE_VERSION}"})
started_at = datetime.now(timezone.utc)
channel_state: dict[str, dict[str, Any]] = {}
channel_context: dict[str, dict[str, Any]] = {}


def db_conn():
    conn = sqlite3.connect(QUEUE_DB)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""
        CREATE TABLE IF NOT EXISTS outbox (
            id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL,
            attempts INTEGER NOT NULL DEFAULT 0,
            next_attempt REAL NOT NULL DEFAULT 0
        )
    """)
    conn.commit()
    return conn


def queue_upsert(event_id: str, payload: dict):
    with db_conn() as conn:
        conn.execute(
            "INSERT INTO outbox(id,payload,created_at,attempts,next_attempt) VALUES(?,?,?,?,0) "
            "ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, next_attempt=0",
            (event_id, json.dumps(payload, ensure_ascii=False), datetime.now(timezone.utc).isoformat(), 0),
        )
        conn.commit()


def queue_due(limit: int = 30):
    now = datetime.now().timestamp()
    with db_conn() as conn:
        rows = conn.execute(
            "SELECT id,payload,attempts FROM outbox WHERE next_attempt <= ? ORDER BY created_at ASC LIMIT ?",
            (now, limit),
        ).fetchall()
    return [(r[0], json.loads(r[1]), int(r[2])) for r in rows]


def queue_done(event_id: str):
    with db_conn() as conn:
        conn.execute("DELETE FROM outbox WHERE id=?", (event_id,))
        conn.commit()


def queue_retry(event_id: str, attempts: int):
    delay = min(300, 2 ** min(attempts + 1, 8))
    with db_conn() as conn:
        conn.execute(
            "UPDATE outbox SET attempts=?, next_attempt=? WHERE id=?",
            (attempts + 1, datetime.now().timestamp() + delay, event_id),
        )
        conn.commit()


def queue_depth() -> int:
    with db_conn() as conn:
        return int(conn.execute("SELECT COUNT(*) FROM outbox").fetchone()[0])


def source_info(event: Any) -> dict[str, Any]:
    chat = getattr(event, "chat", None)
    username = getattr(chat, "username", None) if chat else None
    title = getattr(chat, "title", None) if chat else None
    chat_id = str(getattr(chat, "id", None) or getattr(event, "chat_id", "unknown"))
    name = f"@{username}" if username else (title or chat_id)
    url = f"https://t.me/{username}/{event.message.id}" if username else None
    return {"id": chat_id, "name": name, "title": title or name, "username": username, "url": url}


def source_key(chat: Any) -> str:
    username = getattr(chat, "username", None)
    return f"@{username}" if username else str(getattr(chat, "id", "unknown"))


def touch_channel(event: Any):
    info = source_info(event)
    current = channel_state.get(info["id"], {})
    channel_state[info["id"]] = {
        **current,
        **{k: v for k, v in info.items() if k != "url"},
        "lastMessageAt": datetime.now(timezone.utc).isoformat(),
        "lastMessageId": int(event.message.id),
    }


def payloads_for_event(event: Any, edited: bool = False) -> list[dict]:
    text = event.raw_text or ""
    channel_id = source_info(event)["id"]
    now = datetime.now(timezone.utc)
    explicit_type = detect_type(text)
    inherited_type = None
    previous = channel_context.get(channel_id)
    if previous and (now - previous["at"]).total_seconds() <= CONTEXT_TTL_SECONDS:
        inherited_type = previous.get("type")
    parsed_items = parse_message(text, inherited_type=inherited_type)
    if explicit_type in {"drone", "missile", "kab", "aviation"}:
        channel_context[channel_id] = {"type": explicit_type, "at": now}
    elif explicit_type == "clear":
        channel_context.pop(channel_id, None)
    if not parsed_items:
        return []

    timestamp = event.message.date or datetime.now(timezone.utc)
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    source = source_info(event)
    payloads = []
    for index, parsed in enumerate(parsed_items):
        event_id = f"tg-{source['id']}-{event.message.id}-{index}"
        payloads.append({
            "id": event_id,
            "type": parsed.type,
            "title": parsed.title,
            "detail": parsed.detail,
            "location": parsed.location,
            "course": parsed.course,
            "confidence": parsed.confidence,
            "source": source["name"],
            "timestamp": timestamp.astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
            "ttlMinutes": parsed.ttl_minutes,
            "meta": {
                "count": parsed.count,
                "locationRole": parsed.location_role,
                "sourceMessageId": f"{source['id']}:{event.message.id}",
                "sourceUrl": source["url"],
                "sourceChannelId": source["id"],
                "sourceChannel": source["name"],
                "edited": bool(edited),
                "parserVersion": BRIDGE_VERSION,
                "inheritedType": bool(not explicit_type and inherited_type),
                "locationInterpretation": "named_or_destination_locality_not_confirmed_target_position",
            },
        })
    return payloads


async def enqueue_event(event: Any, edited: bool = False):
    touch_channel(event)
    payloads = payloads_for_event(event, edited=edited)
    for payload in payloads:
        queue_upsert(payload["id"], payload)
    if payloads:
        log.info("Queued %d event(s) from %s message %s", len(payloads), source_info(event)["name"], event.message.id)


async def post_ingest(payload: dict):
    response = await http.post(
        f"{RADAR_API_URL}/api/monitoring/events",
        json=payload,
        headers={"Authorization": f"Bearer {INGEST_TOKEN}"},
    )
    if response.status_code not in (200, 201):
        raise RuntimeError(f"ingest {response.status_code}: {response.text[:300]}")
    return response.json()


async def flush_loop():
    while True:
        rows = queue_due()
        if not rows:
            await asyncio.sleep(2)
            continue
        for event_id, payload, attempts in rows:
            try:
                result = await post_ingest(payload)
                queue_done(event_id)
                merged = result.get("merged", False) if isinstance(result, dict) else False
                log.info("Sent %s%s", event_id, " (merged)" if merged else "")
            except Exception as error:
                queue_retry(event_id, attempts)
                log.warning("Send failed for %s: %s", event_id, error)
        await asyncio.sleep(0.2)


async def heartbeat_loop():
    while True:
        body = {
            "bridgeId": BRIDGE_ID,
            "version": BRIDGE_VERSION,
            "startedAt": started_at.isoformat(),
            "queueDepth": queue_depth(),
            "telegramConnected": bool(client.is_connected()),
            "channels": sorted(channel_state.values(), key=lambda x: x.get("name", "")),
            "time": datetime.now(timezone.utc).isoformat(),
        }
        try:
            response = await http.post(
                f"{RADAR_API_URL}/api/bridge/heartbeat",
                json=body,
                headers={"Authorization": f"Bearer {INGEST_TOKEN}"},
            )
            if response.status_code not in (200, 201):
                log.warning("Heartbeat %s: %s", response.status_code, response.text[:200])
        except Exception as error:
            log.warning("Heartbeat failed: %s", error)
        await asyncio.sleep(HEARTBEAT_SECONDS)


async def resolve_channels():
    resolved = []
    for configured in CHANNELS:
        try:
            entity = await client.get_entity(configured)
            key = str(getattr(entity, "id", configured))
            username = getattr(entity, "username", None)
            title = getattr(entity, "title", None) or configured
            channel_state[key] = {
                "id": key,
                "name": f"@{username}" if username else title,
                "title": title,
                "username": username,
                "lastMessageAt": None,
                "lastMessageId": None,
            }
            resolved.append(entity)
            log.info("Source ready: %s", channel_state[key]["name"])
        except Exception as error:
            log.error("Cannot resolve source %s: %s", configured, error)
    if not resolved:
        raise RuntimeError("None of TG_CHANNELS could be resolved")
    return resolved


async def ensure_realtime_membership(entities):
    dialogs = await client.get_dialogs()
    joined_ids = {str(getattr(d.entity, "id", "")) for d in dialogs}
    for entity in entities:
        eid = str(getattr(entity, "id", ""))
        if eid in joined_ids:
            continue
        name = source_key(entity)
        if AUTO_JOIN_CHANNELS and getattr(entity, "username", None):
            try:
                await client(JoinChannelRequest(entity))
                log.info("Joined %s because AUTO_JOIN_CHANNELS=true", name)
            except Exception as error:
                log.warning("Could not join %s: %s", name, error)
        else:
            log.warning("%s is not in this account's dialogs. Backfill may work, but live updates can be missed. Join it in Telegram or enable AUTO_JOIN_CHANNELS explicitly.", name)


async def backfill(entities):
    if BACKFILL_MESSAGES <= 0:
        return
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=MAX_MESSAGE_AGE_MINUTES)
    for entity in entities:
        try:
            messages = [m async for m in client.iter_messages(entity, limit=BACKFILL_MESSAGES)]
            for message in reversed(messages):
                if not message.date or message.date.astimezone(timezone.utc) < cutoff:
                    continue
                # Build a light event-like object that matches what our helpers use.
                class Wrap:
                    pass
                wrapper = Wrap()
                wrapper.message = message
                wrapper.raw_text = message.raw_text or ""
                wrapper.chat_id = getattr(entity, "id", None)
                wrapper.chat = entity
                await enqueue_event(wrapper, edited=False)
            log.info("Backfill complete for %s", source_key(entity))
        except Exception as error:
            log.warning("Backfill failed for %s: %s", source_key(entity), error)


async def main():
    # Interactive first authorization is intentionally done outside unattended hosting.
    # Use login.py to create TG_SESSION_STRING, then store it as a secret.
    if SESSION_STRING:
        await client.connect()
        if not await client.is_user_authorized():
            raise RuntimeError("TG_SESSION_STRING is invalid/not authorized. Run login.py again.")
    else:
        await client.start()

    me = await client.get_me()
    log.info("Telegram authorized as %s", getattr(me, "username", None) or getattr(me, "id", "unknown"))
    entities = await resolve_channels()
    await ensure_realtime_membership(entities)

    @client.on(events.NewMessage(chats=entities))
    async def on_new_message(event):
        await enqueue_event(event, edited=False)

    @client.on(events.MessageEdited(chats=entities))
    async def on_edited_message(event):
        await enqueue_event(event, edited=True)

    await backfill(entities)
    tasks = [
        asyncio.create_task(flush_loop(), name="flush"),
        asyncio.create_task(heartbeat_loop(), name="heartbeat"),
    ]
    try:
        await client.run_until_disconnected()
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        await http.aclose()


if __name__ == "__main__":
    asyncio.run(main())
