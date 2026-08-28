"""Send a coarse named-locality test event to a deployed RadarUa Telegram-only Worker."""
import json
import os
import sys
import urllib.request

base = os.environ.get("RADAR_API_URL", "").rstrip("/")
token = os.environ.get("RADAR_INGEST_TOKEN", "")
source = os.environ.get("RADAR_TEST_SOURCE", "manual-test")
location = " ".join(sys.argv[1:]).strip()
if not base or not token or not location:
    raise SystemExit("Usage: RADAR_API_URL=https://... RADAR_INGEST_TOKEN=... python tools/send_test_event.py <населений пункт>")

payload = json.dumps({
    "id": "manual-test-" + location.lower().replace(" ", "-"),
    "type": "drone",
    "title": "Тестова Telegram-подія",
    "detail": f"Тест near-realtime для зони: {location}",
    "location": location,
    "source": source,
    "ttlMinutes": 10,
    "meta": {"sourceChannel": source, "sourceMessageId": "manual:test"},
}).encode()
request = urllib.request.Request(
    base + "/api/monitoring/events",
    data=payload,
    method="POST",
    headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
)
with urllib.request.urlopen(request, timeout=15) as response:
    print(response.read().decode())
