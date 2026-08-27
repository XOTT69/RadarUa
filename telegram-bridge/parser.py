import re
from dataclasses import dataclass, asdict
from typing import Optional

TYPE_PATTERNS = {
    "drone": re.compile(r"\b(бпла|шахед(?:и|ів)?|shahed(?:s)?|герань|герень)\b", re.I),
    "missile": re.compile(r"\b(ракет\w*|калібр\w*|калибр\w*|кинджал\w*|іскандер\w*|искандер\w*|х[-\s]?101|х[-\s]?555|x[-\s]?101|x[-\s]?555)\b", re.I),
    "aviation": re.compile(r"\b(авіаці\w*|авиаци\w*|ту[-\s]?95|ту[-\s]?160|міг[-\s]?31|миг[-\s]?31|бомбардувальник\w*)\b", re.I),
}

LOCATION_PATTERNS = [
    re.compile(r"(?:курс(?:ом)?|рух|лет(?:ить|ять)|пряму(?:є|ють)|руха(?:є|ю)ться)\s+(?:на|до)\s+([^,.;!\n]{2,60})", re.I),
    re.compile(r"(?:у|в)\s+напрямку\s+(?:на\s+)?([^,.;!\n]{2,60})", re.I),
    re.compile(r"напрямок\s+(?:на\s+)?([^,.;!\n]{2,60})", re.I),
    re.compile(r"(?:біля|поблизу|в\s+районі|у\s+районі|над)\s+([^,.;!\n]{2,60})", re.I),
]

COUNT_RE = re.compile(r"(?<!\d)(\d{1,2})\s*(?:х|x|×)?\s*(?=(?:бпла|шахед|shahed|ракет|калібр|кинджал|іскандер))", re.I)

DIRECTION_MAP = [
    (re.compile(r"\b(північний\s*схід|пн\.?\s*[-/]?\s*сх\.?|північно[-\s]східн\w*)\b", re.I), 45),
    (re.compile(r"\b(південний\s*схід|пд\.?\s*[-/]?\s*сх\.?|південно[-\s]східн\w*)\b", re.I), 135),
    (re.compile(r"\b(південний\s*захід|пд\.?\s*[-/]?\s*зх\.?|південно[-\s]західн\w*)\b", re.I), 225),
    (re.compile(r"\b(північний\s*захід|пн\.?\s*[-/]?\s*зх\.?|північно[-\s]західн\w*)\b", re.I), 315),
    (re.compile(r"\b(північ|пн\.)\b", re.I), 0),
    (re.compile(r"\b(схід|сх\.)\b", re.I), 90),
    (re.compile(r"\b(південь|пд\.)\b", re.I), 180),
    (re.compile(r"\b(захід|зх\.)\b", re.I), 270),
]

TRAILING_NOISE = re.compile(r"\s+(?:област\w*|район\w*|громад\w*)?\s*(?:курс|напрямок|рух|летить|летять).*$", re.I)

@dataclass
class ParsedThreat:
    type: str
    title: str
    detail: str
    location: Optional[str]
    count: Optional[int]
    course: Optional[int]
    confidence: str

    def to_dict(self):
        return asdict(self)


def detect_type(text: str) -> Optional[str]:
    for threat_type, pattern in TYPE_PATTERNS.items():
        if pattern.search(text):
            return threat_type
    return None


def extract_count(text: str) -> Optional[int]:
    match = COUNT_RE.search(text)
    if not match:
        return None
    value = int(match.group(1))
    return value if 1 <= value <= 99 else None


def extract_course(text: str) -> Optional[int]:
    lowered = text.lower()
    course_context = re.search(r"(?:курс|напрямок|рух)[^\n,.]{0,45}", lowered, re.I)
    haystack = course_context.group(0) if course_context else lowered
    for pattern, degrees in DIRECTION_MAP:
        if pattern.search(haystack):
            return degrees
    return None


def clean_location(value: str) -> Optional[str]:
    value = value.strip(" -–—:()[]{}🔴🟠🟡⚠️❗️")
    value = TRAILING_NOISE.sub("", value).strip()
    value = re.sub(r"\s+", " ", value)
    value = re.sub(r"\b(?:обережно|увага|можливо)$", "", value, flags=re.I).strip()
    if len(value) < 2 or len(value) > 60:
        return None
    if any(p.fullmatch(value) for p in TYPE_PATTERNS.values()):
        return None
    return value


def extract_location(text: str) -> Optional[str]:
    for pattern in LOCATION_PATTERNS:
        match = pattern.search(text)
        if match:
            location = clean_location(match.group(1))
            if location:
                return location
    return None


def parse_message(text: str) -> Optional[ParsedThreat]:
    if not text or not text.strip():
        return None
    normalized = re.sub(r"\s+", " ", text.strip())
    threat_type = detect_type(normalized)
    if not threat_type:
        return None
    count = extract_count(normalized)
    location = extract_location(normalized)
    course = extract_course(normalized)
    label = {"drone": "БПЛА", "missile": "Ракета", "aviation": "Авіація"}[threat_type]
    title = f"{count}× {label}" if count and count > 1 else label
    return ParsedThreat(
        type=threat_type,
        title=title,
        detail=normalized[:700],
        location=location,
        count=count,
        course=course,
        confidence="medium" if location else "low",
    )
