# Release 3.0.0

Milestone: **офіційні тривоги + свій населений пункт + realtime monitoring**.

Архітектура:
`alerts.in.ua → Worker → PWA`
`explicit Telegram sources → Telethon bridge → protected ingest → Durable Object → WebSocket → PWA`
