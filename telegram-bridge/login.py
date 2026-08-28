"""Run locally once to generate a Telegram StringSession.
Never commit the printed session string; store it in your host's secret manager as TG_SESSION_STRING.
"""
import asyncio
import os
from getpass import getpass
from telethon import TelegramClient
from telethon.sessions import StringSession

async def main():
    api_id = int(os.environ.get("TG_API_ID") or input("TG_API_ID: ").strip())
    api_hash = os.environ.get("TG_API_HASH") or getpass("TG_API_HASH: ")
    phone = os.environ.get("TG_PHONE") or input("Phone (+380...): ").strip()
    client = TelegramClient(StringSession(), api_id, api_hash)
    await client.start(phone=phone)
    print("\nTG_SESSION_STRING (SECRET):\n")
    print(client.session.save())
    await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())
