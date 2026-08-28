# RadarUa Telegram-only implementation plan

## Goal
Run RadarUa before any official air-alert API is connected. Telegram is the event feed; users can focus on their own locality and radius. Official alerts can be added later as a separate provider without redesigning the frontend.

## 1. Ingest
- Use Telegram MTProto through Telethon, not HTML scraping.
- Explicit source list in `TG_CHANNELS`.
- User-authorized session generated once with `login.py`.
- Listen to new and edited posts.
- Backfill a small, age-limited window after restart.
- Warn when configured channels are not joined; auto-join requires explicit opt-in.

## 2. Parsing
- Conservative type detection: UAV, missile/ballistics, KAB, aviation, explosions/PPO, clear.
- Extract count, named locality, location role and compass direction metadata.
- Do not turn compass text into projected flight tracks.
- Preserve source text for audit/debugging.
- Per-channel 5-minute context only for route/locality-only follow-up posts.
- Context is cleared on source-reported clear and never inherited across channels.

## 3. Delivery reliability
- Deterministic event ids from channel + Telegram message + extracted locality index.
- SQLite outbox before network delivery.
- Retry with bounded exponential backoff.
- Heartbeat every ~30 sec with channel list, queue depth and Telegram connection state.

## 4. Backend
- Bearer-protected ingest and heartbeat endpoints.
- Validate event type/body/timestamp/coordinate range.
- Optional source allowlist.
- Durable Object for event state, WebSockets, geocode serialization, heartbeat state.
- Event TTL by threat type; stale events disappear automatically.

## 5. Geocoding
- Named localities are mapped to their centroid only.
- Public Nominatim: manual user search only; no autocomplete; <=1 req/s; 7-day cache.
- Regional Ukrainian forms are canonicalized to oblast names and treated administratively, not by centroid-distance.
- If geocoding fails, the event can remain in the global timeline but may not qualify for radius-based locality filtering.

## 6. Dedupe / corroboration
- Exact message update replaces/merges its deterministic event.
- Cross-channel same type + same locality within 6 min merges.
- Preserve source list/message links.
- `sourceCount >= 2` raises confidence/corroboration rather than creating overlapping markers.
- A duplicate does not send a second initial push.

## 7. “My locality”
- Save a geocoded locality locally in browser storage.
- Save only the locality centroid/admin metadata for push targeting; do not continuously upload live GPS.
- Radius 5–100 km.
- Regional events match selected oblast first; locality events use radius/text match.

## 8. Frontend truthfulness
- Never label a zone “safe” based on Telegram silence.
- Show feed health: online / stale / offline.
- Show source count/corroboration.
- Label markers as approximate named-locality points.
- Separate source-reported clear from an official all-clear.

## 9. Push
- Optional and independent of map realtime.
- Filter by saved locality/radius.
- Clear messages explicitly say they are source-reported, not an official all-clear.
- Dedup prevents repeated pushes for the same cross-channel event.

## 10. Failure modes
- Telegram disconnected → heartbeat becomes stale/offline in PWA.
- Worker down → bridge queues events locally and retries.
- Bridge restart → backfill closes the short gap.
- Geocoder down/rate-limited → event retained without fabricated coordinates.
- WebSocket down → 15s polling remains as fallback.
- PWA offline → app shell remains available; old feed must not be presented as current without freshness indicators.

## 11. Later official API integration
Add an `official-alerts` provider into Worker and keep Telegram events as a separate source class. Do not change event coordinate semantics or use Telegram silence as an official status.
