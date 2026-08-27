import webpush from 'web-push';

const ALERTS_URL = 'https://api.alerts.in.ua/v1/alerts/active.json';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org';

// Умовні адміністративні точки. Це НЕ координати повітряних цілей.
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

function corsHeaders(env, request) {
  const configured = env.ALLOWED_ORIGIN || '*';
  const origin = request?.headers.get('Origin') || '';
  const allowed = configured.split(',').map((s) => s.trim()).filter(Boolean);
  const value = configured === '*' || !origin ? configured : (allowed.includes(origin) ? origin : allowed[0]);
  return {
    'Access-Control-Allow-Origin': value || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin'
  };
}
function json(data, status, env, request, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type':'application/json; charset=utf-8', ...corsHeaders(env, request), ...extra } });
}
function norm(value) {
  return String(value || '').toLocaleLowerCase('uk-UA').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
}
function sameish(a, b) {
  const x = norm(a), y = norm(b);
  return Boolean(x && y && (x === y || x.includes(y) || y.includes(x)));
}
function alertLabel(alert) {
  return {
    air_raid:'Повітряна тривога', artillery_shelling:'Загроза артобстрілу', urban_fights:'Вуличні бої',
    chemical:'Хімічна загроза', nuclear:'Радіаційна загроза'
  }[alert.alert_type] || 'Активна загроза';
}
function regionName(alert) {
  return alert.location_type === 'oblast' ? alert.location_title : (alert.location_oblast || '');
}
function sanitizePlace(place) {
  if (!place || typeof place !== 'object') return null;
  return {
    name: String(place.name || '').slice(0, 160),
    type: String(place.type || '').slice(0, 80),
    oblast: String(place.oblast || '').slice(0, 160),
    district: String(place.district || '').slice(0, 160),
    hromada: String(place.hromada || '').slice(0, 160),
    lat: Number.isFinite(Number(place.lat)) ? Number(place.lat) : null,
    lon: Number.isFinite(Number(place.lon)) ? Number(place.lon) : null
  };
}
function alertApplies(alert, place) {
  if (!place) return false;
  switch (alert.location_type) {
    case 'oblast':
      return sameish(alert.location_title, place.oblast) || (!place.oblast && sameish(alert.location_title, place.name));
    case 'raion':
      return sameish(alert.location_title, place.district) || sameish(alert.location_raion, place.district);
    case 'hromada':
      return sameish(alert.location_title, place.hromada) || sameish(alert.location_title, place.name);
    case 'city':
      return sameish(alert.location_title, place.name) || sameish(alert.location_title, place.hromada);
    default:
      return [place.name, place.hromada, place.district, place.oblast].filter(Boolean).some((value) => sameish(alert.location_title, value));
  }
}
function toThreat(alert, place) {
  const region = regionName(alert);
  const regionPoint = REGION_POINTS[region] || null;
  const applies = alertApplies(alert, place);
  // Якщо тривога стосується обраної зони, маркер показує точку обраного населеного пункту лише як статус зони.
  const lat = applies && Number.isFinite(place?.lat) ? place.lat : (regionPoint ? regionPoint[0] : null);
  const lon = applies && Number.isFinite(place?.lon) ? place.lon : (regionPoint ? regionPoint[1] : null);
  return {
    id:`alerts-in-ua-${alert.id}`, type:'alert', title:alertLabel(alert), detail:alert.location_title || region,
    lat, lon, course:null, confidence:applies ? 'locality-status' : 'region-status', source:'alerts.in.ua',
    timestamp:alert.updated_at || alert.started_at || new Date().toISOString(),
    meta:{
      alertType:alert.alert_type, locationType:alert.location_type, locationUid:alert.location_uid, region,
      raion:alert.location_raion || '', appliesToLocality:applies, approximatePoint:true, notes:alert.notes || ''
    }
  };
}
async function fetchActiveAlerts(env) {
  if (!env.ALERTS_TOKEN) throw new Error('ALERTS_TOKEN is not configured');
  const response = await fetch(ALERTS_URL, { headers:{ Authorization:`Bearer ${env.ALERTS_TOKEN}`, Accept:'application/json' } });
  if (!response.ok) throw new Error(`alerts.in.ua returned ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.alerts) ? payload.alerts : [];
}
function placeFromUrl(url) {
  const str = (key) => url.searchParams.get(key) || '';
  const num = (key) => { const value = Number(url.searchParams.get(key)); return Number.isFinite(value) ? value : null; };
  const name = str('place');
  if (!name && !str('oblast') && !str('district') && !str('hromada') && num('lat') == null) return null;
  return { name, oblast:str('oblast'), district:str('district'), hromada:str('hromada'), lat:num('lat'), lon:num('lon') };
}
function localityStatus(alerts, place) {
  if (!place) return null;
  const relevant = alerts.filter((alert) => alertApplies(alert, place));
  if (!relevant.length) {
    return { active:false, label:'Немає активної тривоги', detail:'За переліком активних офіційних тривог для вибраної адміністративної зони.' };
  }
  const primary = relevant.find((alert) => alert.alert_type === 'air_raid') || relevant[0];
  return {
    active:true, label:alertLabel(primary), detail:`${primary.location_title}${primary.location_type ? ` · ${primary.location_type}` : ''}`,
    startedAt:primary.started_at || null,
    alerts:relevant.map((alert) => ({ id:alert.id, type:alert.alert_type, title:alert.location_title, startedAt:alert.started_at }))
  };
}

async function fetchMonitorFeed(env) {
  if (!env.MONITOR_FEED_URL) return [];
  const headers = { Accept:'application/json' };
  if (env.MONITOR_FEED_TOKEN) headers.Authorization = `Bearer ${env.MONITOR_FEED_TOKEN}`;
  const response = await fetch(env.MONITOR_FEED_URL, { headers });
  if (!response.ok) throw new Error(`monitor feed returned ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload) ? payload : (Array.isArray(payload.items) ? payload.items : []);
}
function monitorApplies(item, place) {
  if (!place) return false;
  const fields = [item.locality, item.hromada, item.district, item.oblast].filter(Boolean);
  return fields.some((field) => [place.name, place.hromada, place.district, place.oblast].filter(Boolean).some((target) => sameish(field, target)));
}
function toMonitorThreat(item, place) {
  const type = ['drone','missile','aviation','alert'].includes(item.type) ? item.type : 'alert';
  const applies = monitorApplies(item, place);
  const regionPoint = REGION_POINTS[item.oblast] || null;
  return {
    id:`monitor-${String(item.id || crypto.randomUUID())}`, type,
    title:String(item.title || 'Моніторингове повідомлення'), detail:String(item.detail || item.locality || item.oblast || ''),
    lat:applies && Number.isFinite(place?.lat) ? place.lat : (regionPoint ? regionPoint[0] : null),
    lon:applies && Number.isFinite(place?.lon) ? place.lon : (regionPoint ? regionPoint[1] : null),
    course:null, confidence:'coarse-public-monitoring', source:String(item.source || 'monitor feed'),
    timestamp:item.timestamp || new Date().toISOString(),
    meta:{ appliesToLocality:applies, region:item.oblast || '', raion:item.district || '', hromada:item.hromada || '', approximatePoint:true, unofficial:true }
  };
}

async function threatsResponse(request, env) {
  const url = new URL(request.url);
  const place = placeFromUrl(url);
  try {
    const alertsPromise = fetchActiveAlerts(env);
    const monitorPromise = fetchMonitorFeed(env).catch((error) => { console.warn(error); return []; });
    const [alerts, monitor] = await Promise.all([alertsPromise, monitorPromise]);
    const items = [...alerts.map((alert) => toThreat(alert, place)), ...monitor.map((item) => toMonitorThreat(item, place))];
    return json({
      items, localityStatus:localityStatus(alerts, place), generatedAt:new Date().toISOString(),
      notice:'Маркери є умовними адміністративними точками або статусом вибраної зони; вони не є координатами повітряних цілей.'
    }, 200, env, request, { 'Cache-Control':`public,max-age=${Number(env.CACHE_SECONDS || 15)}` });
  } catch (error) {
    console.error(error);
    return json({ error:'upstream_unavailable', message:error.message }, 502, env, request, { 'Cache-Control':'no-store' });
  }
}

function inferPlaceType(address, result) {
  if (address.city || address.town) return 'місто';
  if (address.village || address.hamlet) return 'село';
  if (address.municipality) return 'громада';
  return result.type === 'administrative' ? 'територія' : 'населений пункт';
}
function toPlace(result) {
  const address = result.address || {};
  const name = address.city || address.town || address.village || address.hamlet || address.municipality || result.name || String(result.display_name || '').split(',')[0];
  return {
    id:`osm-${result.osm_type}-${result.osm_id}`, name, type:inferPlaceType(address, result), lat:Number(result.lat), lon:Number(result.lon),
    oblast:address.state || address.region || '', district:address.county || address.district || '',
    hromada:address.municipality || address.city_district || '', displayName:result.display_name || name, source:'OpenStreetMap/Nominatim'
  };
}
async function searchPlaces(request, env) {
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (q.length < 2) return json({ items:[] }, 200, env, request);
  const isCoords = /^-?\d{1,2}\.\d+\s*,\s*-?\d{1,3}\.\d+$/.test(q);
  const upstream = isCoords
    ? `${NOMINATIM_URL}/reverse?format=jsonv2&lat=${encodeURIComponent(q.split(',')[0].trim())}&lon=${encodeURIComponent(q.split(',')[1].trim())}&addressdetails=1&accept-language=uk`
    : `${NOMINATIM_URL}/search?format=jsonv2&countrycodes=ua&limit=8&addressdetails=1&accept-language=uk&q=${encodeURIComponent(q)}`;
  const cache = caches.default;
  const cacheKey = new Request(upstream, { method:'GET' });
  let response = await cache.match(cacheKey);
  if (!response) {
    response = await fetch(upstream, { headers:{ 'User-Agent':'RadarUa-PWA/3.0 (+https://github.com/XOTT69/RadarUa)', 'Accept-Language':'uk' } });
    if (response.ok) await cache.put(cacheKey, response.clone());
  }
  if (!response.ok) return json({ error:'geocoder_unavailable' }, 502, env, request);
  const raw = await response.json();
  const list = isCoords ? (raw ? [raw] : []) : (Array.isArray(raw) ? raw : []);
  return json({ items:list.map(toPlace).filter((place) => Number.isFinite(place.lat) && Number.isFinite(place.lon)), attribution:'© OpenStreetMap contributors; geocoding by Nominatim' }, 200, env, request, { 'Cache-Control':'public,max-age=604800' });
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function pushEnabled(env) {
  return Boolean(env.SUBSCRIPTIONS && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY && env.VAPID_SUBJECT);
}
function publicPushConfig(request, env) {
  return json({ enabled:pushEnabled(env), publicKey:env.VAPID_PUBLIC_KEY || '' }, 200, env, request, { 'Cache-Control':'no-store' });
}
async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}
async function subscribePush(request, env) {
  if (!pushEnabled(env)) return json({ error:'push_not_configured', message:'Push не налаштовано на Worker.' }, 503, env, request);
  const body = await readJson(request);
  const subscription = body?.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth || !String(subscription.endpoint).startsWith('https://')) {
    return json({ error:'invalid_subscription' }, 400, env, request);
  }
  const place = sanitizePlace(body.place);
  if (!place?.name && !place?.oblast && !place?.district && !place?.hromada) return json({ error:'place_required' }, 400, env, request);
  const id = await sha256(subscription.endpoint);
  // Для push навмисно не зберігаємо координати користувача.
  const storedPlace = { name:place.name, type:place.type, oblast:place.oblast, district:place.district, hromada:place.hromada };
  await env.SUBSCRIPTIONS.put(`sub:${id}`, JSON.stringify({ subscription, place:storedPlace, radiusKm:Number(body.radiusKm || 25), updatedAt:new Date().toISOString() }));
  return json({ ok:true }, 200, env, request, { 'Cache-Control':'no-store' });
}
async function unsubscribePush(request, env) {
  if (!env.SUBSCRIPTIONS) return json({ ok:true }, 200, env, request);
  const body = await readJson(request);
  if (!body?.endpoint) return json({ error:'endpoint_required' }, 400, env, request);
  const id = await sha256(body.endpoint);
  await Promise.all([env.SUBSCRIPTIONS.delete(`sub:${id}`), env.SUBSCRIPTIONS.delete(`state:${id}`)]);
  return json({ ok:true }, 200, env, request, { 'Cache-Control':'no-store' });
}

async function listAllSubscriptions(env) {
  const records = [];
  let cursor;
  do {
    const page = await env.SUBSCRIPTIONS.list({ prefix:'sub:', cursor });
    for (const key of page.keys) {
      const value = await env.SUBSCRIPTIONS.get(key.name, 'json');
      if (value) records.push({ key:key.name, id:key.name.slice(4), ...value });
    }
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return records;
}
async function sendPush(env, record, payload) {
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  try {
    await webpush.sendNotification(record.subscription, JSON.stringify(payload), { TTL:120, urgency:'high' });
    return true;
  } catch (error) {
    const status = Number(error?.statusCode || error?.status || 0);
    if (status === 404 || status === 410) {
      await Promise.all([env.SUBSCRIPTIONS.delete(record.key), env.SUBSCRIPTIONS.delete(`state:${record.id}`)]);
      return false;
    }
    console.error('Push delivery failed', status, error?.message || error);
    return false;
  }
}
async function processPushTick(env) {
  if (!pushEnabled(env)) return;
  const alerts = await fetchActiveAlerts(env);
  const subscriptions = await listAllSubscriptions(env);
  for (const record of subscriptions) {
    const status = localityStatus(alerts, record.place) || { active:false };
    const previous = await env.SUBSCRIPTIONS.get(`state:${record.id}`, 'json');
    if (!previous) {
      await env.SUBSCRIPTIONS.put(`state:${record.id}`, JSON.stringify({ active:status.active, label:status.label || '', updatedAt:new Date().toISOString() }));
      continue;
    }
    if (Boolean(previous.active) !== Boolean(status.active)) {
      const locality = record.place?.name || record.place?.hromada || record.place?.district || record.place?.oblast || 'ваша зона';
      const payload = status.active
        ? { title:`⚠️ RadarUa · ${locality}`, body:status.label || 'Активна тривога у вашій зоні.', tag:`radarua-${record.id}-active`, url:'./' }
        : { title:`✅ RadarUa · ${locality}`, body:'За офіційними активними даними для вибраної зони тривога завершилася.', tag:`radarua-${record.id}-clear`, url:'./' };
      await sendPush(env, record, payload);
    }
    await env.SUBSCRIPTIONS.put(`state:${record.id}`, JSON.stringify({ active:status.active, label:status.label || '', updatedAt:new Date().toISOString() }));
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status:204, headers:corsHeaders(env, request) });

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok:true, service:'radarua-api', version:'3.0.0', alertsTokenConfigured:Boolean(env.ALERTS_TOKEN), pushConfigured:pushEnabled(env), monitorFeedConfigured:Boolean(env.MONITOR_FEED_URL) }, 200, env, request, { 'Cache-Control':'no-store' });
    }
    if (request.method === 'GET' && url.pathname === '/api/threats') return threatsResponse(request, env);
    if (request.method === 'GET' && url.pathname === '/api/places') return searchPlaces(request, env);
    if (request.method === 'GET' && url.pathname === '/api/push/config') return publicPushConfig(request, env);
    if (request.method === 'POST' && url.pathname === '/api/push/subscribe') return subscribePush(request, env);
    if (request.method === 'POST' && url.pathname === '/api/push/unsubscribe') return unsubscribePush(request, env);
    return json({ error:'not_found' }, 404, env, request);
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(processPushTick(env));
  }
};
