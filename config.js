window.RADAR_CONFIG = {
  version: '2.1.0',
  mode: 'public-telegram+neptun',
  // Cloudflare Worker production endpoint.
  apiBaseUrl: 'https://radarua-api.ai-beta69690.workers.dev',
  refreshMs: 15000,
  defaultRadiusKm: 25,
  maxRadiusKm: 100,
  defaultOnlyMyArea: true,
  enableBrowserNotifications: true,
  enableBackgroundPush: true,
  enableRealtime: true
};
