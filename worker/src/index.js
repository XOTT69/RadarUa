import { sendPushNotification } from '@mmmike/web-push/send';

const VERSION = '2.2.0';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const GEOCODE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const NOMINATIM_MIN_INTERVAL_MS = 1100;
const MAX_EVENTS = 600;
const DEFAULT_EVENT_TTL_MIN = 90;
const MAX_EVENT_BODY_BYTES = 32_768;
const DEDUPE_WINDOW_MS = 6 * 60 * 1000;
const BRIDGE_ONLINE_MS = 90 * 1000;
const BRIDGE_STALE_MS = 5 * 60 * 1000;
const PUBLIC_TELEGRAM_MAX_AGE_MS = 14 * 60 * 1000;
const PUBLIC_TELEGRAM_MAX_MESSAGES = 28;
const NEPTUN_TTL_MINUTES = 6;
const NEPTUN_ALERTS_URL = 'https://neptun.in.ua/api/v1/alerts';
const NEPTUN_RAIONS_GEOJSON_URL = 'https://neptun.in.ua/raions.geojson';
const NEPTUN_OBLASTS_GEOJSON_URL = 'https://neptun.in.ua/oblasts.geojson';
const ALERTS_CACHE_SECONDS = 20;
const MAX_COLLECTED_EVENTS_PER_RUN = 36;
const EVENT_TYPES = ['drone', 'missile', 'kab', 'aviation', 'explosion', 'clear'];

const PUBLIC_TYPE_PATTERNS = [
  ['clear', /(відбій|загроза\s+минула|загрозу\s+скасовано|чисто\s+по)/iu],
  ['kab', /(каб(?:и|ів|ами)?|фаб[-\s]?(?:250|500|1500)|умпк|керован[\p{L}]*\s+авіабомб[\p{L}]*)/iu],
  ['missile', /(ракет[\p{L}]*|баліст[\p{L}]*|калібр|калибр|кинджал|іскандер|искандер|циркон|онікс|оникс|х[-\s]?(?:101|555|59|69)|x[-\s]?(?:101|555|59|69))/iu],
  ['drone', /(бпла|шахед(?:и|ів|ами)?|shahed(?:s)?|герань[\p{L}]*|дрон(?:и|ів|ами)?)/iu],
  ['aviation', /(авіаці[\p{L}]*|авиаци[\p{L}]*|ту[-\s]?(?:95|160|22)(?:мс|м\d)?|міг[-\s]?31|миг[-\s]?31|су[-\s]?(?:24|34|35)|бомбардувальник[\p{L}]*|тактичн[\p{L}]*\s+авіаці[\p{L}]*)/iu],
  ['explosion', /(вибух(?:и|ів)?|ппо\s+(?:працює|працювала|працюють)|робота\s+ппо)/iu]
];
const PUBLIC_TTL_BY_TYPE = { drone: 90, missile: 45, kab: 45, aviation: 180, explosion: 30, clear: 20 };
const PUBLIC_LABELS = { drone: 'БПЛА', missile: 'Ракета', kab: 'КАБ', aviation: 'Авіація', explosion: 'Вибухи / ППО', clear: 'Відбій / зниження загрози' };

const REGION_STEMS = [
  ['київщ', 'Київська область'], ['сумщ', 'Сумська область'], ['чернігівщ', 'Чернігівська область'],
  ['харківщ', 'Харківська область'], ['полтавщ', 'Полтавська область'], ['черкащ', 'Черкаська область'],
  ['вінничч', 'Вінницька область'], ['житомирщ', 'Житомирська область'], ['одещ', 'Одеська область'],
  ['миколаївщ', 'Миколаївська область'], ['херсонщ', 'Херсонська область'], ['дніпропетровщ', 'Дніпропетровська область'],
  ['кіровоградщ', 'Кіровоградська область'], ['львівщ', 'Львівська область'], ['рівненщ', 'Рівненська область'],
  ['хмельничч', 'Хмельницька область'], ['тернопільщ', 'Тернопільська область'], ['донечч', 'Донецька область'],
  ['луганщ', 'Луганська область'], ['івано франківщ', 'Івано-Франківська область'], ['закарпат', 'Закарпатська область'],
  ['буковин', 'Чернівецька область'], ['чернівечч', 'Чернівецька область'], ['волин', 'Волинська область']
];
function canonicalRegion(value) {
  const v = norm(value).replace(/-/g, ' ');
  for (const [stem, title] of REGION_STEMS) if (v.includes(stem)) return title;
  return null;
}

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const norm = (v) => String(v || '').toLocaleLowerCase('uk-UA').replace(/[’']/g, "'").replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
const trimText = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
function safeTimestamp(value) {
  const now = Date.now();
  const parsed = Date.parse(value || '');
  if (!Number.isFinite(parsed)) return new Date(now).toISOString();
  if (parsed > now + 10 * 60 * 1000) return new Date(now).toISOString();
  return new Date(parsed).toISOString();
}
function sourceAllowed(env, raw) {
  const configured = String(env.SOURCE_ALLOWLIST || '').split(',').map((x) => norm(x).replace(/^@/, '')).filter(Boolean);
  if (!configured.length) return true;
  const source = norm(raw?.meta?.sourceChannel || raw?.source).replace(/^@/, '');
  return configured.some((item) => source === item || source.includes(item));
}

function publicTelegramChannels(env) {
  return String(env.SOURCE_ALLOWLIST || '')
    .split(',')
    .map((channel) => channel.trim().replace(/^@/, ''))
    .filter((channel) => /^[a-zA-Z0-9_]{4,}$/u.test(channel));
}

function decodeTelegramHtml(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return String(value || '')
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<[^>]*>/gu, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/giu, (entity, code) => {
      const lower = code.toLowerCase();
      if (named[lower] !== undefined) return named[lower];
      if (lower.startsWith('#x')) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16)) || entity;
      if (lower.startsWith('#')) return String.fromCodePoint(Number.parseInt(lower.slice(1), 10)) || entity;
      return entity;
    })
    .replace(/\s+/gu, ' ')
    .trim();
}

function parsePublicTelegramPage(html, channel) {
  const markers = [...String(html || '').matchAll(/data-post="([a-zA-Z0-9_]+\/\d+)"/gu)];
  const messages = [];
  for (let index = 0; index < markers.length && messages.length < PUBLIC_TELEGRAM_MAX_MESSAGES; index += 1) {
    const marker = markers[index];
    const block = html.slice(marker.index, markers[index + 1]?.index || html.length);
    const textMatch = block.match(/<div class="tgme_widget_message_text[^"\n]*"[^>]*>([\s\S]*?)<\/div>/iu);
    const timeMatch = block.match(/<time[^>]+datetime="([^"]+)"/iu);
    if (!textMatch || !timeMatch) continue;
    const timestamp = Date.parse(timeMatch[1]);
    const [postChannel, messageId] = marker[1].split('/');
    const text = decodeTelegramHtml(textMatch[1]);
    if (!text || !Number.isFinite(timestamp) || !messageId) continue;
    messages.push({ channel: postChannel || channel, messageId, text, timestamp: new Date(timestamp).toISOString() });
  }
  return messages.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
}

function publicThreatType(text) {
  return PUBLIC_TYPE_PATTERNS.find(([, pattern]) => pattern.test(text))?.[0] || null;
}

function publicCourse(text) {
  const context = text.match(/(?:курс|напрямок|рух)[^\n,.]{0,55}/iu)?.[0] || text;
  if (/(північний\s*схід|пн\.?\s*[-/]?\s*сх\.?|північно[-\s]східн[\p{L}]*)/iu.test(context)) return 45;
  if (/(південний\s*схід|пд\.?\s*[-/]?\s*сх\.?|південно[-\s]східн[\p{L}]*)/iu.test(context)) return 135;
  if (/(південний\s*захід|пд\.?\s*[-/]?\s*зх\.?|південно[-\s]західн[\p{L}]*)/iu.test(context)) return 225;
  if (/(північний\s*захід|пн\.?\s*[-/]?\s*зх\.?|північно[-\s]західн[\p{L}]*)/iu.test(context)) return 315;
  if (/(північ|пн\.)/iu.test(context)) return 0;
  if (/(схід|сх\.)/iu.test(context)) return 90;
  if (/(південь|пд\.)/iu.test(context)) return 180;
  if (/(захід|зх\.)/iu.test(context)) return 270;
  return null;
}

function cleanPublicLocation(value) {
  let place = String(value || '').trim().replace(/^[\s\-–—:()\[\]{}🔴🟠🟡⚠️❗️➡️👉]+|[\s\-–—:()\[\]{}🔴🟠🟡⚠️❗️➡️👉]+$/gu, '');
  place = place.replace(/^(?:м|с|смт)\.?\s+/iu, '').replace(/\s+(?:області|область|району|район|громади|громада)$/iu, '');
  place = place.replace(/\s+(?:увага|уважно|обережно|можливо|орієнтовно|далі|залишайтесь|укриття)\b.*$/iu, '').trim();
  if (place.length < 2 || place.length > 64 || /^(?:на|до|в|у|бік|напрямок|курс)$/iu.test(place)) return null;
  return place;
}

function publicLocations(text) {
  const patterns = [
    ['destination', /(?:бпла|шахед(?:и|ів|ами)?|shahed(?:s)?|дрон(?:и|ів|ами)?|ракет\w*|каб(?:и|ів|ами)?)\s+(?:на|до)\s+([^,.;!\n]{2,64})/giu],
    ['destination', /(?:курс(?:ом)?|пряму(?:є|ють)|руха(?:є|ю)ться|лет(?:ить|ять)|йд(?:е|уть)|у\s+напрямку|в\s+напрямку|напрямок)\s*(?:на|до|в\s+бік|у\s+бік)?\s+([^,.;!\n]{2,64})/giu],
    ['near', /(?:біля|поблизу|над|в\s+районі|у\s+районі|районі|район)\s+([^,.;!\n]{2,64})/giu]
  ];
  const found = [], seen = new Set();
  for (const [role, pattern] of patterns) {
    for (const match of text.matchAll(pattern)) {
      for (const raw of match[1].split(/\s*(?:\/|→|➡️|\s+та\s+|\s+і\s+)\s*/iu).slice(0, 3)) {
        const location = cleanPublicLocation(raw);
        const key = norm(location);
        if (location && !seen.has(key)) { seen.add(key); found.push({ location, role }); }
      }
    }
  }
  return found.slice(0, 3);
}

function publicThreatPayloads(message, inheritedType) {
  const explicitType = publicThreatType(message.text);
  const locations = publicLocations(message.text);
  const type = explicitType || (locations.length && ['drone', 'missile', 'kab', 'aviation'].includes(inheritedType) ? inheritedType : null);
  if (!type) return { type: explicitType, payloads: [] };
  const count = Number(message.text.match(/(?<!\d)(\d{1,2})\s*(?:х|x|×)?\s*(?=(?:бпла|шахед|shahed|дрон|ракет|калібр|кинджал|іскандер|каб|фаб))/iu)?.[1]) || null;
  const title = count > 1 ? `${count}× ${PUBLIC_LABELS[type]}` : PUBLIC_LABELS[type];
  const targets = locations.length ? locations : [{ location: null, role: null }];
  return {
    type: explicitType,
    payloads: targets.map(({ location, role }, index) => ({
      id: `tg-web-${message.channel}-${message.messageId}-${index}`,
      type, title, detail: trimText(message.text, 900), location,
      course: publicCourse(message.text), confidence: locations.length ? 'medium' : 'low',
      source: `@${message.channel}`, timestamp: message.timestamp, ttlMinutes: PUBLIC_TTL_BY_TYPE[type],
      meta: {
        count, locationRole: role, sourceMessageId: `${message.channel}:${message.messageId}`,
        sourceUrl: `https://t.me/${message.channel}/${message.messageId}`,
        sourceChannelId: message.channel, sourceChannel: `@${message.channel}`,
        parserVersion: VERSION, sourceAccess: 'public_telegram_web',
        locationInterpretation: 'named_or_destination_locality_not_confirmed_target_position'
      }
    }))
  };
}

export const publicTelegramParser = { parsePublicTelegramPage, publicThreatPayloads, neptunPayload };

function normAdmin(v) {
  return norm(v)
    .replace(/^м\s+/u, '')
    .replace(/\b(?:(?:територіальна|міська|селищна|сільська)\s+)+громада\b/gu, '')
    .replace(/\b(?:громада|район|область)\b/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
function sameish(a, b) {
  const x = normAdmin(a), y = normAdmin(b);
  return Boolean(x && y && (x === y || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)))));
}
function haversineKm(lat1, lon1, lat2, lon2) {
  const r = 6371, toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}
function allowedOrigins(env) {
  const value = env.ALLOWED_ORIGIN || '*';
  return value === '*' ? ['*'] : value.split(',').map((x) => x.trim()).filter(Boolean);
}
function originAllowed(env, request) {
  const origin = request.headers.get('Origin');
  const allowed = allowedOrigins(env);
  return !origin || allowed.includes('*') || allowed.includes(origin);
}
function corsHeaders(env, request) {
  const origin = request?.headers.get('Origin') || '';
  const allowed = allowedOrigins(env);
  const value = allowed.includes('*') ? '*' : (origin && allowed.includes(origin) ? origin : 'null');
  return {
    'Access-Control-Allow-Origin': value,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin'
  };
}
function json(data, status, env, request, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(env, request), ...extra }
  });
}
function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7) : '';
}
async function readJson(request) {
  const declared = Number(request.headers.get('Content-Length') || 0);
  if (declared > MAX_EVENT_BODY_BYTES) return null;
  try {
    const text = await request.text();
    if (new TextEncoder().encode(text).byteLength > MAX_EVENT_BODY_BYTES) return null;
    return JSON.parse(text);
  } catch { return null; }
}
async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}
function inferPlaceType(address, result) {
  if (address?.city) return 'м.';
  if (address?.town) return 'м.';
  if (address?.village) return 'с.';
  if (address?.municipality) return '';
  return result?.type === 'city' ? 'м.' : '';
}
function toPlace(result) {
  const a = result.address || {};
  const locality = a.city || a.town || a.village || a.municipality || a.hamlet || a.suburb || '';
  const street = a.road || a.pedestrian || a.residential || a.footway || '';
  const house = a.house_number || '';
  const addressName = [street, house].filter(Boolean).join(', ');
  const name = addressName ? [addressName, locality].filter(Boolean).join(' · ') : (locality || String(result.display_name || '').split(',')[0]);
  const oblast = a.state || a.region || '';
  const district = a.county || a.district || '';
  const hromada = a.municipality || '';
  return {
    name: trimText(name, 120),
    locality: trimText(locality, 120),
    type: addressName ? 'адреса' : inferPlaceType(a, result),
    lat: Number(result.lat),
    lon: Number(result.lon),
    oblast: trimText(oblast, 140),
    district: trimText(district, 140),
    hromada: trimText(hromada, 140),
    displayName: trimText(result.display_name, 260),
    source: 'OpenStreetMap/Nominatim'
  };
}
function sanitizePlace(place) {
  if (!place || typeof place !== 'object') return null;
  const p = {
    name: trimText(place.name, 120), type: trimText(place.type, 30), oblast: trimText(place.oblast, 140),
    district: trimText(place.district, 140), hromada: trimText(place.hromada, 140), locality: trimText(place.locality, 120)
  };
  if (Number.isFinite(Number(place.lat))) p.lat = Number(place.lat);
  if (Number.isFinite(Number(place.lon))) p.lon = Number(place.lon);
  return p;
}
function placeFromUrl(url) {
  const p = {
    name: trimText(url.searchParams.get('place'), 120),
    oblast: trimText(url.searchParams.get('oblast'), 140),
    district: trimText(url.searchParams.get('district'), 140),
    hromada: trimText(url.searchParams.get('hromada'), 140),
    locality: trimText(url.searchParams.get('locality'), 120)
  };
  if (Number.isFinite(Number(url.searchParams.get('lat')))) p.lat = Number(url.searchParams.get('lat'));
  if (Number.isFinite(Number(url.searchParams.get('lon')))) p.lon = Number(url.searchParams.get('lon'));
  return p;
}
function monitoringApplies(event, place, radiusKm) {
  if (!event || !place) return false;
  if (event.meta?.locationScope === 'region' && event.meta?.oblast) return sameish(event.meta.oblast, place.oblast);
  if (Number.isFinite(event.lat) && Number.isFinite(event.lon) && Number.isFinite(place.lat) && Number.isFinite(place.lon)) {
    return haversineKm(place.lat, place.lon, event.lat, event.lon) <= clamp(Number(radiusKm || 25), 5, 100);
  }
  const hay = [event.meta?.location, event.meta?.oblast, event.meta?.district, event.meta?.hromada, event.title, event.detail].filter(Boolean);
  const needles = [place.locality, place.name, place.hromada, place.district, place.oblast].filter(Boolean);
  return needles.some((needle) => hay.some((x) => sameish(x, needle)));
}
function getHub(env) {
  const id = env.RADAR_HUB.idFromName('global');
  return env.RADAR_HUB.get(id);
}
async function hubGeocode(env, query) {
  const response = await getHub(env).fetch(`https://hub/geocode?q=${encodeURIComponent(query)}`);
  if (!response.ok) return [];
  return (await response.json()).items || [];
}
async function searchPlaces(request, env) {
  const url = new URL(request.url);
  const q = trimText(url.searchParams.get('q'), 180);
  if (q.length < 2) return json({ items: [] }, 200, env, request);
  const items = await hubGeocode(env, q);
  return json({ items }, 200, env, request, { 'Cache-Control': 'public, max-age=300' });
}
async function hubStatus(env) {
  const response = await getHub(env).fetch('https://hub/status');
  return response.ok ? response.json() : { state: 'offline', bridges: [], channels: [], lastHeartbeatAt: null };
}
async function threatsResponse(request, env, ctx) {
  const url = new URL(request.url);
  const place = placeFromUrl(url);
  const radius = clamp(Number(url.searchParams.get('radius') || 25), 5, 100);
  const response = await getHub(env).fetch('https://hub/events');
  const payload = response.ok ? await response.json() : { items: [] };
  const items = Array.isArray(payload.items) ? payload.items : [];
  const status = await hubStatus(env);
  // Cron is the normal collector. A page visit safely nudges it back to life if a
  // scheduled invocation was delayed, without turning ordinary API reads into polling.
  if (status.state !== 'online') ctx.waitUntil(scanSources(env));
  const localCount = place?.name ? items.filter((event) => monitoringApplies(event, place, radius)).length : null;
  return json({
    items,
    localityStatus: null,
    generatedAt: new Date().toISOString(),
    monitoring: { ...status, localCount, sourceMode: 'public-telegram-web+neptun-api' },
    notice: 'Моніторинг публічних Telegram-каналів і NEPTUN не є офіційною системою оповіщення. Точки можуть бути приблизними; для подій рівня області точка не показується.'
  }, 200, env, request, { 'Cache-Control': 'no-store' });
}

function neptunAlertUrls(env) {
  return {
    alerts: trimText(env.NEPTUN_ALERTS_URL || NEPTUN_ALERTS_URL, 500),
    raions: trimText(env.NEPTUN_RAIONS_GEOJSON_URL || NEPTUN_RAIONS_GEOJSON_URL, 500),
    oblasts: trimText(env.NEPTUN_OBLASTS_GEOJSON_URL || NEPTUN_OBLASTS_GEOJSON_URL, 500)
  };
}

async function ukraineOutlineResponse(request, env, ctx) {
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(neptunAlertUrls(env).oblasts, {
      headers: { Accept: 'application/geo+json, application/json' },
      cf: { cacheTtl: 86400, cacheEverything: true }
    });
    if (!response.ok) throw new Error(`neptun_oblasts_${response.status}`);
    const data = await response.json();
    const features = Array.isArray(data?.features) ? data.features.slice(0, 40) : [];
    const result = json({ type: 'FeatureCollection', features, attributionUrl: 'https://neptun.in.ua/' }, 200, env, request, {
      'Cache-Control': 'public, max-age=86400, s-maxage=86400'
    });
    ctx.waitUntil(cache.put(request, result.clone()));
    return result;
  } catch (error) {
    console.error('Ukraine outline failed', error?.message || error);
    return json({ error: 'ukraine_outline_unavailable', message: 'Контур України тимчасово недоступний' }, 502, env, request, { 'Cache-Control': 'no-store' });
  }
}

async function alertsResponse(request, env, ctx) {
  const cache = caches.default;
  const cached = await cache.match(request);
  if (cached) return cached;
  const urls = neptunAlertUrls(env);
  try {
    const [alertsResponse, boundariesResponse] = await Promise.all([
      fetch(urls.alerts, { headers: { Accept: 'application/json' }, cf: { cacheTtl: ALERTS_CACHE_SECONDS, cacheEverything: true } }),
      fetch(urls.raions, { headers: { Accept: 'application/geo+json, application/json' }, cf: { cacheTtl: 86400, cacheEverything: true } })
    ]);
    if (!alertsResponse.ok || !boundariesResponse.ok) throw new Error(`neptun_alerts_${alertsResponse.status}_${boundariesResponse.status}`);
    const [alerts, boundaries] = await Promise.all([alertsResponse.json(), boundariesResponse.json()]);
    const raions = Array.isArray(alerts?.raions) ? alerts.raions.slice(0, 180).map((item) => ({
      key: trimText(item?.key, 120), name: trimText(item?.name, 180), oblast: trimText(item?.oblast, 180), since: safeTimestamp(item?.since)
    })).filter((item) => item.key && item.name) : [];
    const oblasts = Array.isArray(alerts?.oblasts) ? alerts.oblasts.slice(0, 40).map((item) => ({
      key: trimText(item?.key, 120), name: trimText(item?.name, 180), oblast: trimText(item?.oblast, 180), since: safeTimestamp(item?.since)
    })).filter((item) => item.key && item.name) : [];
    const activeKeys = new Set(raions.map((item) => item.key));
    const features = Array.isArray(boundaries?.features)
      ? boundaries.features.filter((feature) => activeKeys.has(trimText(feature?.properties?.key, 120))).slice(0, 180)
      : [];
    const response = json({
      updatedAt: safeTimestamp(alerts?.updatedAt), raions, oblasts,
      features: { type: 'FeatureCollection', features },
      source: 'NEPTUN',
      attributionUrl: 'https://neptun.in.ua/'
    }, 200, env, request, { 'Cache-Control': `public, max-age=${ALERTS_CACHE_SECONDS}, s-maxage=${ALERTS_CACHE_SECONDS}` });
    ctx.waitUntil(cache.put(request, response.clone()));
    return response;
  } catch (error) {
    console.error('NEPTUN alert layer failed', error?.message || error);
    return json({ error: 'alert_layer_unavailable', message: 'Статус тривоги тимчасово недоступний' }, 502, env, request, { 'Cache-Control': 'no-store' });
  }
}
function pushEnabled(env) {
  return Boolean(env.SUBSCRIPTIONS && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}
function vapid(env) {
  return { subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY };
}
async function subscribePush(request, env) {
  if (!pushEnabled(env)) return json({ error: 'push_not_configured' }, 503, env, request);
  const body = await readJson(request);
  if (!body?.subscription?.endpoint || !body.subscription?.keys?.p256dh || !body.subscription?.keys?.auth) return json({ error: 'invalid_subscription' }, 400, env, request);
  const id = (await sha256(body.subscription.endpoint)).slice(0, 48);
  const record = {
    id,
    subscription: body.subscription,
    place: sanitizePlace(body.place),
    radiusKm: clamp(Number(body.radiusKm || 25), 5, 100),
    monitoring: body.monitoring !== false,
    createdAt: new Date().toISOString()
  };
  await env.SUBSCRIPTIONS.put(`sub:${id}`, JSON.stringify(record));
  return json({ ok: true, id }, 201, env, request);
}
async function unsubscribePush(request, env) {
  if (!env.SUBSCRIPTIONS) return json({ ok: true }, 200, env, request);
  const body = await readJson(request);
  const endpoint = trimText(body?.endpoint, 2048);
  if (!endpoint) return json({ error: 'missing_endpoint' }, 400, env, request);
  const id = (await sha256(endpoint)).slice(0, 48);
  await env.SUBSCRIPTIONS.delete(`sub:${id}`);
  return json({ ok: true }, 200, env, request);
}
async function listSubscriptions(env) {
  if (!env.SUBSCRIPTIONS) return [];
  const out = [];
  let cursor;
  do {
    const page = await env.SUBSCRIPTIONS.list({ prefix: 'sub:', cursor });
    for (const key of page.keys) {
      const record = await env.SUBSCRIPTIONS.get(key.name, 'json');
      if (record?.subscription?.endpoint) out.push(record);
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
async function pruneSubscription(env, record) {
  if (env.SUBSCRIPTIONS && record?.id) await env.SUBSCRIPTIONS.delete(`sub:${record.id}`);
}
async function sendPush(env, record, payload) {
  try {
    const delivered = await sendPushNotification(record.subscription, payload, vapid(env), { ttl: 180, urgency: 'high' });
    if (delivered === false) await pruneSubscription(env, record);
    return delivered;
  } catch (error) {
    if (error?.statusCode === 404 || error?.statusCode === 410) await pruneSubscription(env, record);
    console.error('push failed', error?.message || error);
    return null;
  }
}
function pushBody(event, locality) {
  const where = event.meta?.location ? `Згадано: ${event.meta.location}` : 'Без точно визначеного населеного пункту';
  const confirmed = event.meta?.sourceCount > 1 ? ` · ${event.meta.sourceCount} джерела` : '';
  return `${where}${confirmed} · ваша зона: ${locality}`;
}
async function pushMonitoringEvent(env, event) {
  if (!pushEnabled(env)) return;
  const subscriptions = await listSubscriptions(env);
  for (const record of subscriptions) {
    if (record.monitoring === false || !monitoringApplies(event, record.place, record.radiusKm || 25)) continue;
    const locality = record.place?.name || 'обрана зона';
    await sendPush(env, record, {
      title: `${event.type === 'clear' ? 'ℹ️' : '⚠️'} RadarUa · ${event.title}`,
      body: event.type === 'clear' ? `${pushBody(event, locality)} · це повідомлення каналу, не офіційний відбій` : pushBody(event, locality),
      tag: `monitor-${event.id}`,
      url: './'
    });
  }
}
async function processMonitoringEvent(env, raw, { trustedSource = false } = {}) {
  if (!EVENT_TYPES.includes(raw?.type)) return { status: 400, result: { error: 'unsupported_event_type' } };
  if (!trustedSource && !sourceAllowed(env, raw)) return { status: 403, result: { error: 'source_not_allowed' } };

  const location = trimText(raw.location || raw.meta?.location, 180);
  const region = canonicalRegion(location);
  if (region) raw.meta = { ...(raw.meta || {}), oblast: region, locationScope: 'region' };
  // An oblast is an administrative match, not a point. Do not geocode it to an
  // oblast centroid: that would look like a claimed target position on the map.
  if (location && !raw.meta?.areaOnly && !region && !(Number.isFinite(Number(raw.lat)) && Number.isFinite(Number(raw.lon)))) {
    const context = trimText(raw.meta?.oblast, 120);
    const query = region || (context ? `${location}, ${context}, Україна` : `${location}, Україна`);
    const places = await hubGeocode(env, query);
    if (places[0]) {
      raw.lat = places[0].lat;
      raw.lon = places[0].lon;
      raw.meta = {
        ...(raw.meta || {}),
        location,
        geocodedPlace: places[0],
        approximatePoint: true,
        coordinateMeaning: 'named_locality_centroid'
      };
    }
  }

  const hubResponse = await getHub(env).fetch(new Request('https://hub/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(raw)
  }));
  const result = await hubResponse.json();
  return { status: hubResponse.status, result };
}
async function ingestEvent(request, env, ctx) {
  if (!env.INGEST_TOKEN || bearer(request) !== env.INGEST_TOKEN) return json({ error: 'unauthorized' }, 401, env, request);
  const raw = await readJson(request);
  if (!raw) return json({ error: 'invalid_json' }, 400, env, request);
  const { status, result } = await processMonitoringEvent(env, raw);
  if (status < 300 && result.event && result.isNew) ctx.waitUntil(pushMonitoringEvent(env, result.event));
  return json(result, status, env, request, { 'Cache-Control': 'no-store' });
}
async function bridgeHeartbeat(request, env) {
  if (!env.INGEST_TOKEN || bearer(request) !== env.INGEST_TOKEN) return json({ error: 'unauthorized' }, 401, env, request);
  const raw = await readJson(request);
  if (!raw) return json({ error: 'invalid_json' }, 400, env, request);
  const response = await getHub(env).fetch(new Request('https://hub/heartbeat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(raw)
  }));
  const result = await response.json();
  return json(result, response.status, env, request, { 'Cache-Control': 'no-store' });
}

async function saveCollectorHeartbeat(env, channels, healthy, detail = '') {
  const body = {
    bridgeId: 'cloudflare-public-telegram', version: VERSION,
    startedAt: null, queueDepth: 0, telegramConnected: healthy,
    sourceMode: 'public_telegram_web+neptun_api', detail,
    channels: channels.map((channel) => channel === 'neptun'
      ? { id: 'neptun', name: 'NEPTUN', title: 'NEPTUN public API', username: null, lastMessageAt: null, lastMessageId: null }
      : { id: channel, name: `@${channel}`, title: `Telegram @${channel}`, username: channel, lastMessageAt: null, lastMessageId: null })
  };
  await getHub(env).fetch(new Request('https://hub/heartbeat', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }));
}

async function scanPublicTelegram(env, maxEvents = MAX_COLLECTED_EVENTS_PER_RUN) {
  const channels = publicTelegramChannels(env);
  let healthyChannels = 0;
  let parsedEvents = 0;
  const now = Date.now();
  for (const channel of channels) {
    if (parsedEvents >= maxEvents) break;
    try {
      const response = await fetch(`https://t.me/s/${encodeURIComponent(channel)}`, {
        headers: { 'User-Agent': 'RadarUa-Public-Monitor/2.1 (+https://github.com/XOTT69/RadarUa)', 'Accept-Language': 'uk' },
        cf: { cacheTtl: 0, cacheEverything: false }
      });
      if (!response.ok) throw new Error(`telegram_http_${response.status}`);
      healthyChannels += 1;
      let inheritedType = null;
      for (const message of parsePublicTelegramPage(await response.text(), channel)) {
        const age = now - Date.parse(message.timestamp);
        const { type, payloads } = publicThreatPayloads(message, inheritedType);
        if (type && ['drone', 'missile', 'kab', 'aviation'].includes(type)) inheritedType = type;
        if (type === 'clear') inheritedType = null;
        if (age < -5 * 60_000 || age > PUBLIC_TELEGRAM_MAX_AGE_MS) continue;
        for (const payload of payloads) {
          if (parsedEvents >= maxEvents) break;
          const outcome = await processMonitoringEvent(env, payload);
          if (outcome.status < 300 && outcome.result?.event?.isNew) await pushMonitoringEvent(env, outcome.result.event);
          if (outcome.status < 300) parsedEvents += 1;
        }
      }
    } catch (error) {
      console.error(`Public Telegram scan failed for @${channel}`, error?.message || error);
    }
  }
  return { channels, healthyChannels, channelCount: channels.length, parsedEvents };
}

function neptunType(value) {
  const types = { uav: 'drone', fpv: 'drone', recon: 'drone', missile: 'missile', ballistic: 'missile', kab: 'kab', mig31k: 'aviation' };
  return types[String(value || '').toLowerCase()] || null;
}

function neptunPayload(threat) {
  const type = neptunType(threat?.type);
  if (!type || threat?.status === 'resolved' || !threat?.id) return null;
  const areaOnly = threat.areaOnly === true;
  const hasPoint = !areaOnly && Number.isFinite(Number(threat.lat)) && Number.isFinite(Number(threat.lon));
  const location = trimText(threat.locality || threat.region || threat.district, 180);
  const region = trimText(threat.region, 160);
  return {
    id: `neptun-${trimText(threat.id, 160)}`,
    type,
    title: trimText(threat.title || PUBLIC_LABELS[type], 180),
    detail: trimText(threat.explanationShort || threat.title || 'Подія з NEPTUN', 900),
    location,
    ...(hasPoint ? { lat: Number(threat.lat), lon: Number(threat.lon) } : {}),
    course: Number.isFinite(Number(threat.heading)) ? Number(threat.heading) : null,
    confidence: ['low', 'medium', 'high'].includes(threat.confidenceLevel) ? threat.confidenceLevel : 'unknown',
    source: 'NEPTUN',
    timestamp: safeTimestamp(threat.updatedAt || threat.confirmedAt),
    ttlMinutes: NEPTUN_TTL_MINUTES,
    meta: {
      location, oblast: region, district: trimText(threat.district, 160),
      sourceMessageId: trimText(threat.id, 160), sourceUrl: 'https://neptun.in.ua/',
      sourceChannelId: 'neptun', sourceChannel: 'NEPTUN', sourceAccess: 'neptun_api',
      parserVersion: VERSION, count: Number.isFinite(Number(threat.count)) ? Number(threat.count) : null,
      upstreamSourceCount: clamp(Number(threat.sourceCount || 1), 1, 99),
      approximatePoint: Boolean(hasPoint && threat.positionQuality !== 'confirmed'),
      coordinateMeaning: areaOnly ? '' : `neptun_${trimText(threat.positionQuality || 'unknown', 20)}`,
      areaOnly, locationScope: '',
      advisory: threat.advisory === true, uncertaintyKm: Number.isFinite(Number(threat.uncertaintyKm)) ? Number(threat.uncertaintyKm) : null,
      locationInterpretation: areaOnly ? 'region_only_no_marker' : 'neptun_aggregated_threat_position'
    }
  };
}

async function scanNeptun(env, maxEvents = MAX_COLLECTED_EVENTS_PER_RUN) {
  const apiUrl = trimText(env.NEPTUN_API_URL || 'https://neptun.in.ua/api/v1/threats', 500);
  try {
    const response = await fetch(apiUrl, { headers: { 'User-Agent': 'RadarUa/2.1 (+https://github.com/XOTT69/RadarUa)', 'Accept': 'application/json' }, cf: { cacheTtl: 0, cacheEverything: false } });
    if (!response.ok) throw new Error(`neptun_http_${response.status}`);
    const data = await response.json();
    let processed = 0;
    for (const rawThreat of Array.isArray(data?.threats) ? data.threats : []) {
      if (processed >= maxEvents) break;
      const payload = neptunPayload(rawThreat);
      if (!payload) continue;
      const outcome = await processMonitoringEvent(env, payload, { trustedSource: true });
      if (outcome.status < 300 && outcome.result?.event?.isNew) await pushMonitoringEvent(env, outcome.result.event);
      if (outcome.status < 300) processed += 1;
    }
    return { healthy: true, processed };
  } catch (error) {
    console.error('NEPTUN scan failed', error?.message || error);
    return { healthy: false, processed: 0 };
  }
}

async function scanSources(env) {
  const neptun = await scanNeptun(env, 30);
  const telegram = await scanPublicTelegram(env, Math.max(0, MAX_COLLECTED_EVENTS_PER_RUN - neptun.processed));
  const channels = [...telegram.channels, 'neptun'];
  const healthy = telegram.healthyChannels > 0 || neptun.healthy;
  await saveCollectorHeartbeat(env, channels, healthy, `${telegram.healthyChannels}/${telegram.channelCount} Telegram channel(s); NEPTUN ${neptun.healthy ? 'reachable' : 'unreachable'}; ${telegram.parsedEvents + neptun.processed} events processed`);
}

export class RadarHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.geocodeQueue = Promise.resolve();
  }

  async readEvents() {
    const now = Date.now();
    let items = await this.ctx.storage.get('events') || [];
    const filtered = items
      .filter((event) => {
        const ts = new Date(event.timestamp).getTime();
        return Number.isFinite(ts) && now - ts < Number(event.ttlMinutes || DEFAULT_EVENT_TTL_MIN) * 60_000;
      })
      .slice(0, MAX_EVENTS);
    if (filtered.length !== items.length) await this.ctx.storage.put('events', filtered);
    return filtered;
  }

  normalizeEvent(raw) {
    const type = EVENT_TYPES.includes(raw.type) ? raw.type : 'explosion';
    const source = trimText(raw.source || raw.meta?.sourceChannel || 'telegram', 160);
    const sourceMessageId = trimText(raw.meta?.sourceMessageId, 160);
    const sourceUrl = trimText(raw.meta?.sourceUrl, 500);
    const location = trimText(raw.meta?.location || raw.location, 180);
    const upstreamSourceCount = clamp(Number(raw.meta?.upstreamSourceCount || 1), 1, 99);
    return {
      id: trimText(raw.id || crypto.randomUUID(), 180),
      type,
      title: trimText(raw.title || 'Моніторингова подія', 180),
      detail: trimText(raw.detail || raw.text, 900),
      lat: Number.isFinite(Number(raw.lat)) && Number(raw.lat) >= -90 && Number(raw.lat) <= 90 ? Number(raw.lat) : null,
      lon: Number.isFinite(Number(raw.lon)) && Number(raw.lon) >= -180 && Number(raw.lon) <= 180 ? Number(raw.lon) : null,
      course: Number.isFinite(Number(raw.course)) ? Number(raw.course) : null,
      confidence: trimText(raw.confidence || 'unknown', 40),
      source,
      timestamp: safeTimestamp(raw.timestamp),
      ttlMinutes: clamp(Number(raw.ttlMinutes || DEFAULT_EVENT_TTL_MIN), 5, 1440),
      meta: {
        monitoring: true,
        location,
        locationRole: trimText(raw.meta?.locationRole, 40),
        locationScope: trimText(raw.meta?.locationScope, 20),
        count: Number.isFinite(Number(raw.meta?.count)) ? Number(raw.meta.count) : null,
        oblast: trimText(raw.meta?.oblast, 160),
        district: trimText(raw.meta?.district, 160),
        hromada: trimText(raw.meta?.hromada, 160),
        sourceMessageId,
        sourceUrl,
        sourceChannelId: trimText(raw.meta?.sourceChannelId, 120),
        sourceChannel: trimText(raw.meta?.sourceChannel || source, 160),
        edited: Boolean(raw.meta?.edited),
        parserVersion: trimText(raw.meta?.parserVersion, 30),
        approximatePoint: Boolean(raw.meta?.approximatePoint || (Number.isFinite(Number(raw.lat)) && location)),
        locationInterpretation: 'named_or_destination_locality_not_confirmed_target_position',
        coordinateMeaning: trimText(raw.meta?.coordinateMeaning || (raw.lat != null ? 'named_locality_centroid' : ''), 80),
        geocodedPlace: raw.meta?.geocodedPlace || null,
        sources: source ? [{ name: source, messageId: sourceMessageId, url: sourceUrl || null }] : [],
        sourceCount: source ? upstreamSourceCount : 0,
        corroborated: upstreamSourceCount > 1
      }
    };
  }

  sameDedupe(a, b) {
    if (a.type !== b.type) return false;
    if (!a.meta?.location || !b.meta?.location || !sameish(a.meta.location, b.meta.location)) return false;
    const at = new Date(a.timestamp).getTime(), bt = new Date(b.timestamp).getTime();
    return Math.abs(at - bt) <= DEDUPE_WINDOW_MS;
  }

  mergeEvent(existing, incoming) {
    const byKey = new Map();
    for (const src of [...(existing.meta?.sources || []), ...(incoming.meta?.sources || [])]) {
      const key = src.messageId || `${src.name}|${src.url || ''}`;
      if (key) byKey.set(key, src);
    }
    const sources = [...byKey.values()].slice(0, 12);
    const sourceCount = Math.max(
      new Set(sources.map((x) => x.name).filter(Boolean)).size || sources.length,
      Number(existing.meta?.sourceCount || 0), Number(incoming.meta?.sourceCount || 0)
    );
    const latest = new Date(incoming.timestamp) >= new Date(existing.timestamp) ? incoming : existing;
    return {
      ...existing,
      title: latest.title || existing.title,
      detail: latest.detail || existing.detail,
      timestamp: new Date(Math.max(new Date(existing.timestamp).getTime(), new Date(incoming.timestamp).getTime())).toISOString(),
      ttlMinutes: Math.max(existing.ttlMinutes || DEFAULT_EVENT_TTL_MIN, incoming.ttlMinutes || DEFAULT_EVENT_TTL_MIN),
      lat: incoming.lat ?? existing.lat,
      lon: incoming.lon ?? existing.lon,
      course: incoming.course ?? existing.course,
      confidence: sourceCount >= 2 ? 'high' : (incoming.confidence || existing.confidence),
      source: sourceCount >= 2 ? `${sourceCount} джерела` : (sources[0]?.name || latest.source),
      meta: {
        ...existing.meta,
        ...incoming.meta,
        count: Math.max(Number(existing.meta?.count || 0), Number(incoming.meta?.count || 0)) || null,
        sources,
        sourceCount,
        corroborated: sourceCount >= 2,
        approximatePoint: Boolean(existing.meta?.approximatePoint || incoming.meta?.approximatePoint)
      }
    };
  }

  async addEvent(raw) {
    const event = this.normalizeEvent(raw);
    let items = await this.readEvents();
    const exactIndex = items.findIndex((x) => x.id === event.id);
    if (exactIndex >= 0) {
      const updated = this.mergeEvent(items[exactIndex], event);
      items[exactIndex] = updated;
      await this.ctx.storage.put('events', items);
      this.broadcast({ type: 'event', event: updated, update: true });
      return { ok: true, event: updated, merged: true, isNew: false };
    }
    const duplicateIndex = items.findIndex((x) => this.sameDedupe(x, event));
    if (duplicateIndex >= 0) {
      const merged = this.mergeEvent(items[duplicateIndex], event);
      items[duplicateIndex] = merged;
      items.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
      await this.ctx.storage.put('events', items.slice(0, MAX_EVENTS));
      this.broadcast({ type: 'event', event: merged, update: true });
      return { ok: true, event: merged, merged: true, isNew: false };
    }
    items = [event, ...items].slice(0, MAX_EVENTS);
    await this.ctx.storage.put('events', items);
    this.broadcast({ type: 'event', event, update: false });
    return { ok: true, event, merged: false, isNew: true };
  }

  broadcast(payload) {
    const text = JSON.stringify(payload);
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(text); } catch {}
    }
  }

  async geocode(query) {
    const task = this.geocodeQueue.then(() => this.geocodeSerial(query));
    this.geocodeQueue = task.catch(() => undefined);
    return task;
  }

  async geocodeSerial(query) {
    const q = trimText(query, 240);
    const key = `geo:${await sha256(norm(q))}`;
    const cached = await this.ctx.storage.get(key);
    if (cached?.storedAt && Date.now() - cached.storedAt < GEOCODE_CACHE_MS && Array.isArray(cached.items)) return cached.items;

    const lastAt = Number(await this.ctx.storage.get('nominatim:lastAt') || 0);
    const waitMs = NOMINATIM_MIN_INTERVAL_MS - (Date.now() - lastAt);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    await this.ctx.storage.put('nominatim:lastAt', Date.now());

    const isCoords = /^-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(q);
    const upstream = isCoords
      ? `${NOMINATIM_URL}/reverse?format=jsonv2&lat=${encodeURIComponent(q.split(',')[0].trim())}&lon=${encodeURIComponent(q.split(',')[1].trim())}&addressdetails=1&accept-language=uk`
      : `${NOMINATIM_URL}/search?format=jsonv2&countrycodes=ua&limit=8&addressdetails=1&accept-language=uk&q=${encodeURIComponent(q)}`;
    const response = await fetch(upstream, {
      headers: { 'User-Agent': 'RadarUa-PWA/2.0 (+https://github.com/XOTT69/RadarUa)', 'Accept-Language': 'uk' }
    });
    if (!response.ok) throw new Error('geocoder_unavailable');
    const raw = await response.json();
    const list = isCoords ? (raw ? [raw] : []) : (Array.isArray(raw) ? raw : []);
    const items = list.map(toPlace).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    await this.ctx.storage.put(key, { storedAt: Date.now(), items });
    return items;
  }

  async saveHeartbeat(raw) {
    const bridgeId = trimText(raw.bridgeId || 'primary', 80);
    const now = new Date().toISOString();
    const heartbeat = {
      bridgeId,
      version: trimText(raw.version, 30),
      startedAt: raw.startedAt || null,
      lastHeartbeatAt: now,
      queueDepth: clamp(Number(raw.queueDepth || 0), 0, 1_000_000),
      telegramConnected: raw.telegramConnected !== false,
      sourceMode: trimText(raw.sourceMode || 'telegram_api', 40),
      detail: trimText(raw.detail, 240),
      channels: Array.isArray(raw.channels) ? raw.channels.slice(0, 100).map((c) => ({
        id: trimText(c.id, 120), name: trimText(c.name, 180), title: trimText(c.title, 180), username: trimText(c.username, 120),
        lastMessageAt: c.lastMessageAt || null, lastMessageId: c.lastMessageId ?? null
      })) : []
    };
    const bridges = await this.ctx.storage.get('bridges') || {};
    bridges[bridgeId] = heartbeat;
    await this.ctx.storage.put('bridges', bridges);
    return heartbeat;
  }

  async status() {
    const bridgesObj = await this.ctx.storage.get('bridges') || {};
    const bridges = Object.values(bridgesObj);
    const now = Date.now();
    let newest = 0;
    for (const b of bridges) newest = Math.max(newest, new Date(b.lastHeartbeatAt || 0).getTime() || 0);
    const age = newest ? now - newest : Infinity;
    const telegramConnected = bridges.some((b) => b.telegramConnected);
    const state = age <= BRIDGE_ONLINE_MS && telegramConnected ? 'online' : age <= BRIDGE_STALE_MS ? 'stale' : 'offline';
    const channelMap = new Map();
    for (const b of bridges) for (const c of b.channels || []) channelMap.set(c.id || c.name, c);
    const channels = [...channelMap.values()];
    return {
      state,
      lastHeartbeatAt: newest ? new Date(newest).toISOString() : null,
      bridgeCount: bridges.length,
      channelCount: channels.length,
      queueDepth: bridges.reduce((sum, b) => sum + Number(b.queueDepth || 0), 0),
      telegramConnected,
      sourceMode: bridges.find((b) => b.sourceMode === 'public_telegram_web+neptun_api')?.sourceMode || 'telegram_api',
      bridges,
      channels
    };
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === '/stream' && request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: 'hello', time: new Date().toISOString(), status: await this.status() }));
      return new Response(null, { status: 101, webSocket: client });
    }
    if (url.pathname === '/events' && request.method === 'GET') {
      return new Response(JSON.stringify({ items: await this.readEvents() }), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/events' && request.method === 'POST') {
      const raw = await readJson(request);
      if (!raw) return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      const result = await this.addEvent(raw);
      return new Response(JSON.stringify(result), { status: result.isNew ? 201 : 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/heartbeat' && request.method === 'POST') {
      const raw = await readJson(request);
      if (!raw) return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ ok: true, heartbeat: await this.saveHeartbeat(raw) }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/status' && request.method === 'GET') {
      return new Response(JSON.stringify(await this.status()), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.pathname === '/geocode' && request.method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2) return new Response(JSON.stringify({ items: [] }), { headers: { 'Content-Type': 'application/json' } });
      try {
        return new Response(JSON.stringify({ items: await this.geocode(q) }), { headers: { 'Content-Type': 'application/json' } });
      } catch (error) {
        return new Response(JSON.stringify({ error: 'geocoder_unavailable', message: error.message }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }
    }
    return new Response('Not found', { status: 404 });
  }

  webSocketMessage(ws, message) {
    try {
      const data = typeof message === 'string' ? JSON.parse(message) : {};
      if (data.type === 'ping') ws.send(JSON.stringify({ type: 'pong', time: new Date().toISOString() }));
    } catch {}
  }
  webSocketClose(ws, code, reason) { try { ws.close(code, reason); } catch {} }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (!originAllowed(env, request)) return json({ error: 'origin_not_allowed' }, 403, env, request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env, request) });

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({
        ok: true, service: 'radarua-api', version: VERSION, sourceMode: 'public-telegram-web+neptun-api',
        ingestTokenConfigured: Boolean(env.INGEST_TOKEN), realtime: Boolean(env.RADAR_HUB), pushConfigured: pushEnabled(env),
        monitoring: await hubStatus(env)
      }, 200, env, request, { 'Cache-Control': 'no-store' });
    }
    if (url.pathname === '/api/status' && request.method === 'GET') return json(await hubStatus(env), 200, env, request, { 'Cache-Control': 'no-store' });
    if (url.pathname === '/api/places' && request.method === 'GET') return searchPlaces(request, env);
    if (url.pathname === '/api/threats' && request.method === 'GET') return threatsResponse(request, env, ctx);
    if (url.pathname === '/api/alerts' && request.method === 'GET') return alertsResponse(request, env, ctx);
    if (url.pathname === '/api/map/ukraine' && request.method === 'GET') return ukraineOutlineResponse(request, env, ctx);
    if (url.pathname === '/api/monitoring/events' && request.method === 'POST') return ingestEvent(request, env, ctx);
    if (url.pathname === '/api/monitoring/events' && request.method === 'GET') {
      const response = await getHub(env).fetch('https://hub/events');
      return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(env, request), 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/api/bridge/heartbeat' && request.method === 'POST') return bridgeHeartbeat(request, env);
    if (url.pathname === '/api/stream' && request.method === 'GET' && request.headers.get('Upgrade') === 'websocket') {
      return getHub(env).fetch(new Request('https://hub/stream', { headers: request.headers }));
    }
    if (url.pathname === '/api/push/config' && request.method === 'GET') return json({ enabled: pushEnabled(env), publicKey: env.VAPID_PUBLIC_KEY || '' }, 200, env, request, { 'Cache-Control': 'no-store' });
    if (url.pathname === '/api/push/subscribe' && request.method === 'POST') return subscribePush(request, env);
    if (url.pathname === '/api/push/unsubscribe' && (request.method === 'POST' || request.method === 'DELETE')) return unsubscribePush(request, env);
    return json({ error: 'not_found' }, 404, env, request);
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(scanSources(env));
  }
};
