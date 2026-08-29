import { apiReady, loadThreats, loadAlerts, loadUkraineOutline, searchPlaces, streamUrl, normalizeThreat, getPushConfig, savePushSubscription, deletePushSubscription } from './data/feed.js';

const config = window.RADAR_CONFIG || {};
const STORAGE_KEY = 'radarua.settings.v2';
const $ = (id) => document.getElementById(id);
const state = {
  map: null, threats: [], markers: new Map(), filter: 'all', sourceFilter: 'all', home: null, gps: null,
  homeMarker: null, homeRadius: null, gpsMarker: null, installPrompt: null,
  refreshTimer: null, ws: null, wsReconnectTimer: null, wsConnected: false,
  monitoringStatus: null, alerts: { raions: [], oblasts: [], features: { type: 'FeatureCollection', features: [] } },
  alertLayer: null, ukraineLayer: null, neighborLayer: null, ukraineOutline: null,
  settings: loadSettings(), knownIds: new Set(), initialized: false
};

const typeMeta = {
  drone: { label: 'БПЛА', symbol: '◆' },
  missile: { label: 'Ракета', symbol: '➤' },
  kab: { label: 'КАБ', symbol: '▼' },
  aviation: { label: 'Авіація', symbol: '✦' },
  explosion: { label: 'Вибухи / ППО', symbol: '●' },
  clear: { label: 'Відбій', symbol: '✓' }
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || localStorage.getItem('radarua.settings.v1') || '{}');
    return {
      radiusKm: Number(saved.radiusKm || config.defaultRadiusKm || 25),
      onlyMine: saved.onlyMine ?? Boolean(config.defaultOnlyMyArea),
      notifications: saved.notifications ?? false,
      monitoring: saved.monitoring ?? true,
      home: saved.home || null,
      hiddenEventIds: Array.isArray(saved.hiddenEventIds) ? saved.hiddenEventIds.map(String).slice(-500) : []
    };
  } catch {
    return { radiusKm: 25, onlyMine: true, notifications: false, monitoring: true, home: null, hiddenEventIds: [] };
  }
}
function saveSettings() {
  state.settings.home = state.home;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
}
function normalizeText(v) {
  return String(v || '').toLocaleLowerCase('uk-UA').replace(/[’']/g, "'").replace(/[^\p{L}\p{N}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();
}
function initMap() {
  const ukraineBounds = L.latLngBounds([[44.0, 20.7], [53.7, 41.8]]);
  state.map = L.map('map', { zoomControl: false, attributionControl: false, minZoom: 5, maxZoom: 10, maxBounds: ukraineBounds.pad(.04), maxBoundsViscosity: 1 }).setView([49.0, 31.3], 6);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
}
function escapeHtml(value) {
  return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function formatAge(timestamp) {
  const ms = Date.now() - new Date(timestamp).getTime();
  if (!Number.isFinite(ms)) return 'час невідомий';
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec} с тому`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} хв тому`;
  const hr = Math.floor(min / 60);
  return hr < 24 ? `${hr} год тому` : `${Math.floor(hr / 24)} д тому`;
}
function haversineKm(lat1, lon1, lat2, lon2) {
  const r = 6371, toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}
function markerIcon(threat) {
  const meta = typeMeta[threat.type] || typeMeta.explosion;
  return L.divIcon({ className: 'threat-marker-wrap', html: `<div class="threat-marker threat-${threat.type}"><span>${meta.symbol}</span></div>`, iconSize: [42, 42], iconAnchor: [21, 21] });
}
function formatHomeName(home) {
  if (!home) return 'Не вибрано';
  return home.type === 'адреса' ? home.name : `${home.type ? `${home.type} ` : ''}${home.name}`;
}
function isNeptunThreat(threat) {
  return threat.source === 'NEPTUN' || threat.meta?.sourceAccess === 'neptun_api';
}
function hiddenIds() { return new Set(state.settings.hiddenEventIds || []); }
function sourceMatches(threat) {
  return state.sourceFilter === 'all' || (state.sourceFilter === 'neptun' ? isNeptunThreat(threat) : !isNeptunThreat(threat));
}
function textMatchesHome(threat) {
  if (!state.home) return true;
  const hay = normalizeText([
    threat.meta?.location, threat.meta?.geocodedPlace?.name, threat.meta?.geocodedPlace?.hromada,
    threat.meta?.geocodedPlace?.district, threat.meta?.geocodedPlace?.oblast, threat.title, threat.detail
  ].filter(Boolean).join(' '));
  return [state.home.locality, state.home.name, state.home.hromada, state.home.district, state.home.oblast]
    .filter(Boolean).map(normalizeText).some((needle) => needle && hay.includes(needle));
}
function sameish(a, b) {
  const clean = (v) => normalizeText(v).replace(/\b(?:область|район|громада|територіальна|міська|селищна|сільська)\b/gu, '').replace(/\s+/g, ' ').trim();
  const x = clean(a), y = clean(b);
  return Boolean(x && y && (x === y || (x.length >= 4 && y.length >= 4 && (x.includes(y) || y.includes(x)))));
}
function isThreatRelevant(threat) {
  if (!state.home) return true;
  if (threat.meta?.locationScope === 'region' && threat.meta?.oblast) return sameish(threat.meta.oblast, state.home.oblast);
  if (threat.lat != null && threat.lon != null && Number.isFinite(state.home.lat) && Number.isFinite(state.home.lon)) {
    return haversineKm(state.home.lat, state.home.lon, threat.lat, threat.lon) <= state.settings.radiusKm;
  }
  return textMatchesHome(threat);
}
function visibleThreats() {
  if (!state.settings.monitoring) return [];
  const hidden = hiddenIds();
  return state.threats.filter((t) => !hidden.has(t.id) && sourceMatches(t) && (state.filter === 'all' || t.type === state.filter) && (!state.settings.onlyMine || isThreatRelevant(t)));
}
function feedStateText() {
  const s = state.monitoringStatus;
  const label = s?.sourceMode?.includes('neptun_api') ? 'Джерела + NEPTUN' : 'Telegram';
  if (!s) return `стан ${label} ще не отримано`;
  if (s.state === 'online') return `${label} онлайн · ${s.channelCount || 0} джерел`;
  if (s.state === 'stale') return `${label} давно не оновлювався · ${s.lastHeartbeatAt ? formatAge(s.lastHeartbeatAt) : ''}`;
  return `${label} недоступні або ще не запущені`;
}
function renderFeedHealth() {
  const s = state.monitoringStatus;
  const badge = $('modeBadge');
  if (!apiReady()) {
    badge.textContent = 'SETUP'; badge.className = 'badge warning-badge'; return;
  }
  if (s?.state === 'online') { badge.textContent = state.wsConnected ? 'TG RT' : 'TG'; badge.className = 'badge'; }
  else if (s?.state === 'stale') { badge.textContent = 'STALE'; badge.className = 'badge warning-badge'; }
  else { badge.textContent = 'OFF'; badge.className = 'badge danger-badge'; }
}
function activeAlertForHome(home = state.home) {
  if (!home) return null;
  const locality = [home.locality, home.name, home.hromada, home.district].filter(Boolean);
  const raion = state.alerts.raions.find((item) => sameish(item.oblast, home.oblast) && locality.some((value) => sameish(item.name, value)));
  if (raion) return { ...raion, level: 'район' };
  const oblast = state.alerts.oblasts.find((item) => sameish(item.name || item.oblast, home.oblast));
  return oblast ? { ...oblast, level: 'область' } : null;
}
function renderAlertAreas() {
  if (!state.map) return;
  state.alertLayer?.remove();
  const features = state.alerts.features?.features || [];
  if (!features.length) { $('alertLegend').classList.add('hidden'); return; }
  state.alertLayer = L.geoJSON(state.alerts.features, {
    style: { color: '#ff4d5f', weight: 1.5, opacity: .86, fillColor: '#ff4d5f', fillOpacity: .18 },
    onEachFeature(feature, layer) {
      const key = feature?.properties?.key;
      const alert = state.alerts.raions.find((item) => item.key === key);
      if (alert) layer.bindTooltip(`${escapeHtml(alert.name)} · повітряна тривога`, { sticky: true });
    }
  }).addTo(state.map);
  $('alertLegend').classList.remove('hidden');
  $('alertLegend').innerHTML = `<span></span> Активні райони тривоги · <a href="${escapeHtml(state.alerts.attributionUrl || 'https://neptun.in.ua/')}" target="_blank" rel="noopener noreferrer">NEPTUN</a>`;
}
function neighborLabel(name, lat, lon) {
  return L.marker([lat, lon], { interactive: false, keyboard: false, icon: L.divIcon({ className: 'neighbor-label-wrap', html: `<span class="neighbor-label">${escapeHtml(name)}</span>`, iconSize: [90, 22], iconAnchor: [45, 11] }) });
}
function renderUkraineOutline() {
  if (!state.map || !state.ukraineOutline) return;
  state.ukraineLayer?.remove(); state.neighborLayer?.remove();
  state.ukraineLayer = L.geoJSON(state.ukraineOutline, {
    style: { color: '#86bbf3', weight: 1.25, opacity: .8, fillColor: '#16334e', fillOpacity: .64 },
    onEachFeature(feature, layer) { layer.bindTooltip(escapeHtml(feature?.properties?.region || 'Область'), { sticky: true, className: 'oblast-tooltip' }); }
  }).addTo(state.map);
  state.neighborLayer = L.layerGroup([
    neighborLabel('Білорусь', 52.8, 28.2), neighborLabel('Польща', 50.8, 21.7), neighborLabel('Словаччина', 49.0, 21.8),
    neighborLabel('Угорщина', 48.0, 22.0), neighborLabel('Румунія', 47.2, 25.7), neighborLabel('Молдова', 47.0, 29.0), neighborLabel('Росія', 51.1, 39.8)
  ]).addTo(state.map);
  const bounds = state.ukraineLayer.getBounds();
  if (bounds.isValid()) state.map.fitBounds(bounds.pad(.12), { padding: [16, 84], maxZoom: 6.5, animate: false });
}
async function loadUkraineMap() {
  if (!apiReady()) return;
  try { state.ukraineOutline = await loadUkraineOutline(); renderUkraineOutline(); }
  catch (error) { console.warn('Ukraine outline unavailable', error); }
}
function renderHome() {
  state.home = state.settings.home || state.home;
  const home = state.home;
  $('localityName').textContent = formatHomeName(home);
  if (!home) {
    $('localityStatus').textContent = 'Натисніть, щоб обрати';
    $('localityStatusDot').className = 'locality-status-dot';
    state.homeMarker?.remove(); state.homeRadius?.remove();
    return;
  }
  const localCount = state.settings.monitoring ? state.threats.filter(isThreatRelevant).length : 0;
  const officialAlert = activeAlertForHome(home);
  const s = state.monitoringStatus;
  if (!state.settings.monitoring) {
    $('localityStatus').textContent = 'Моніторинг вимкнений у налаштуваннях';
    $('localityStatusDot').className = 'locality-status-dot';
  } else if (officialAlert) {
    $('localityStatus').textContent = `Повітряна тривога: ${officialAlert.name} · з ${new Date(officialAlert.since).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })} · дані NEPTUN`;
    $('localityStatusDot').className = 'locality-status-dot danger';
  } else if (s?.state === 'online') {
    $('localityStatus').textContent = localCount ? `${localCount} свіжих подій у радіусі ${state.settings.radiusKm} км · джерела онлайн` : `Свіжих повідомлень у радіусі ${state.settings.radiusKm} км не знайдено · це не означає «безпечно»`;
    $('localityStatusDot').className = 'locality-status-dot online';
  } else if (s?.state === 'stale') {
    $('localityStatus').textContent = `Дані застаріли · останній heartbeat ${s.lastHeartbeatAt ? formatAge(s.lastHeartbeatAt) : 'невідомо коли'}`;
    $('localityStatusDot').className = 'locality-status-dot stale';
  } else {
    $('localityStatus').textContent = s ? 'Потік даних недоступний — дані можуть бути неповними' : ([home.hromada, home.district, home.oblast].filter(Boolean).join(' · ') || 'Збережено');
    $('localityStatusDot').className = s ? 'locality-status-dot danger' : 'locality-status-dot';
  }
  if (Number.isFinite(home.lat) && Number.isFinite(home.lon)) {
    state.homeMarker?.remove(); state.homeRadius?.remove();
    state.homeMarker = L.marker([home.lat, home.lon], { icon: L.divIcon({ className: 'home-marker-wrap', html: '<div class="home-marker">⌂</div>', iconSize: [38, 38], iconAnchor: [19, 19] }) }).addTo(state.map).bindPopup(`Ваша локація: ${escapeHtml(formatHomeName(home))}`);
    state.homeRadius = L.circle([home.lat, home.lon], { radius: state.settings.radiusKm * 1000, weight: 1, opacity: .8, fillOpacity: .05, className: 'home-radius' }).addTo(state.map);
  }
}
function sourceLine(threat) {
  const count = Number(threat.meta?.sourceCount || 1);
  const confirmed = threat.meta?.corroborated ? ` · підтверджено ${count} джерелами` : '';
  return `${threat.source}${confirmed}`;
}
function renderMarkers() {
  for (const marker of state.markers.values()) marker.remove();
  state.markers.clear();
  for (const threat of visibleThreats()) {
    if (threat.lat == null || threat.lon == null) continue;
    const marker = L.marker([threat.lat, threat.lon], { icon: markerIcon(threat) }).addTo(state.map);
    const approx = threat.meta?.approximatePoint ? '<p><b>Приблизна прив’язка:</b> центр згаданого населеного пункту, не координата цілі.</p>' : '';
    const sourceUrl = /^(https:\/\/t\.me\/|https:\/\/neptun\.in\.ua\/)/.test(threat.meta?.sourceUrl || '') ? `<a href="${escapeHtml(threat.meta.sourceUrl)}" target="_blank" rel="noopener noreferrer">джерело</a>` : escapeHtml(threat.source);
    marker.bindPopup(`<div class="popup"><strong>${escapeHtml(threat.title)}</strong><p>${escapeHtml(threat.detail)}</p>${approx}<small>${sourceUrl} · ${formatAge(threat.timestamp)}</small></div>`);
    state.markers.set(threat.id, marker);
  }
}
function renderCounts() {
  const hidden = hiddenIds();
  const enabled = state.settings.monitoring ? state.threats.filter((item) => !hidden.has(item.id) && sourceMatches(item)) : [];
  const pool = state.settings.onlyMine ? enabled.filter(isThreatRelevant) : enabled;
  const counts = { drone: 0, missile: 0, kab: 0, aviation: 0, explosion: 0, clear: 0 };
  for (const t of pool) if (counts[t.type] != null) counts[t.type]++;
  $('countAll').textContent = pool.length;
  for (const type of Object.keys(counts)) $(`count${type[0].toUpperCase()}${type.slice(1)}`).textContent = counts[type];
  $('eventCount').textContent = visibleThreats().length;
  $('eventPanelTitle').textContent = state.settings.onlyMine && state.home ? `Події · ${formatHomeName(state.home)}` : 'Останні події';
  const restore = $('restoreHiddenBtn');
  restore.classList.toggle('hidden', !(state.settings.hiddenEventIds || []).length);
  restore.textContent = `Повернути (${(state.settings.hiddenEventIds || []).length})`;
}
function renderEvents() {
  const items = [...visibleThreats()].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const list = $('eventList');
  if (!items.length) {
    list.innerHTML = `<div class="empty">${state.home && state.settings.onlyMine ? 'Для вибраної зони свіжих подій не знайдено. Це не є підтвердженням відсутності загрози.' : 'Подій у цьому фільтрі немає.'}</div>`;
    return;
  }
  list.innerHTML = items.map((t) => {
    const meta = typeMeta[t.type] || typeMeta.explosion;
    const distance = state.home && t.lat != null && t.meta?.locationScope !== 'region' ? haversineKm(state.home.lat, state.home.lon, t.lat, t.lon) : null;
    const relevant = state.home && isThreatRelevant(t) ? '<span class="relevant-pill">ваша зона</span>' : '';
    const approx = t.meta?.approximatePoint ? ' · ≈ населений пункт' : '';
    const source = isNeptunThreat(t) ? '<span class="source-pill neptun-pill">NEPTUN</span>' : '<span class="source-pill telegram-pill">Telegram</span>';
    return `<article class="event-row"><button class="event-item" data-id="${escapeHtml(t.id)}" type="button"><span class="event-icon threat-${t.type}">${meta.symbol}</span><span class="event-main"><strong>${escapeHtml(t.title)} ${relevant} ${source}</strong><span>${escapeHtml(t.meta?.location || t.detail)}</span><small>${formatAge(t.timestamp)} · ${escapeHtml(sourceLine(t))}${distance == null ? '' : ` · ~${distance.toFixed(0)} км`}${approx}</small></span></button><button class="event-dismiss" data-id="${escapeHtml(t.id)}" type="button" aria-label="Прибрати подію зі списку" title="Прибрати лише на цьому пристрої">×</button></article>`;
  }).join('');
  list.querySelectorAll('.event-item').forEach((btn) => btn.addEventListener('click', () => {
    const t = state.threats.find((x) => x.id === btn.dataset.id);
    if (!t || t.lat == null) return;
    state.map.flyTo([t.lat, t.lon], Math.min(10, Math.max(state.map.getZoom(), 8)), { duration: .6 });
    state.markers.get(t.id)?.openPopup();
  }));
  list.querySelectorAll('.event-dismiss').forEach((btn) => btn.addEventListener('click', () => hideEvents([btn.dataset.id])));
}
function renderProximity() {
  const card = $('proximityCard');
  if (!state.home) { card.classList.add('hidden'); return; }
  const points = visibleThreats()
    .filter((t) => t.lat != null && t.lon != null && t.type !== 'clear' && t.meta?.locationScope !== 'region')
    .map((t) => ({ ...t, distance: haversineKm(state.home.lat, state.home.lon, t.lat, t.lon) }))
    .sort((a, b) => a.distance - b.distance);
  if (!points.length) { card.classList.add('hidden'); return; }
  const nearest = points[0];
  $('proximityTitle').textContent = nearest.distance <= state.settings.radiusKm ? 'Згадана подія у вашому радіусі' : 'Найближча згадана місцевість';
  $('proximityText').textContent = `${nearest.title}: центр згаданої місцевості ~${nearest.distance.toFixed(0)} км від ${state.home.name}.`;
  card.classList.toggle('danger', nearest.distance <= state.settings.radiusKm);
  card.classList.remove('hidden');
}
function renderAll() { renderAlertAreas(); renderHome(); renderFeedHealth(); renderCounts(); renderMarkers(); renderEvents(); renderProximity(); }
function setConnection(text) { $('connectionLabel').textContent = text; }
function showToast(message) {
  const toast = $('toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 3500);
}
function hideEvents(ids) {
  const next = new Set(state.settings.hiddenEventIds || []);
  ids.filter(Boolean).forEach((id) => next.add(String(id)));
  state.settings.hiddenEventIds = [...next].slice(-500);
  saveSettings(); renderAll();
  showToast(ids.length === 1 ? 'Подію прибрано лише з цього пристрою.' : `Прибрано ${ids.length} подій лише з цього пристрою.`);
}
function restoreHiddenEvents() {
  state.settings.hiddenEventIds = []; saveSettings(); renderAll(); showToast('Приховані події повернуто.');
}
async function maybeNotifyNew(items) {
  if (!state.initialized) { items.forEach((t) => state.knownIds.add(t.id)); return; }
  const relevant = items.filter((t) => isThreatRelevant(t) && t.type !== 'clear');
  const fresh = relevant.filter((t) => !state.knownIds.has(t.id));
  items.forEach((t) => state.knownIds.add(t.id));
  if (config.enableBackgroundPush || !state.settings.notifications || !('Notification' in window) || Notification.permission !== 'granted' || !fresh.length) return;
  const newest = fresh.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  if (Date.now() - new Date(newest.timestamp).getTime() > 3 * 60 * 1000) return;
  const reg = await navigator.serviceWorker?.ready;
  reg?.showNotification(`RadarUa · ${newest.title}`, { body: `Згадано: ${newest.meta?.location || newest.detail}`, icon: './assets/icons/icon-192.png', tag: `radar-${newest.id}` });
}
async function refreshThreats({ silent = false } = {}) {
  if (!apiReady()) {
    setConnection('потрібен URL Worker'); state.threats = []; state.monitoringStatus = null; renderAll(); return;
  }
  if (!silent) setConnection('оновлення джерел…');
  try {
    const [result, alerts] = await Promise.all([
      loadThreats(state.home, state.settings.radiusKm),
      loadAlerts().catch((error) => { console.warn('Alert layer unavailable', error); return null; })
    ]);
    await maybeNotifyNew(result.items);
    state.threats = result.items;
    state.monitoringStatus = result.monitoring;
    if (alerts) state.alerts = alerts;
    state.initialized = true;
    renderAll();
    $('lastUpdated').textContent = `оновлено ${new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`;
    const sourceLabel = state.monitoringStatus?.sourceMode?.includes('neptun_api') ? 'Telegram + NEPTUN' : (state.monitoringStatus?.sourceMode === 'public_telegram_web' ? 'Публічні Telegram-канали' : 'Telegram');
    if (state.monitoringStatus?.state === 'online') setConnection(state.wsConnected ? `${sourceLabel} · realtime` : `${sourceLabel} · онлайн`);
    else if (state.monitoringStatus?.state === 'stale') setConnection(`${sourceLabel} · дані застаріли`);
    else setConnection(`${sourceLabel} · потік офлайн`);
  } catch (error) {
    console.error(error); setConnection('помилка backend'); if (!silent) showToast(error.message || 'Не вдалося оновити дані');
  }
}
function openSettings() {
  $('settingsSheet').classList.remove('hidden'); $('sheetBackdrop').classList.remove('hidden');
  $('radiusRange').value = state.settings.radiusKm; $('radiusValue').textContent = state.settings.radiusKm;
  $('onlyMineToggle').checked = state.settings.onlyMine; $('monitoringToggle').checked = state.settings.monitoring; $('notificationsToggle').checked = state.settings.notifications;
  setTimeout(() => $('localitySearch').focus(), 80);
}
function closeSettings() { $('settingsSheet').classList.add('hidden'); $('sheetBackdrop').classList.add('hidden'); }
async function performPlaceSearch() {
  const q = $('localitySearch').value.trim();
  if (q.length < 2) { $('searchStatus').textContent = 'Введіть щонайменше 2 символи.'; return; }
  $('searchStatus').textContent = 'Шукаю…'; $('searchResults').innerHTML = '';
  try {
    const items = await searchPlaces(q);
    $('searchStatus').textContent = items.length ? 'Оберіть правильну адресу або населений пункт:' : 'Нічого не знайдено.';
    $('searchResults').innerHTML = items.map((p, i) => `<button class="place-result" type="button" data-index="${i}"><strong>${escapeHtml(formatHomeName(p))}</strong><span>${escapeHtml(p.displayName || [p.hromada, p.district, p.oblast].filter(Boolean).join(' · '))}</span></button>`).join('');
    $('searchResults').querySelectorAll('.place-result').forEach((btn) => btn.addEventListener('click', async () => {
      const p = items[Number(btn.dataset.index)];
      state.home = p; state.settings.home = p; saveSettings(); closeSettings();
      state.map.flyTo([p.lat, p.lon], p.type === 'адреса' ? 9 : 8, { duration: .7 }); await refreshThreats(); await syncPushSettings(); showToast(`Збережено: ${formatHomeName(p)}`);
    }));
  } catch (error) { $('searchStatus').textContent = error.message; }
}
function useGps({ setAsHome = false } = {}) {
  if (!navigator.geolocation) { showToast('Геолокація не підтримується.'); return; }
  setConnection('визначаю GPS…');
  navigator.geolocation.getCurrentPosition(async (pos) => {
    state.gps = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    state.gpsMarker?.remove();
    state.gpsMarker = L.circleMarker([state.gps.lat, state.gps.lon], { radius: 7, weight: 3, color: '#fff', fillColor: '#2f80ed', fillOpacity: 1 }).addTo(state.map).bindPopup('Ваша GPS-геолокація');
    state.map.flyTo([state.gps.lat, state.gps.lon], 9, { duration: .7 });
    if (setAsHome) {
      try {
        const items = await searchPlaces(`${state.gps.lat},${state.gps.lon}`);
        const p = items[0] || { name: 'GPS-точка', locality: '', type: '', lat: state.gps.lat, lon: state.gps.lon, oblast: '', district: '', hromada: '', source: 'local-gps' };
        state.home = p; state.settings.home = p; saveSettings(); closeSettings(); await refreshThreats(); await syncPushSettings();
      } catch { showToast('GPS визначено, але населений пункт не вдалося визначити.'); }
    }
    setConnection(feedStateText());
  }, () => { setConnection(feedStateText()); showToast('Дозвіл на GPS не надано.'); }, { timeout: 10000, maximumAge: 120000 });
}
function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64); return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}
function pushPlace() {
  if (!state.home) return null;
  const place = { name: state.home.name || '', locality: state.home.locality || '', type: state.home.type || '', oblast: state.home.oblast || '', district: state.home.district || '', hromada: state.home.hromada || '' };
  if (state.home.source === 'OpenStreetMap/Nominatim' && Number.isFinite(state.home.lat) && Number.isFinite(state.home.lon)) { place.lat = state.home.lat; place.lon = state.home.lon; }
  return place;
}
async function currentPushSubscription() {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.ready; return registration.pushManager?.getSubscription() || null;
}
async function syncPushSettings({ quiet = true } = {}) {
  if (!state.settings.notifications || !state.home || !apiReady()) return;
  try {
    const subscription = await currentPushSubscription(); if (!subscription) return;
    await savePushSubscription(subscription.toJSON(), pushPlace(), state.settings.radiusKm, state.settings.monitoring);
    if (!quiet) showToast('Push-зону оновлено.');
  } catch (error) { console.warn(error); if (!quiet) showToast('Не вдалося оновити push-зону.'); }
}
async function setNotifications(enabled) {
  if (!enabled) {
    try { const subscription = await currentPushSubscription(); if (subscription) { await deletePushSubscription(subscription.endpoint).catch(() => null); await subscription.unsubscribe(); } } catch (error) { console.warn(error); }
    state.settings.notifications = false; saveSettings(); $('notificationsToggle').checked = false; showToast('Push-сповіщення вимкнено.'); return;
  }
  if (!config.enableBackgroundPush || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    $('notificationsToggle').checked = false; showToast('Push не підтримуються цим браузером або вимкнені.'); return;
  }
  if (!state.home) { $('notificationsToggle').checked = false; showToast('Спочатку оберіть населений пункт.'); return; }
  try {
    const permission = await Notification.requestPermission(); if (permission !== 'granted') throw new Error('Дозвіл на сповіщення не надано');
    const pc = await getPushConfig(); if (!pc?.enabled || !pc?.publicKey) throw new Error('Push ще не налаштований на Worker');
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(pc.publicKey) });
    await savePushSubscription(subscription.toJSON(), pushPlace(), state.settings.radiusKm, true);
    state.settings.notifications = true; saveSettings(); $('notificationsToggle').checked = true; showToast('Push для вашої зони увімкнено.');
  } catch (error) { console.error(error); state.settings.notifications = false; saveSettings(); $('notificationsToggle').checked = false; showToast(error.message || 'Не вдалося увімкнути push.'); }
}
function closeRealtime() {
  clearTimeout(state.wsReconnectTimer); state.wsReconnectTimer = null;
  if (state.ws) { state.ws.onclose = null; try { state.ws.close(); } catch {} }
  state.ws = null; state.wsConnected = false;
}
function scheduleRealtimeReconnect() {
  clearTimeout(state.wsReconnectTimer);
  if (!state.settings.monitoring || !config.enableRealtime || !apiReady() || !navigator.onLine) return;
  state.wsReconnectTimer = setTimeout(connectRealtime, 4000);
}
function connectRealtime() {
  closeRealtime();
  if (!state.settings.monitoring || !config.enableRealtime || !apiReady() || !('WebSocket' in window)) return;
  const url = streamUrl(); if (!url) return;
  try {
    const ws = new WebSocket(url); state.ws = ws;
    ws.addEventListener('open', () => { state.wsConnected = true; setConnection('джерела · realtime'); renderFeedHealth(); });
    ws.addEventListener('message', async (event) => {
      let payload; try { payload = JSON.parse(event.data); } catch { return; }
      if (payload?.type === 'hello' && payload.status) { state.monitoringStatus = payload.status; renderAll(); return; }
      if (payload?.type !== 'event' || !payload.event) return;
      const incoming = normalizeThreat(payload.event);
      const previous = state.threats.find((item) => item.id === incoming.id);
      state.threats = [incoming, ...state.threats.filter((item) => item.id !== incoming.id)];
      if (!previous) await maybeNotifyNew([incoming]);
      renderAll(); $('lastUpdated').textContent = `realtime ${new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`;
    });
    ws.addEventListener('close', () => { if (state.ws !== ws) return; state.ws = null; state.wsConnected = false; renderFeedHealth(); scheduleRealtimeReconnect(); });
    ws.addEventListener('error', () => { try { ws.close(); } catch {} });
  } catch { scheduleRealtimeReconnect(); }
}
function setupUI() {
  document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
    state.filter = button.dataset.type; document.querySelectorAll('.filter').forEach((b) => b.classList.toggle('active', b === button)); renderCounts(); renderMarkers(); renderEvents();
  }));
  document.querySelectorAll('.source-filter').forEach((button) => button.addEventListener('click', () => {
    state.sourceFilter = button.dataset.source; document.querySelectorAll('.source-filter').forEach((b) => b.classList.toggle('active', b === button)); renderAll();
  }));
  ['homeAreaBtn', 'settingsBtn', 'changeLocalityBtn'].forEach((id) => $(id).addEventListener('click', openSettings));
  $('closeSettingsBtn').addEventListener('click', closeSettings); $('sheetBackdrop').addEventListener('click', closeSettings);
  $('searchLocalityBtn').addEventListener('click', performPlaceSearch);
  $('localitySearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') performPlaceSearch(); });
  let pushSyncTimer; $('radiusRange').addEventListener('input', (e) => { state.settings.radiusKm = Number(e.target.value); $('radiusValue').textContent = state.settings.radiusKm; saveSettings(); renderAll(); clearTimeout(pushSyncTimer); pushSyncTimer = setTimeout(() => syncPushSettings(), 700); });
  $('onlyMineToggle').addEventListener('change', (e) => { state.settings.onlyMine = e.target.checked; saveSettings(); renderAll(); });
  $('monitoringToggle').addEventListener('change', (e) => { state.settings.monitoring = e.target.checked; saveSettings(); renderAll(); syncPushSettings(); if (state.settings.monitoring) connectRealtime(); else closeRealtime(); });
  $('notificationsToggle').addEventListener('change', (e) => setNotifications(e.target.checked));
  $('useGpsAsHomeBtn').addEventListener('click', () => useGps({ setAsHome: true })); $('locateBtn').addEventListener('click', () => useGps());
  $('refreshBtn').addEventListener('click', () => refreshThreats());
  $('hideVisibleBtn').addEventListener('click', () => hideEvents(visibleThreats().map((item) => item.id)));
  $('restoreHiddenBtn').addEventListener('click', restoreHiddenEvents);
  $('panelToggle').addEventListener('click', () => { const panel = $('eventPanel'); const collapsed = panel.classList.toggle('collapsed'); $('panelToggle').setAttribute('aria-expanded', String(!collapsed)); $('panelToggle').querySelector('.chevron').textContent = collapsed ? '⌃' : '⌄'; });
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); state.installPrompt = event; });
  $('installBtn').addEventListener('click', async () => { if (!state.installPrompt) { showToast('На iPhone: Поділитися → На початковий екран.'); return; } state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; });
  window.addEventListener('online', () => { refreshThreats({ silent: true }); connectRealtime(); });
  window.addEventListener('offline', () => { closeRealtime(); setConnection('офлайн'); });
}
async function registerServiceWorker() { if ('serviceWorker' in navigator) try { await navigator.serviceWorker.register('./sw.js', { scope: './' }); } catch (e) { console.warn(e); } }
function startAutoRefresh() { clearInterval(state.refreshTimer); state.refreshTimer = setInterval(() => refreshThreats({ silent: true }), Math.max(10000, Number(config.refreshMs || 15000))); }

state.home = state.settings.home;
initMap(); setupUI(); loadUkraineMap(); registerServiceWorker().then(() => { if (state.settings.notifications) syncPushSettings(); });
renderAll(); refreshThreats(); startAutoRefresh(); connectRealtime();
if (!state.home) setTimeout(openSettings, 450);
