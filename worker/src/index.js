import { sendPushNotification } from '@mmmike/web-push/send';

const ALERTS_URL = 'https://api.alerts.in.ua/v1/alerts/active.json';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';
const ALERT_CACHE_SECONDS = 20;
const GEOCODE_CACHE_MS = 7 * 24 * 60 * 60 * 1000;
const NOMINATIM_MIN_INTERVAL_MS = 1100;
const MAX_EVENTS = 500;
const DEFAULT_EVENT_TTL_MIN = 120;
const MAX_EVENT_BODY_BYTES = 32_768;

const REGION_POINTS = {
  'Автономна Республіка Крим':[45.30,34.10],'Вінницька область':[49.23,28.47],'Волинська область':[50.75,25.33],
  'Дніпропетровська область':[48.46,35.05],'Донецька область':[48.02,37.80],'Житомирська область':[50.25,28.66],
  'Закарпатська область':[48.62,22.30],'Запорізька область':[47.84,35.14],'Івано-Франківська область':[48.92,24.71],
  'Київська область':[50.05,30.20],'Кіровоградська область':[48.51,32.26],'Луганська область':[48.57,39.31],
  'Львівська область':[49.84,24.03],'Миколаївська область':[46.98,32.00],'Одеська область':[46.48,30.73],
  'Полтавська область':[49.59,34.55],'Рівненська область':[50.62,26.25],'Сумська область':[50.91,34.80],
  'Тернопільська область':[49.55,25.59],'Харківська область':[49.99,36.23],'Херсонська область':[46.64,32.62],
  'Хмельницька область':[49.42,26.99],'Черкаська область':[49.44,32.06],'Чернівецька область':[48.29,25.94],
  'Чернігівська область':[51.50,31.28],'м. Київ':[50.45,30.52],'Київ':[50.45,30.52],'м. Севастополь':[44.61,33.52]
};

const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const norm = (v) => String(v || '').toLocaleLowerCase('uk-UA').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
const normAdmin = (v) => norm(v)
  .replace(/^м\.\s*/u, '')
  .replace(/\b(?:(?:територіальна|міська|селищна|сільська)\s+)+громада\b/gu, '')
  .replace(/\bгромада\b/gu, '')
  .replace(/\bрайон\b/gu, '')
  .replace(/\bобласть\b/gu, '')
  .replace(/\s+/g, ' ')
  .trim();
const trimText = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
function sameish(a, b) {
  const x = normAdmin(a), y = normAdmin(b);
  return Boolean(x && y && (x === y || x.includes(y) || y.includes(x)));
}
function sameAdminExact(a, b) { const x = normAdmin(a), y = normAdmin(b); return Boolean(x && y && x === y); }
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
  const value = allowed.includes('*') || !origin ? '*' : origin;
  return {
    'Access-Control-Allow-Origin': value,
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
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
  try { return await request.json(); } catch { return null; }
}
async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function alertLabel(a) {
  return {
    air_raid: 'Повітряна тривога', artillery_shelling: 'Загроза артобстрілу', urban_fights: 'Вуличні бої',
    chemical: 'Хімічна загроза', nuclear: 'Радіаційна загроза'
  }[a.alert_type] || 'Активна загроза';
}
function regionName(a) {
  return a.location_type === 'oblast' ? a.location_title : (a.location_oblast || '');
}
function alertApplies(a, place) {
  if (!place) return false;
  const oblastOk = !a.location_oblast || !place.oblast || sameAdminExact(a.location_oblast, place.oblast);
  const raionOk = !a.location_raion || !place.district || sameish(a.location_raion, place.district);
  if (a.location_type === 'oblast') return sameAdminExact(a.location_title, place.oblast) || (!place.oblast && sameAdminExact(a.location_title, place.name));
  if (a.location_type === 'raion') return oblastOk && (sameish(a.location_title, place.district) || sameish(a.location_raion, place.district));
  if (a.location_type === 'hromada') return oblastOk && raionOk && (sameish(a.location_title, place.hromada) || sameish(a.location_title, place.name));
  if (a.location_type === 'city') return oblastOk && raionOk && (sameish(a.location_title, place.name) || sameish(a.location_title, place.hromada));
  return oblastOk && [place.name, place.hromada, place.district, place.oblast].filter(Boolean).some((v) => sameish(a.location_title, v));
}
function toOfficialThreat(a, place) {
  const region = regionName(a), point = REGION_POINTS[region] || null, applies = alertApplies(a, place);
  const lat = applies && Number.isFinite(place?.lat) ? place.lat : (point ? point[0] : null);
  const lon = applies && Number.isFinite(place?.lon) ? place.lon : (point ? point[1] : null);
  return {
    id: `alerts-in-ua-${a.id}`,
    type: 'alert',
    title: alertLabel(a),
    detail: a.location_title || region,
    lat, lon, course: null,
    confidence: applies ? 'locality' : 'region',
    source: 'alerts.in.ua',
    timestamp: a.updated_at || a.started_at || new Date().toISOString(),
    meta: {
      monitoring: false,
      alertType: a.alert_type,
      locationType: a.location_type,
      locationUid: a.location_uid,
      region,
      raion: a.location_raion || '',
      appliesToLocality: applies,
      approximatePoint: true,
      coordinateMeaning: 'administrative_area_display_point',
      notes: a.notes || ''
    }
  };
}
function localityStatus(alerts, place) {
  if (!place) return null;
  const relevant = alerts.filter((a) => alertApplies(a, place));
  if (!relevant.length) {
    return { active: false, label: 'Немає активної тривоги', detail: 'За даними активних офіційних тривог для вибраної адміністративної зони.' };
  }
  const primary = relevant.find((a) => a.alert_type === 'air_raid') || relevant[0];
  return {
    active: true,
    label: alertLabel(primary),
    detail: `${primary.location_title}${primary.location_type ? ` · ${primary.location_type}` : ''}`,
    startedAt: primary.started_at || null,
    alerts: relevant.map((a) => ({ id: a.id, type: a.alert_type, title: a.location_title, startedAt: a.started_at }))
  };
}

function placeFromUrl(url) {
  const text = (k) => url.searchParams.get(k) || '';
  const num = (k) => { const v = Number(url.searchParams.get(k)); return Number.isFinite(v) ? v : null; };
  const name = text('place');
  if (!name && !text('oblast') && !text('district') && !text('hromada') && num('lat') == null) return null;
  return { name, oblast: text('oblast'), district: text('district'), hromada: text('hromada'), lat: num('lat'), lon: num('lon') };
}
function sanitizePlace(place) {
  if (!place || typeof place !== 'object') return null;
  return {
    name: trimText(place.name, 160), type: trimText(place.type, 80), oblast: trimText(place.oblast, 160),
    district: trimText(place.district, 160), hromada: trimText(place.hromada, 160),
    lat: Number.isFinite(Number(place.lat)) ? Number(place.lat) : null,
    lon: Number.isFinite(Number(place.lon)) ? Number(place.lon) : null
  };
}
function monitoringApplies(event, place, radiusKm) {
  if (!place) return false;
  if (event.lat != null && event.lon != null && place.lat != null && place.lon != null && haversineKm(place.lat, place.lon, event.lat, event.lon) <= radiusKm) return true;
  const hay = norm([event.title, event.detail, event.meta?.location, event.meta?.oblast, event.meta?.district, event.meta?.hromada].filter(Boolean).join(' '));
  return [place.name, place.oblast, place.district, place.hromada].filter(Boolean).some((x) => hay.includes(norm(x)));
}

function inferPlaceType(address, result) {
  if (address.city || address.town) return 'місто';
  if (address.village || address.hamlet) return 'село';
  if (address.municipality) return 'громада';
  return result.type === 'administrative' ? 'територія' : 'населений пункт';
}
function toPlace(result) {
  const a = result.address || {};
  const name = a.city || a.town || a.village || a.hamlet || a.municipality || result.name || String(result.display_name || '').split(',')[0];
  return {
    id: `osm-${result.osm_type}-${result.osm_id}`,
    name,
    type: inferPlaceType(a, result),
    lat: Number(result.lat),
    lon: Number(result.lon),
    oblast: a.state || a.region || '',
    district: a.state_district || a.county || a.district || '',
    hromada: a.municipality || a.city_district || '',
    displayName: result.display_name || name,
    source: 'OpenStreetMap/Nominatim'
  };
}
function getHub(env) {
  return env.RADAR_HUB.get(env.RADAR_HUB.idFromName('global'));
}
async function fetchActiveAlerts(env, { bypassCache = false } = {}) {
  const response = await getHub(env).fetch(`https://hub/official-alerts${bypassCache ? '?refresh=1' : ''}`);
  if (!response.ok) {
    let detail = '';
    try { detail = (await response.json()).message || ''; } catch {}
    throw new Error(detail || `official alerts ${response.status}`);
  }
  const payload = await response.json();
  return Array.isArray(payload.alerts) ? payload.alerts : [];
}
async function hubGeocode(env, query) {
  const response = await getHub(env).fetch(`https://hub/geocode?q=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error('geocoder_unavailable');
  const payload = await response.json();
  return Array.isArray(payload.items) ? payload.items : [];
}
async function searchPlaces(request, env) {
  const q = (new URL(request.url).searchParams.get('q') || '').trim();
  if (q.length < 2) return json({ items: [] }, 200, env, request);
  try {
    const items = await hubGeocode(env, q);
    return json({ items, attribution: '© OpenStreetMap contributors; geocoding by Nominatim' }, 200, env, request, { 'Cache-Control': 'public,max-age=604800' });
  } catch {
    return json({ error: 'geocoder_unavailable' }, 502, env, request);
  }
}

async function threatsResponse(request, env) {
  const url = new URL(request.url), place = placeFromUrl(url), radius = clamp(Number(url.searchParams.get('radius') || 25), 5, 100);
  try {
    const [alerts, monitorResponse] = await Promise.all([fetchActiveAlerts(env), getHub(env).fetch('https://hub/events')]);
    const monitorPayload = monitorResponse.ok ? await monitorResponse.json() : { items: [] };
    const monitoring = (monitorPayload.items || []).map((event) => ({
      ...event,
      meta: { ...(event.meta || {}), monitoring: true, appliesToLocality: monitoringApplies(event, place, radius) }
    }));
    const official = alerts.map((a) => toOfficialThreat(a, place));
    return json({
      items: [...monitoring, ...official],
      localityStatus: localityStatus(alerts, place),
      generatedAt: new Date().toISOString(),
      monitoring: { count: monitoring.length, realtime: true },
      notice: 'Офіційні тривоги є адміністративними зонами. Моніторингові точки — центри згаданих населених пунктів/територій, а не підтверджені позиції повітряних цілей.'
    }, 200, env, request, { 'Cache-Control': 'no-store' });
  } catch (error) {
    console.error(error);
    return json({ error: 'upstream_unavailable', message: error.message }, 502, env, request, { 'Cache-Control': 'no-store' });
  }
}

function pushEnabled(env) {
  return Boolean(env.SUBSCRIPTIONS && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}
function vapid(env) {
  return { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT };
}
async function subscribePush(request, env) {
  if (!pushEnabled(env)) return json({ error: 'push_not_configured' }, 503, env, request);
  const body = await readJson(request), subscription = body?.subscription, place = sanitizePlace(body?.place);
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) return json({ error: 'invalid_subscription' }, 400, env, request);
  if (!place?.name && !place?.oblast && !place?.district && !place?.hromada) return json({ error: 'place_required' }, 400, env, request);
  const id = await sha256(subscription.endpoint);
  await env.SUBSCRIPTIONS.put(`sub:${id}`, JSON.stringify({
    subscription,
    place,
    radiusKm: clamp(Number(body.radiusKm || 25), 5, 100),
    monitoring: body.monitoring !== false,
    updatedAt: new Date().toISOString()
  }));
  return json({ ok: true, id }, 200, env, request, { 'Cache-Control': 'no-store' });
}
async function unsubscribePush(request, env) {
  const body = await readJson(request);
  if (!body?.endpoint) return json({ error: 'endpoint_required' }, 400, env, request);
  if (env.SUBSCRIPTIONS) {
    const id = await sha256(body.endpoint);
    await Promise.all([env.SUBSCRIPTIONS.delete(`sub:${id}`), env.SUBSCRIPTIONS.delete(`state:${id}`)]);
  }
  return json({ ok: true }, 200, env, request);
}
async function listSubscriptions(env) {
  if (!env.SUBSCRIPTIONS) return [];
  const out = [];
  let cursor;
  do {
    const page = await env.SUBSCRIPTIONS.list({ prefix: 'sub:', cursor });
    for (const key of page.keys) {
      const value = await env.SUBSCRIPTIONS.get(key.name, 'json');
      if (value) out.push({ key: key.name, id: key.name.slice(4), ...value });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return out;
}
async function pruneSubscription(env, record) {
  await Promise.all([env.SUBSCRIPTIONS.delete(record.key), env.SUBSCRIPTIONS.delete(`state:${record.id}`)]);
}
async function sendPush(env, record, payload) {
  try {
    const delivered = await sendPushNotification(record.subscription, payload, vapid(env), { ttl: 180, urgency: 'high' });
    if (delivered === false) await pruneSubscription(env, record);
    return delivered;
  } catch (error) {
    console.error('push failed', error?.message || error);
    return null;
  }
}
async function pushMonitoringEvent(env, event) {
  if (!pushEnabled(env)) return;
  const subscriptions = await listSubscriptions(env);
  for (const record of subscriptions) {
    if (record.monitoring === false || !monitoringApplies(event, record.place, record.radiusKm || 25)) continue;
    const locality = record.place?.name || 'ваша зона';
    await sendPush(env, record, {
      title: `⚠️ RadarUa · ${event.title}`,
      body: `${event.detail || event.meta?.location || 'Нова моніторингова подія'} · ${locality}`,
      tag: `monitor-${event.id}`,
      url: './'
    });
  }
}
async function processOfficialPush(env) {
  if (!pushEnabled(env)) return;
  const alerts = await fetchActiveAlerts(env, { bypassCache: true });
  const subscriptions = await listSubscriptions(env);
  for (const record of subscriptions) {
    const status = localityStatus(alerts, record.place) || { active: false };
    const stateKey = `state:${record.id}`;
    const previous = await env.SUBSCRIPTIONS.get(stateKey, 'json');
    if (!previous) {
      await env.SUBSCRIPTIONS.put(stateKey, JSON.stringify({ active: Boolean(status.active), updatedAt: new Date().toISOString() }));
      continue;
    }
    if (Boolean(previous.active) !== Boolean(status.active)) {
      const locality = record.place?.name || record.place?.hromada || record.place?.district || record.place?.oblast || 'ваша зона';
      const payload = status.active
        ? { title: `⚠️ RadarUa · ${locality}`, body: status.label || 'Активна тривога у вашій зоні.', tag: `official-${record.id}-active`, url: './' }
        : { title: `✅ RadarUa · ${locality}`, body: 'За офіційними активними даними тривога для вибраної зони завершилася.', tag: `official-${record.id}-clear`, url: './' };
      await sendPush(env, record, payload);
    }
    await env.SUBSCRIPTIONS.put(stateKey, JSON.stringify({ active: Boolean(status.active), updatedAt: new Date().toISOString() }));
  }
}

async function ingestEvent(request, env, ctx) {
  if (!env.INGEST_TOKEN || bearer(request) !== env.INGEST_TOKEN) return json({ error: 'unauthorized' }, 401, env, request);
  const raw = await readJson(request);
  if (!raw || typeof raw !== 'object') return json({ error: 'invalid_event' }, 400, env, request);
  const location = trimText(raw.location || raw.meta?.location, 180);
  if (!location) return json({ error: 'location_required', message: 'Monitoring events must reference a named locality/area; precise target coordinates are not accepted.' }, 400, env, request);

  let place = null;
  try { place = (await hubGeocode(env, location))[0] || null; } catch {}
  const body = {
    id: raw.id,
    type: raw.type,
    title: raw.title,
    detail: raw.detail || raw.text,
    location,
    lat: place?.lat ?? null,
    lon: place?.lon ?? null,
    course: null,
    confidence: place ? (raw.confidence || 'medium') : 'text-only',
    source: raw.source,
    timestamp: raw.timestamp,
    ttlMinutes: raw.ttlMinutes,
    meta: {
      location,
      oblast: trimText(raw.meta?.oblast || place?.oblast, 160),
      district: trimText(raw.meta?.district || place?.district, 160),
      hromada: trimText(raw.meta?.hromada || place?.hromada, 160),
      sourceMessageId: trimText(raw.meta?.sourceMessageId, 120),
      locationInterpretation: 'named_or_destination_locality_not_confirmed_target_position',
      coordinateMeaning: place ? 'named_locality_centroid' : 'text_only',
      geocodedPlace: place ? { name: place.name, type: place.type, oblast: place.oblast, district: place.district, hromada: place.hromada } : null
    }
  };
  const hubResponse = await getHub(env).fetch(new Request('https://hub/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }));
  const result = await hubResponse.json();
  if (hubResponse.ok && result.event) ctx.waitUntil(pushMonitoringEvent(env, result.event));
  return json(result, hubResponse.status, env, request, { 'Cache-Control': 'no-store' });
}

export class RadarHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.geocodeQueue = Promise.resolve();
    this.alertQueue = Promise.resolve();
  }

  async readEvents() {
    const now = Date.now();
    let items = await this.ctx.storage.get('events') || [];
    items = items
      .filter((event) => now - new Date(event.timestamp).getTime() < Number(event.ttlMinutes || DEFAULT_EVENT_TTL_MIN) * 60_000)
      .slice(0, MAX_EVENTS);
    return items;
  }

  normalizeEvent(raw) {
    const type = ['drone', 'missile', 'aviation', 'alert'].includes(raw.type) ? raw.type : 'alert';
    return {
      id: trimText(raw.id || crypto.randomUUID(), 180),
      type,
      title: trimText(raw.title || ({ drone: 'БПЛА', missile: 'Ракета', aviation: 'Авіація', alert: 'Подія' }[type]), 180),
      detail: trimText(raw.detail || raw.text, 800),
      lat: Number.isFinite(Number(raw.lat)) ? Number(raw.lat) : null,
      lon: Number.isFinite(Number(raw.lon)) ? Number(raw.lon) : null,
      course: null,
      confidence: trimText(raw.confidence || 'unknown', 40),
      source: trimText(raw.source || 'monitoring', 160),
      timestamp: raw.timestamp ? new Date(raw.timestamp).toISOString() : new Date().toISOString(),
      ttlMinutes: clamp(Number(raw.ttlMinutes || DEFAULT_EVENT_TTL_MIN), 5, 1440),
      meta: {
        monitoring: true,
        location: trimText(raw.meta?.location || raw.location, 180),
        oblast: trimText(raw.meta?.oblast, 160),
        district: trimText(raw.meta?.district, 160),
        hromada: trimText(raw.meta?.hromada, 160),
        sourceMessageId: trimText(raw.meta?.sourceMessageId, 120),
        locationInterpretation: 'named_or_destination_locality_not_confirmed_target_position',
        coordinateMeaning: trimText(raw.meta?.coordinateMeaning || 'named_locality_centroid', 80),
        geocodedPlace: raw.meta?.geocodedPlace || null
      }
    };
  }

  async officialAlerts(force = false) {
    const task = this.alertQueue.then(() => this.officialAlertsSerial(force));
    this.alertQueue = task.catch(() => undefined);
    return task;
  }

  async officialAlertsSerial(force = false) {
    const now = Date.now();
    const stored = await this.ctx.storage.get('officialAlerts');
    if (!force && stored?.fetchedAt && now - stored.fetchedAt < ALERT_CACHE_SECONDS * 1000 && Array.isArray(stored.alerts)) return stored.alerts;
    if (!this.env.ALERTS_TOKEN) throw new Error('ALERTS_TOKEN is not configured');
    const response = await fetch(ALERTS_URL, { headers: { Authorization: `Bearer ${this.env.ALERTS_TOKEN}`, Accept: 'application/json' } });
    if (!response.ok) throw new Error(`alerts.in.ua returned ${response.status}`);
    const payload = await response.json();
    const alerts = Array.isArray(payload.alerts) ? payload.alerts : [];
    await this.ctx.storage.put('officialAlerts', { fetchedAt: Date.now(), alerts });
    return alerts;
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
      headers: {
        'User-Agent': 'RadarUa-PWA/1.0 (+https://github.com/XOTT69/RadarUa)',
        'Accept-Language': 'uk'
      }
    });
    if (!response.ok) throw new Error('geocoder_unavailable');
    const raw = await response.json();
    const list = isCoords ? (raw ? [raw] : []) : (Array.isArray(raw) ? raw : []);
    const items = list.map(toPlace).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    await this.ctx.storage.put(key, { storedAt: Date.now(), items });
    return items;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/stream' && request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify({ type: 'hello', time: new Date().toISOString() }));
      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === '/events' && request.method === 'GET') {
      return new Response(JSON.stringify({ items: await this.readEvents() }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/events' && request.method === 'POST') {
      const raw = await readJson(request);
      if (!raw) return new Response(JSON.stringify({ error: 'invalid_json' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      const event = this.normalizeEvent(raw);
      let items = await this.readEvents();
      items = [event, ...items.filter((e) => e.id !== event.id)].slice(0, MAX_EVENTS);
      await this.ctx.storage.put('events', items);
      for (const ws of this.ctx.getWebSockets()) {
        try { ws.send(JSON.stringify({ type: 'event', event })); } catch {}
      }
      return new Response(JSON.stringify({ ok: true, event }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/official-alerts' && request.method === 'GET') {
      try {
        const alerts = await this.officialAlerts(url.searchParams.get('refresh') === '1');
        return new Response(JSON.stringify({ alerts }), { headers: { 'Content-Type': 'application/json' } });
      } catch (error) {
        return new Response(JSON.stringify({ error: 'upstream_unavailable', message: error.message }), { status: 502, headers: { 'Content-Type': 'application/json' } });
      }
    }

    if (url.pathname === '/geocode' && request.method === 'GET') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 2) return new Response(JSON.stringify({ items: [] }), { headers: { 'Content-Type': 'application/json' } });
      try {
        const items = await this.geocode(q);
        return new Response(JSON.stringify({ items }), { headers: { 'Content-Type': 'application/json' } });
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

  webSocketClose(ws, code, reason) {
    try { ws.close(code, reason); } catch {}
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    if (!originAllowed(env, request)) return json({ error: 'origin_not_allowed' }, 403, env, request);

    if (url.pathname === '/health' && request.method === 'GET') {
      return json({
        ok: true,
        service: 'radarua-api',
        version: '1.0.0',
        alertsTokenConfigured: Boolean(env.ALERTS_TOKEN),
        ingestTokenConfigured: Boolean(env.INGEST_TOKEN),
        realtime: Boolean(env.RADAR_HUB),
        pushConfigured: pushEnabled(env)
      }, 200, env, request, { 'Cache-Control': 'no-store' });
    }
    if (url.pathname === '/api/places' && request.method === 'GET') return searchPlaces(request, env);
    if (url.pathname === '/api/threats' && request.method === 'GET') return threatsResponse(request, env);
    if (url.pathname === '/api/monitoring/events' && request.method === 'POST') return ingestEvent(request, env, ctx);
    if (url.pathname === '/api/monitoring/events' && request.method === 'GET') {
      const response = await getHub(env).fetch('https://hub/events');
      return new Response(response.body, { status: response.status, headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(env, request), 'Cache-Control': 'no-store' } });
    }
    if (url.pathname === '/api/stream' && request.method === 'GET' && request.headers.get('Upgrade') === 'websocket') {
      return getHub(env).fetch(new Request('https://hub/stream', { headers: request.headers }));
    }
    if (url.pathname === '/api/push/config' && request.method === 'GET') return json({ enabled: pushEnabled(env), publicKey: env.VAPID_PUBLIC_KEY || '' }, 200, env, request, { 'Cache-Control': 'no-store' });
    if (url.pathname === '/api/push/subscribe' && request.method === 'POST') return subscribePush(request, env);
    if (url.pathname === '/api/push/unsubscribe' && (request.method === 'POST' || request.method === 'DELETE')) return unsubscribePush(request, env);
    return json({ error: 'not_found' }, 404, env, request);
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(processOfficialPush(env));
  }
};
