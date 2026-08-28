import re
from dataclasses import dataclass, asdict
from typing import Optional, List

# Parser is intentionally conservative: it extracts what a monitoring source says,
# not a "true" live coordinate of an object.
TYPE_PATTERNS = [
    ("clear", re.compile(r"\b(відбій|загроза\s+минула|загрозу\s+скасовано|чисто\s+по)\b", re.I)),
    ("kab", re.compile(r"\b(каб(?:и|ів|ами)?|фаб[-\s]?(?:250|500|1500)|умпк|керован\w*\s+авіабомб\w*)\b", re.I)),
    ("missile", re.compile(r"\b(ракет\w*|баліст\w*|калібр\w*|калибр\w*|кинджал\w*|іскандер\w*|искандер\w*|циркон\w*|онікс\w*|оникс\w*|х[-\s]?(?:101|555|59|69)|x[-\s]?(?:101|555|59|69))\b", re.I)),
    ("drone", re.compile(r"\b(бпла|шахед(?:и|ів|ами)?|shahed(?:s)?|герань\w*|дрон(?:и|ів|ами)?)\b", re.I)),
    ("aviation", re.compile(r"\b(авіаці\w*|авиаци\w*|ту[-\s]?(?:95|160|22)(?:мс|м\d)?|міг[-\s]?31|миг[-\s]?31|су[-\s]?(?:24|34|35)|бомбардувальник\w*|тактичн\w*\s+авіаці\w*)\b", re.I)),
    ("explosion", re.compile(r"\b(вибух(?:и|ів)?|ппо\s+(?:працює|працювала|працюють)|робота\s+ппо)\b", re.I)),
]

COUNT_RE = re.compile(
    r"(?<!\d)(\d{1,2})\s*(?:х|x|×)?\s*(?=(?:бпла|шахед|shahed|дрон|ракет|калібр|кинджал|іскандер|каб|фаб))",
    re.I,
)

# The first group is a semantic hint for how the named locality should be interpreted.
LOCATION_PATTERNS = [
    ("attention", re.compile(r"^\s*([А-ЯІЇЄҐA-Z][^,.;!\n—–:-]{1,48})\s*[—–:-]\s*(?:увага|уважно|обережно)", re.I)),
    ("destination", re.compile(r"(?:бпла|шахед(?:и|ів|ами)?|shahed(?:s)?|дрон(?:и|ів|ами)?|ракет\w*|каб(?:и|ів|ами)?)\s+(?:на|до)\s+([^,.;!\n]{2,64})", re.I)),
    ("destination", re.compile(r"(?:курс(?:ом)?|пряму(?:є|ють)|руха(?:є|ю)ться|лет(?:ить|ять)|йд(?:е|уть)|у\s+напрямку|в\s+напрямку|напрямок)\s*(?:на|до|в\s+бік|у\s+бік)?\s+([^,.;!\n]{2,64})", re.I)),
    ("destination", re.compile(r"(?:курс|рух)\s+([^,.;!\n]{2,64})", re.I)),
    ("near", re.compile(r"(?:біля|поблизу|над|в\s+районі|у\s+районі|районі|район)\s+([^,.;!\n]{2,64})", re.I)),
    ("route", re.compile(r"(?:через)\s+([^,.;!\n]{2,64})", re.I)),
]

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

NOISE_TAIL = re.compile(
    r"\s+(?:обережно|увага|можливо|орієнтовно|далі|курс|напрямок|рух|летить|летять|прямує|прямують|рухається|рухаються|залишайтесь|укриття)\b.*$",
    re.I,
)
ADMIN_TAIL = re.compile(r"\s+(?:області|область|району|район|громади|громада)$", re.I)

TTL_BY_TYPE = {
    "drone": 90,
    "missile": 45,
    "kab": 45,
    "aviation": 180,
    "explosion": 30,
    "clear": 20,
}

LABELS = {
    "drone": "БПЛА",
    "missile": "Ракета",
    "kab": "КАБ",
    "aviation": "Авіація",
    "explosion": "Вибухи / ППО",
    "clear": "Відбій / зниження загрози",
}

@dataclass
class ParsedThreat:
    type: str
    title: str
    detail: str
    location: Optional[str]
    location_role: Optional[str]
    count: Optional[int]
    course: Optional[int]
    confidence: str
    ttl_minutes: int

    def to_dict(self):
        return asdict(self)


def detect_type(text: str) -> Optional[str]:
    for threat_type, pattern in TYPE_PATTERNS:
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
    # Compass direction is kept as metadata only. It is not used to extrapolate a track.
    context = re.search(r"(?:курс|напрямок|рух)[^\n,.]{0,55}", text, re.I)
    haystack = context.group(0) if context else text
    for pattern, degrees in DIRECTION_MAP:
        if pattern.search(haystack):
            return degrees
    return None


def clean_location(value: str) -> Optional[str]:
    value = value.strip(" -–—:()[]{}🔴🟠🟡⚠️❗️➡️👉")
    value = re.sub(r"^(?:м|с|смт)\.?\s+", "", value, flags=re.I)
    value = NOISE_TAIL.sub("", value).strip()
    value = re.sub(r"\s+(?:зі|з|із)\s+(?:півночі|півдня|сходу|заходу|північного\s+сходу|південного\s+сходу|північного\s+заходу|південного\s+заходу)$", "", value, flags=re.I).strip()
    # Trim trailing threat words accidentally captured by permissive formats.
    value = re.split(r"\s+(?:\d{1,2}\s*)?(?:бпла|шахед|дрон|ракет|каб)\b", value, maxsplit=1, flags=re.I)[0].strip()
    value = re.sub(r"\s+", " ", value)
    value = ADMIN_TAIL.sub("", value).strip()
    if len(value) < 2 or len(value) > 64:
        return None
    if re.fullmatch(r"(?:на|до|в|у|бік|напрямок|курс|(?:на\s+)?(?:північ|південь|схід|захід|пн\.?|пд\.?|сх\.?|зх\.?))", value, re.I):
        return None
    # Avoid treating a pure threat keyword as a locality.
    if any(pattern.fullmatch(value) for _, pattern in TYPE_PATTERNS):
        return None
    return value


def extract_locations(text: str) -> List[tuple[str, str]]:
    found: List[tuple[str, str]] = []
    seen = set()
    for role, pattern in LOCATION_PATTERNS:
        for match in pattern.finditer(text):
            raw = match.group(1)
            # Some channels list a couple of targets after one direction marker.
            chunks = re.split(r"\s*(?:/|→|➡️|\s+та\s+|\s+і\s+)\s*", raw, maxsplit=2, flags=re.I)
            for chunk in chunks:
                location = clean_location(chunk)
                key = location.lower() if location else None
                if location and key not in seen:
                    seen.add(key)
                    found.append((location, role))
    return found[:3]


def parse_message(text: str, inherited_type: Optional[str] = None) -> List[ParsedThreat]:
    if not text or not text.strip():
        return []
    normalized = re.sub(r"\b([мс])\.\s*", r"\1 ", text.strip(), flags=re.I)
    normalized = re.sub(r"\s+", " ", normalized)
    explicit_type = detect_type(normalized)
    locations = extract_locations(normalized)
    threat_type = explicit_type
    if not threat_type and inherited_type in {"drone", "missile", "kab", "aviation"} and locations:
        # Context inheritance is allowed only when the current post itself contains
        # a route/locality cue; bridge.py limits how long that context survives.
        threat_type = inherited_type
    if not threat_type:
        return []

    count = extract_count(normalized)
    course = extract_course(normalized)
    label = LABELS[threat_type]
    title = f"{count}× {label}" if count and count > 1 else label
    detail = normalized[:900]

    if not locations:
        # Keep global/source-level events for the all-events view, but they will not
        # be considered local until a named locality can be geocoded.
        return [ParsedThreat(
            type=threat_type,
            title=title,
            detail=detail,
            location=None,
            location_role=None,
            count=count,
            course=course,
            confidence="low",
            ttl_minutes=TTL_BY_TYPE[threat_type],
        )]

    result = []
    for location, role in locations:
        result.append(ParsedThreat(
            type=threat_type,
            title=title,
            detail=detail,
            location=location,
            location_role=role,
            count=count,
            course=course,
            confidence="medium",
            ttl_minutes=TTL_BY_TYPE[threat_type],
        ))
    return result
