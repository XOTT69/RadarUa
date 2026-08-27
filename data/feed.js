const config = window.RADAR_CONFIG || {};

function baseUrl() { return String(config.apiBaseUrl || '').replace(/\/$/, ''); }
export function apiReady() { return Boolean(baseUrl()); }

async function request(path, options = {}) {
  if (!apiReady()) throw new Error('API URL не налаштовано');
  const response = await fetch(`${baseUrl()}${path}`, {
    ...options,
    headers: { Accept: 'application/json', ...(options.headers || {}) },
    cache: options.cache || 'no-store'
  });
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = null; }
  if (!response.ok) throw new Error(payload?.message || payload?.error || `API ${response.status}`);
  return payload;
}

export function normalizeThreat(item) {
  return {
    id: String(item.id ?? crypto.randomUUID()),
    type: ['drone', 'missile', 'aviation', 'alert'].includes(item.type) ? item.type : 'alert',
    title: String(item.title ?? 'Подія'),
    detail: String(item.detail ?? ''),
    lat: Number.isFinite(Number(item.lat)) ? Number(item.lat) : null,
    lon: Number.isFinite(Number(item.lon)) ? Number(item.lon) : null,
    course: Number.isFinite(Number(item.course)) ? Number(item.course) : null,
    confidence: item.confidence ?? 'unknown',
    source: String(item.source ?? 'Unknown'),
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
  params.set('radius', Math.max(5, Math.min(100, Number(radiusKm) || 25)));
  const payload = await request(`/api/threats?${params}`);
  const items = Array.isArray(payload) ? payload : payload?.items;
  return {
    items: Array.isArray(items) ? items.map(normalizeThreat) : [],
    localityStatus: payload?.localityStatus || null,
    generatedAt: payload?.generatedAt || null,
    monitoring: payload?.monitoring || null,
    notice: payload?.notice || ''
  };
}

export async function searchPlaces(query) {
  const payload = await request(`/api/places?q=${encodeURIComponent(query)}`, { cache: 'default' });
  return Array.isArray(payload?.items) ? payload.items : [];
}

export function streamUrl() {
  if (!apiReady()) return '';
  return `${baseUrl().replace(/^http:/, 'ws:').replace(/^https:/, 'wss:')}/api/stream`;
}

export async function getPushConfig() {
  return request('/api/push/config', { cache: 'no-store' });
}

export async function savePushSubscription(subscription, place, radiusKm, monitoring = true) {
  return request('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subscription, place, radiusKm, monitoring })
  });
}

export async function deletePushSubscription(endpoint) {
  return request('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint })
  });
}
