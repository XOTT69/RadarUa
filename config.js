window.RADAR_CONFIG = {
  version: '3.0.0',
  mode: 'api',
  // URL Cloudflare Worker після deploy, без / в кінці.
  apiBaseUrl: '',
  refreshMs: 15000,
  defaultRadiusKm: 25,
  maxRadiusKm: 100,
  defaultOnlyMyArea: true,
  enableBrowserNotifications: true,
  enableBackgroundPush: true
};
