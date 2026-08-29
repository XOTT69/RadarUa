# Release 2.1.0

Milestone: **public Telegram monitoring + свій населений пункт + realtime**.

## Public Telegram collector

- Replaced the always-on Telethon bridge requirement with a Cloudflare Cron collector for configured public `t.me/s/<channel>` pages.
- No VPS, Telegram API credentials, Telegram session or paid hosting is required.
- The collector polls every two minutes; it can be delayed or unavailable if Telegram changes or blocks its public web pages.

Архітектура:
`explicit public Telegram sources → Cloudflare Cron → Durable Object → WebSocket → PWA`
