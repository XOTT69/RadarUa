"""Send a coarse named-locality test event to a deployed RadarUa Final 1.0 Worker."""
import json
import os
import sys
import urllib.request

base = os.environ.get("RADAR_API_URL", "").rstrip("/")
token = os.environ.get("RADAR_INGEST_TOKEN", "")
location = " ".join(sys.argv[1:]).strip()
if not base or not token or not location:
    raise SystemExit("Usage: RADAR_API_URL=https://... RADAR_INGEST_TOKEN=... python tools/send_test_event.py <населений пункт>")

payload = json.dumps({
    "type": "drone",
    "title": "Тестове моніторингове повідомлення",
    "detail": f"Тест для перевірки персональної зони: {location}",
    "location": location,
    "source": "manual-test",
    "ttlMinutes": 10,
}).encode()
request = urllib.request.Request(
    base + "/api/monitoring/events",
    data=payload,
    method="POST",
    headers={"Content-Type": "application/json", "Authorization": "Bearer " + token},
)
with urllib.request.urlopen(request, timeout=15) as response:
    print(response.read().decode())
