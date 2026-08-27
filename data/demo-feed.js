const now = Date.now();

export const demoThreats = [
  {
    id: 'demo-drone-1',
    type: 'drone',
    title: 'БПЛА',
    detail: 'Демонстраційна ціль, напрямок на північний захід',
    lat: 49.80,
    lon: 30.10,
    course: 315,
    confidence: 'demo',
    source: 'Demo feed',
    timestamp: new Date(now - 2 * 60 * 1000).toISOString()
  },
  {
    id: 'demo-drone-2',
    type: 'drone',
    title: 'Група БПЛА',
    detail: 'Демонстраційна група цілей',
    lat: 50.15,
    lon: 31.05,
    course: 290,
    confidence: 'demo',
    source: 'Demo feed',
    timestamp: new Date(now - 4 * 60 * 1000).toISOString()
  },
  {
    id: 'demo-missile-1',
    type: 'missile',
    title: 'Ракетна загроза',
    detail: 'Демонстраційна точка — не реальна бойова інформація',
    lat: 48.65,
    lon: 32.65,
    course: 305,
    confidence: 'demo',
    source: 'Demo feed',
    timestamp: new Date(now - 7 * 60 * 1000).toISOString()
  },
  {
    id: 'demo-aviation-1',
    type: 'aviation',
    title: 'Активність авіації',
    detail: 'Демонстраційна подія',
    lat: 49.55,
    lon: 34.55,
    confidence: 'demo',
    source: 'Demo feed',
    timestamp: new Date(now - 10 * 60 * 1000).toISOString()
  },
  {
    id: 'demo-alert-1',
    type: 'alert',
    title: 'Повітряна тривога',
    detail: 'Демонстраційний статус регіону',
    lat: 50.45,
    lon: 30.52,
    confidence: 'demo',
    source: 'Demo feed',
    timestamp: new Date(now - 12 * 60 * 1000).toISOString()
  }
];
