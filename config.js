window.RADAR_CONFIG = {
  version: '1.0.0',
  mode: 'api',
  // Вставте URL Cloudflare Worker після deploy, без / в кінці.
  // Приклад: 'https://radarua-api.YOUR-SUBDOMAIN.workers.dev'
  apiBaseUrl: '',
  refreshMs: 15000,
  defaultRadiusKm: 25,
  maxRadiusKm: 100,
  defaultOnlyMyArea: true,
  enableBrowserNotifications: true,
  enableBackgroundPush: true,
  enableRealtime: true
};
