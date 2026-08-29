const config = window.RADAR_CONFIG || {};

function baseUrl() { return String(config.apiBaseUrl || '').replace(/\/$/, ''); }
export function apiReady() { return Boolean(baseUrl()); }

async function request(path, options = {}) {
  if (!apiReady()) throw new Error('URL backend не налаштовано');
  const response = await fetch(`${baseUrl()}${path}`, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
    cache: options.cache || 'no-store'
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Backend ${response.status}`);
  return payload;
}

export function normalizeThreat(item) {
  const allowed = ['drone', 'missile', 'kab', 'aviation', 'explosion', 'clear'];
  return {
    id: String(item.id ?? crypto.randomUUID()),
    type: allowed.includes(item.type) ? item.type : 'explosion',
    title: String(item.title ?? 'Подія'),
    detail: String(item.detail ?? ''),
    lat: Number.isFinite(Number(item.lat)) ? Number(item.lat) : null,
    lon: Number.isFinite(Number(item.lon)) ? Number(item.lon) : null,
    course: Number.isFinite(Number(item.course)) ? Number(item.course) : null,
    confidence: item.confidence ?? 'unknown',
    source: String(item.source ?? 'Telegram'),
    timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
    meta: item.meta && typeof item.meta === 'object' ? item.meta : {}
  };
}

export async function loadThreats(place, radiusKm = 25) {
  const params = new URLSearchParams();
  if (place?.lat != null) params.set('lat', place.lat);
  if (place?.lon != null) params.set('lon', place.lon);
  if (place?.name) params.set('place', place.name);
  if (place?.oblast) params.set('oblast', place.oblast);
  if (place?.district) params.set('district', place.district);
  if (place?.hromada) params.set('hromada', place.hromada);
  if (place?.locality) params.set('locality', place.locality);
  params.set('radius', Math.max(5, Math.min(100, Number(radiusKm) || 25)));
  const payload = await request(`/api/threats?${params}`);
  const items = Array.isArray(payload) ? payload : payload?.items;
  return {
    items: Array.isArray(items) ? items.map(normalizeThreat) : [],
    generatedAt: payload?.generatedAt || null,
    monitoring: payload?.monitoring || null,
    notice: payload?.notice || ''
  };
}

export async function loadAlerts() {
  const payload = await request('/api/alerts', { cache: 'default' });
  return {
    updatedAt: payload?.updatedAt || null,
    raions: Array.isArray(payload?.raions) ? payload.raions : [],
    oblasts: Array.isArray(payload?.oblasts) ? payload.oblasts : [],
    features: payload?.features?.type === 'FeatureCollection' && Array.isArray(payload.features.features)
      ? payload.features : { type: 'FeatureCollection', features: [] },
    attributionUrl: payload?.attributionUrl || 'https://neptun.in.ua/'
  };
}

export async function loadUkraineOutline() {
  const payload = await request('/api/map/ukraine', { cache: 'default' });
  if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features)) throw new Error('Контур України недоступний');
  return { ...payload, attributionUrl: payload.attributionUrl || 'https://neptun.in.ua/' };
}

export async function searchPlaces(query) {
  const payload = await request(`/api/places?q=${encodeURIComponent(query)}`, { cache: 'default' });
  return Array.isArray(payload?.items) ? payload.items : [];
}

export function streamUrl() {
  if (!apiReady()) return '';
  return `${baseUrl().replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')}/api/stream`;
}
export async function getStatus() { return request('/api/status'); }
export async function getPushConfig() { return request('/api/push/config', { cache: 'no-store' }); }
export async function savePushSubscription(subscription, place, radiusKm, monitoring = true) {
  return request('/api/push/subscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription, place, radiusKm, monitoring })
  });
}
export async function deletePushSubscription(endpoint) {
  return request('/api/push/unsubscribe', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint })
  });
}
