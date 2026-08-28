#!/usr/bin/env python3
"""Dependency-free static release checks for RadarUa."""
from __future__ import annotations

import json
import re
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
errors: list[str] = []


def fail(message: str) -> None:
    errors.append(message)


# Parse core config files.
for rel in ("manifest.webmanifest", "worker/package.json"):
    try:
        json.loads((ROOT / rel).read_text(encoding="utf-8"))
    except Exception as exc:
        fail(f"Invalid JSON {rel}: {exc}")
try:
    with (ROOT / "worker/wrangler.toml").open("rb") as fh:
        tomllib.load(fh)
except Exception as exc:
    fail(f"Invalid TOML worker/wrangler.toml: {exc}")

# Ensure app.js only addresses DOM ids that exist in index.html.
try:
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    js = (ROOT / "app.js").read_text(encoding="utf-8")
    ids = set(re.findall(r'id=["\']([^"\']+)', html))
    used = set(re.findall(r'getElementById\(["\']([^"\']+)', js))
    missing = sorted(used - ids)
    if missing:
        fail(f"Missing DOM ids referenced by app.js: {missing}")
except Exception as exc:
    fail(f"DOM consistency check failed: {exc}")

# Telegram-only runtime must not silently regain an air-alert API dependency.
runtime_paths = [
    ROOT / "app.js", ROOT / "data/feed.js", ROOT / "sw.js",
    ROOT / "worker/src/index.js", ROOT / "worker/wrangler.toml",
    ROOT / "telegram-bridge/bridge.py", ROOT / "telegram-bridge/parser.py",
]
stale = re.compile(r"alerts\.in\.ua|UkraineAlarm|ALERTS_TOKEN|ALERTS_URL", re.I)
for path in runtime_paths:
    text = path.read_text(encoding="utf-8", errors="ignore")
    if stale.search(text):
        fail(f"Stale air-alert API runtime reference in {path.relative_to(ROOT)}")

# Do not ship generated Python cache or obvious credentials.
bot_token = re.compile(r"\b\d{8,12}:[A-Za-z0-9_-]{30,}\b")
for path in ROOT.rglob("*"):
    if path.is_dir():
        if path.name == "__pycache__":
            fail(f"Python cache directory present: {path.relative_to(ROOT)}")
        continue
    if path.suffix.lower() in {".png", ".zip"} or path.resolve() == Path(__file__).resolve():
        continue
    text = path.read_text(encoding="utf-8", errors="ignore")
    if "-----BEGIN PRIVATE KEY-----" in text or bot_token.search(text):
        fail(f"Potential committed secret in {path.relative_to(ROOT)}")

# Release-critical files.
required = [
    "index.html", "app.js", "styles.css", "config.js", "sw.js", "manifest.webmanifest",
    "data/feed.js", "worker/src/index.js", "telegram-bridge/bridge.py",
    "telegram-bridge/parser.py", ".github/workflows/pages.yml",
]
for rel in required:
    if not (ROOT / rel).is_file():
        fail(f"Missing release file: {rel}")

if errors:
    for message in errors:
        print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)
print("RadarUa release checks: OK")
