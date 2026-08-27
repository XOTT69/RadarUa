import { apiReady, loadThreats, searchPlaces, streamUrl, normalizeThreat, getPushConfig, savePushSubscription, deletePushSubscription } from './data/feed.js';

const config = window.RADAR_CONFIG || {};
const STORAGE_KEY = 'radarua.settings.v1';
const state = {
  map: null,
  threats: [],
  markers: new Map(),
  filter: 'all',
  home: null,
  gps: null,
  homeMarker: null,
  homeRadius: null,
  gpsMarker: null,
  installPrompt: null,
  refreshTimer: null,
  ws: null,
  wsReconnectTimer: null,
  wsConnected: false,
  localityStatus: null,
  settings: loadSettings(),
  knownIds: new Set()
};

const typeMeta = {
  drone: { label: 'БПЛА', symbol: '◆' },
  missile: { label: 'Ракета', symbol: '➤' },
  aviation: { label: 'Авіація', symbol: '✦' },
  alert: { label: 'Тривога', symbol: '!' }
};
const $ = (id) => document.getElementById(id);

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      radiusKm: Number(saved.radiusKm || config.defaultRadiusKm || 25),
      onlyMine: saved.onlyMine ?? Boolean(config.defaultOnlyMyArea),
      notifications: saved.notifications ?? false,
      monitoring: saved.monitoring ?? true,
      home: saved.home || null
    };
  } catch {
    return { radiusKm: 25, onlyMine: true, notifications: false, monitoring: true, home: null };
  }
}
function saveSettings() {
  state.settings.home = state.home;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
}
function normalizeText(v) {
  return String(v || '').toLocaleLowerCase('uk-UA').replace(/[’']/g, "'").replace(/\s+/g, ' ').trim();
}
function initMap() {
  state.map = L.map('map', { zoomControl: false, attributionControl: true, minZoom: 5, maxZoom: 16 }).setView([49.0, 31.3], 6);
  L.control.zoom({ position: 'bottomright' }).addTo(state.map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(state.map);
}
function escapeHtml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}
function formatAge(timestamp) {
  const sec = Math.max(0, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (sec < 60) return `${sec} с тому`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} хв тому`;
  return `${Math.floor(min / 60)} год тому`;
}
function haversineKm(lat1, lon1, lat2, lon2) {
  const r = 6371, toRad = (x) => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}
function markerIcon(threat) {
  const meta = typeMeta[threat.type] || typeMeta.alert;
  const rotation = threat.course == null ? '' : `transform:rotate(${threat.course}deg)`;
  return L.divIcon({ className: 'threat-marker-wrap', html: `<div class="threat-marker threat-${threat.type}"><span style="${rotation}">${meta.symbol}</span></div>`, iconSize: [42, 42], iconAnchor: [21, 21] });
}
function isThreatRelevant(threat) {
  if (!state.home) return true;
  if (threat.meta?.appliesToLocality === true) return true;
  if (threat.meta?.approximatePoint && threat.meta?.appliesToLocality !== true) return false;
  if (threat.lat != null && threat.lon != null) {
    return haversineKm(state.home.lat, state.home.lon, threat.lat, threat.lon) <= state.settings.radiusKm;
  }
  const hay = normalizeText([threat.title, threat.detail, threat.meta?.region, threat.meta?.raion, threat.meta?.hromada].filter(Boolean).join(' '));
  return [state.home.name, state.home.oblast, state.home.district, state.home.hromada].filter(Boolean).some((x) => hay.includes(normalizeText(x)));
}
function visibleThreats() {
  return state.threats.filter((t) => (!t.meta?.monitoring || state.settings.monitoring) && (state.filter === 'all' || t.type === state.filter) && (!state.settings.onlyMine || isThreatRelevant(t)));
}
function renderHome() {
  state.home = state.settings.home || state.home;
  const home = state.home;
  $('localityName').textContent = home ? `${home.type ? home.type + ' ' : ''}${home.name}` : 'Не вибрано';
  if (!home) {
    $('localityStatus').textContent = 'Натисніть, щоб обрати';
    $('localityStatusDot').className = 'locality-status-dot';
    state.homeMarker?.remove(); state.homeRadius?.remove();
    return;
  }
  const status = state.localityStatus;
  if (status?.active) {
    $('localityStatus').textContent = status.label || 'Активна повітряна тривога';
    $('localityStatusDot').className = 'locality-status-dot danger';
  } else if (status) {
    $('localityStatus').textContent = 'Зараз активної тривоги для цієї зони не знайдено';
    $('localityStatusDot').className = 'locality-status-dot safe';
  } else {
    $('localityStatus').textContent = [home.hromada, home.district, home.oblast].filter(Boolean).join(' · ') || 'Збережено';
    $('localityStatusDot').className = 'locality-status-dot';
  }
  if (Number.isFinite(home.lat) && Number.isFinite(home.lon)) {
    state.homeMarker?.remove(); state.homeRadius?.remove();
    state.homeMarker = L.marker([home.lat, home.lon], { icon: L.divIcon({ className: 'home-marker-wrap', html: '<div class="home-marker">⌂</div>', iconSize: [38, 38], iconAnchor: [19, 19] }) }).addTo(state.map).bindPopup(`Ваш населений пункт: ${escapeHtml(home.name)}`);
    state.homeRadius = L.circle([home.lat, home.lon], { radius: state.settings.radiusKm * 1000, weight: 1, opacity: .8, fillOpacity: .05, className: 'home-radius' }).addTo(state.map);
  }
}
function renderMarkers() {
  for (const marker of state.markers.values()) marker.remove();
  state.markers.clear();
  for (const threat of visibleThreats()) {
    if (threat.lat == null || threat.lon == null) continue;
    const marker = L.marker([threat.lat, threat.lon], { icon: markerIcon(threat) }).addTo(state.map);
    marker.bindPopup(`<div class="popup"><strong>${escapeHtml(threat.title)}</strong><p>${escapeHtml(threat.detail)}</p><small>${escapeHtml(threat.source)} · ${formatAge(threat.timestamp)}</small></div>`);
    state.markers.set(threat.id, marker);
  }
}
function renderCounts() {
  const enabled = state.threats.filter((t) => !t.meta?.monitoring || state.settings.monitoring);
  const pool = state.settings.onlyMine ? enabled.filter(isThreatRelevant) : enabled;
  const counts = { drone: 0, missile: 0, aviation: 0, alert: 0 };
  for (const t of pool) counts[t.type] = (counts[t.type] || 0) + 1;
  $('countAll').textContent = pool.length;
  $('countDrone').textContent = counts.drone;
  $('countMissile').textContent = counts.missile;
  $('countAviation').textContent = counts.aviation;
  $('countAlert').textContent = counts.alert;
  $('eventCount').textContent = visibleThreats().length;
  $('eventPanelTitle').textContent = state.settings.onlyMine && state.home ? `Події · ${state.home.name}` : 'Останні події';
}
function renderEvents() {
  const items = [...visibleThreats()].sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  const list = $('eventList');
  if (!items.length) {
    list.innerHTML = `<div class="empty">${state.home && state.settings.onlyMine ? 'Для вибраної зони активних подій не знайдено.' : 'Подій у цьому фільтрі немає.'}</div>`;
    return;
  }
  list.innerHTML = items.map((t) => {
    const meta = typeMeta[t.type] || typeMeta.alert;
    const distance = state.home && t.lat != null ? haversineKm(state.home.lat, state.home.lon, t.lat, t.lon) : null;
    const relevant = isThreatRelevant(t) ? '<span class="relevant-pill">ваша зона</span>' : '';
    return `<button class="event-item" data-id="${escapeHtml(t.id)}" type="button"><span class="event-icon threat-${t.type}">${meta.symbol}</span><span class="event-main"><strong>${escapeHtml(t.title)} ${relevant}</strong><span>${escapeHtml(t.detail)}</span><small>${formatAge(t.timestamp)} · ${escapeHtml(t.source)}${distance == null ? '' : ` · ~${distance.toFixed(0)} км`}</small></span></button>`;
  }).join('');
  list.querySelectorAll('.event-item').forEach((btn) => btn.addEventListener('click', () => {
    const t = state.threats.find((x) => x.id === btn.dataset.id);
    if (!t || t.lat == null) return;
    state.map.flyTo([t.lat, t.lon], Math.max(state.map.getZoom(), 9), { duration: .6 });
    state.markers.get(t.id)?.openPopup();
  }));
}
function renderProximity() {
  const card = $('proximityCard');
  if (!state.home) { card.classList.add('hidden'); return; }
  if (state.localityStatus?.active) {
    $('proximityTitle').textContent = 'Тривога у вашій адміністративній зоні';
    $('proximityText').textContent = state.localityStatus.detail || state.localityStatus.label || 'Активна тривога';
    card.classList.add('danger'); card.classList.remove('hidden'); return;
  }
  const points = state.threats.filter((t) => t.lat != null && t.lon != null && !t.meta?.approximatePoint).map((t) => ({ ...t, distance: haversineKm(state.home.lat, state.home.lon, t.lat, t.lon) })).sort((a, b) => a.distance - b.distance);
  if (!points.length) { card.classList.add('hidden'); return; }
  const nearest = points[0];
  $('proximityTitle').textContent = nearest.distance <= state.settings.radiusKm ? 'Подія у вашому радіусі' : 'Найближча відображена подія';
  $('proximityText').textContent = `${nearest.title}: приблизно ${nearest.distance.toFixed(0)} км від обраної точки.`;
  card.classList.toggle('danger', nearest.distance <= state.settings.radiusKm);
  card.classList.remove('hidden');
}
function renderAll() { renderHome(); renderCounts(); renderMarkers(); renderEvents(); renderProximity(); }
function setConnection(text) { $('connectionLabel').textContent = text; }
function showToast(message) {
  const toast = $('toast'); toast.textContent = message; toast.classList.add('show');
  clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('show'), 3500);
}
async function maybeNotifyNew(items) {
  const relevant = items.filter((t) => isThreatRelevant(t));
  const fresh = relevant.filter((t) => !state.knownIds.has(t.id));
  items.forEach((t) => state.knownIds.add(t.id));
  if (config.enableBackgroundPush || !state.settings.notifications || !('Notification' in window) || Notification.permission !== 'granted' || !fresh.length) return;
  const newest = fresh.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
  if (Date.now() - new Date(newest.timestamp).getTime() > 3 * 60 * 1000) return;
  const reg = await navigator.serviceWorker?.ready;
  reg?.showNotification(`RadarUa · ${newest.title}`, { body: newest.detail || 'Нова подія у вашій зоні', icon: './assets/icons/icon-192.png', tag: `radar-${newest.id}` });
}
async function refreshThreats({ silent = false } = {}) {
  if (!apiReady()) {
    setConnection('потрібен URL API');
    $('modeBadge').textContent = 'SETUP';
    state.threats = []; state.localityStatus = null; renderAll();
    return;
  }
  if (!silent) setConnection('оновлення…');
  try {
    const result = await loadThreats(state.home, state.settings.radiusKm);
    await maybeNotifyNew(result.items);
    state.threats = result.items;
    state.localityStatus = result.localityStatus;
    renderAll();
    $('lastUpdated').textContent = `оновлено ${new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`;
    setConnection(state.wsConnected ? 'онлайн · realtime' : 'онлайн · офіційні дані'); $('modeBadge').textContent = state.wsConnected ? 'RT' : 'LIVE';
  } catch (error) {
    console.error(error); setConnection('помилка API'); showToast(error.message || 'Не вдалося оновити дані');
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
    $('searchStatus').textContent = items.length ? 'Оберіть правильний населений пункт:' : 'Нічого не знайдено.';
    $('searchResults').innerHTML = items.map((p, i) => `<button class="place-result" type="button" data-index="${i}"><strong>${escapeHtml(p.type ? `${p.type} ${p.name}` : p.name)}</strong><span>${escapeHtml([p.hromada, p.district, p.oblast].filter(Boolean).join(' · '))}</span></button>`).join('');
    $('searchResults').querySelectorAll('.place-result').forEach((btn) => btn.addEventListener('click', () => {
      const p = items[Number(btn.dataset.index)];
      state.home = p; state.settings.home = p; saveSettings(); renderHome(); closeSettings();
      state.map.flyTo([p.lat, p.lon], 10, { duration: .7 }); refreshThreats(); syncPushSettings(); showToast(`Збережено: ${p.name}`);
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
    state.map.flyTo([state.gps.lat, state.gps.lon], 10, { duration: .7 });
    if (setAsHome) {
      try {
        const items = await searchPlaces(`${state.gps.lat},${state.gps.lon}`);
        const p = items[0] || { name: 'GPS-точка', type: '', lat: state.gps.lat, lon: state.gps.lon, oblast: '', district: '', hromada: '', source: 'local-gps' };
        state.home = p; state.settings.home = state.home; saveSettings(); closeSettings(); await refreshThreats(); await syncPushSettings();
      } catch {
        showToast('GPS визначено, але населений пункт не вдалося визначити. Спробуйте пошук за назвою.');
      }
    }
    setConnection('онлайн');
  }, () => { setConnection('онлайн'); showToast('Дозвіл на GPS не надано.'); }, { timeout: 10000, maximumAge: 120000 });
}
function urlBase64ToUint8Array(value) {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)));
}
function pushPlace() {
  if (!state.home) return null;
  const place = {
    name: state.home.name || '',
    type: state.home.type || '',
    oblast: state.home.oblast || '',
    district: state.home.district || '',
    hromada: state.home.hromada || ''
  };
  // Координати передаємо лише для центру населеного пункту з геокодера, не для точної GPS-точки.
  if (state.home.source === 'OpenStreetMap/Nominatim' && Number.isFinite(state.home.lat) && Number.isFinite(state.home.lon)) {
    place.lat = state.home.lat;
    place.lon = state.home.lon;
  }
  return place;
}
async function currentPushSubscription() {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager?.getSubscription() || null;
}
async function syncPushSettings({ quiet = true } = {}) {
  if (!state.settings.notifications || !state.home || !apiReady()) return;
  try {
    const subscription = await currentPushSubscription();
    if (!subscription) return;
    await savePushSubscription(subscription.toJSON(), pushPlace(), state.settings.radiusKm, state.settings.monitoring);
    if (!quiet) showToast('Push-зону оновлено.');
  } catch (error) {
    console.warn('Push sync failed', error);
    if (!quiet) showToast('Не вдалося оновити push-зону.');
  }
}
async function setNotifications(enabled) {
  if (!enabled) {
    try {
      const subscription = await currentPushSubscription();
      if (subscription) {
        await deletePushSubscription(subscription.endpoint).catch(() => null);
        await subscription.unsubscribe();
      }
    } catch (error) { console.warn(error); }
    state.settings.notifications = false;
    saveSettings();
    $('notificationsToggle').checked = false;
    showToast('Фонові push-сповіщення вимкнено.');
    return;
  }
  if (!config.enableBackgroundPush || !('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    $('notificationsToggle').checked = false;
    showToast('Фонові push не підтримуються цим браузером або вимкнені в config.js.');
    return;
  }
  if (!state.home) {
    $('notificationsToggle').checked = false;
    showToast('Спочатку оберіть населений пункт.');
    return;
  }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Дозвіл на сповіщення не надано');
    const pushConfig = await getPushConfig();
    if (!pushConfig?.enabled || !pushConfig?.publicKey) throw new Error('Push ще не налаштований на сервері');
    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pushConfig.publicKey)
      });
    }
    await savePushSubscription(subscription.toJSON(), pushPlace(), state.settings.radiusKm, state.settings.monitoring);
    state.settings.notifications = true;
    saveSettings();
    $('notificationsToggle').checked = true;
    showToast('Фонові push-сповіщення увімкнено.');
  } catch (error) {
    console.error(error);
    state.settings.notifications = false;
    saveSettings();
    $('notificationsToggle').checked = false;
    showToast(error.message || 'Не вдалося увімкнути push.');
  }
}

function closeRealtime() {
  clearTimeout(state.wsReconnectTimer);
  state.wsReconnectTimer = null;
  if (state.ws) {
    state.ws.onclose = null;
    try { state.ws.close(); } catch {}
  }
  state.ws = null;
  state.wsConnected = false;
}
function scheduleRealtimeReconnect() {
  clearTimeout(state.wsReconnectTimer);
  if (!state.settings.monitoring || !config.enableRealtime || !apiReady() || !navigator.onLine) return;
  state.wsReconnectTimer = setTimeout(connectRealtime, 4000);
}
function connectRealtime() {
  closeRealtime();
  if (!state.settings.monitoring || !config.enableRealtime || !apiReady() || !('WebSocket' in window)) return;
  const url = streamUrl();
  if (!url) return;
  try {
    const ws = new WebSocket(url);
    state.ws = ws;
    ws.addEventListener('open', () => {
      state.wsConnected = true;
      setConnection('онлайн · realtime');
      $('modeBadge').textContent = 'RT';
    });
    ws.addEventListener('message', async (event) => {
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (payload?.type !== 'event' || !payload.event) return;
      const incoming = normalizeThreat(payload.event);
      const previous = state.threats.find((item) => item.id === incoming.id);
      state.threats = [incoming, ...state.threats.filter((item) => item.id !== incoming.id)];
      if (!previous) await maybeNotifyNew([incoming]);
      renderAll();
      $('lastUpdated').textContent = `realtime ${new Date().toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}`;
    });
    ws.addEventListener('close', () => {
      if (state.ws !== ws) return;
      state.ws = null;
      state.wsConnected = false;
      setConnection('онлайн · очікую realtime');
      $('modeBadge').textContent = 'LIVE';
      scheduleRealtimeReconnect();
    });
    ws.addEventListener('error', () => { try { ws.close(); } catch {} });
  } catch {
    scheduleRealtimeReconnect();
  }
}
function setupUI() {
  document.querySelectorAll('.filter').forEach((button) => button.addEventListener('click', () => {
    state.filter = button.dataset.type; document.querySelectorAll('.filter').forEach((b) => b.classList.toggle('active', b === button)); renderCounts(); renderMarkers(); renderEvents();
  }));
  ['homeAreaBtn', 'settingsBtn', 'changeLocalityBtn'].forEach((id) => $(id).addEventListener('click', openSettings));
  $('closeSettingsBtn').addEventListener('click', closeSettings); $('sheetBackdrop').addEventListener('click', closeSettings);
  $('searchLocalityBtn').addEventListener('click', performPlaceSearch);
  let debounce; $('localitySearch').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(() => { if ($('localitySearch').value.trim().length >= 3) performPlaceSearch(); }, 700); });
  $('localitySearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') performPlaceSearch(); });
  let pushSyncTimer; $('radiusRange').addEventListener('input', (e) => { state.settings.radiusKm = Number(e.target.value); $('radiusValue').textContent = state.settings.radiusKm; saveSettings(); renderAll(); clearTimeout(pushSyncTimer); pushSyncTimer = setTimeout(() => syncPushSettings(), 700); });
  $('onlyMineToggle').addEventListener('change', (e) => { state.settings.onlyMine = e.target.checked; saveSettings(); renderAll(); });
  $('monitoringToggle').addEventListener('change', (e) => { state.settings.monitoring = e.target.checked; saveSettings(); renderAll(); syncPushSettings(); if (state.settings.monitoring) connectRealtime(); else closeRealtime(); });
  $('notificationsToggle').addEventListener('change', (e) => setNotifications(e.target.checked));
  $('useGpsAsHomeBtn').addEventListener('click', () => useGps({ setAsHome: true })); $('locateBtn').addEventListener('click', () => useGps());
  $('refreshBtn').addEventListener('click', () => refreshThreats());
  $('panelToggle').addEventListener('click', () => { const panel = $('eventPanel'); const collapsed = panel.classList.toggle('collapsed'); $('panelToggle').setAttribute('aria-expanded', String(!collapsed)); $('panelToggle').querySelector('.chevron').textContent = collapsed ? '⌃' : '⌄'; });
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); state.installPrompt = event; });
  $('installBtn').addEventListener('click', async () => { if (!state.installPrompt) { showToast('На iPhone: Поділитися → На початковий екран.'); return; } state.installPrompt.prompt(); await state.installPrompt.userChoice; state.installPrompt = null; });
  window.addEventListener('online', () => { refreshThreats({ silent: true }); connectRealtime(); }); window.addEventListener('offline', () => { closeRealtime(); setConnection('офлайн'); });
}
async function registerServiceWorker() { if ('serviceWorker' in navigator) try { await navigator.serviceWorker.register('./sw.js', { scope: './' }); } catch (e) { console.warn(e); } }
function startAutoRefresh() { clearInterval(state.refreshTimer); state.refreshTimer = setInterval(() => refreshThreats({ silent: true }), Math.max(10000, Number(config.refreshMs || 20000))); }

state.home = state.settings.home;
initMap(); setupUI(); registerServiceWorker().then(() => { if (state.settings.notifications) syncPushSettings(); }); renderHome(); refreshThreats(); startAutoRefresh(); connectRealtime();
if (!state.home) setTimeout(openSettings, 450);
