// Einstellungen + Tastenbelegung (localStorage)
const KEY = 'deaddesert.settings.v1';

export const DEFAULT_BINDINGS = {
  forward: 'KeyW',
  back: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  sprint: 'ShiftLeft',
  jump: 'Space',
  crouch: 'ControlLeft',
  interact: 'KeyE',
  use: 'KeyF',
  drop: 'KeyQ',
  throw: 'KeyG',
  engine: 'KeyR',
  horn: 'KeyH',
  lights: 'KeyL',
  camera: 'KeyC',
  inventory: 'Tab',
  chat: 'KeyT',
};

export const BINDING_LABELS = {
  forward: 'Vorwärts / Gas',
  back: 'Rückwärts / Bremse',
  left: 'Links / Lenken',
  right: 'Rechts / Lenken',
  sprint: 'Sprinten',
  jump: 'Springen / Handbremse',
  crouch: 'Ducken',
  interact: 'Benutzen (E)',
  use: 'Gegenstand nutzen (F)',
  drop: 'Fallen lassen',
  throw: 'Werfen',
  engine: 'Motor / Nachladen',
  horn: 'Hupe',
  lights: 'Licht / Taschenlampe',
  camera: 'Kamera (Auto)',
  inventory: 'Inventar',
  chat: 'Chat',
};

const DEFAULTS = {
  quality: 'medium', // low | medium | high
  viewDistance: 5, // Chunk-Radius (x128 m)
  sensitivity: 1.0,
  fov: 75,
  volume: 0.7,
  bindings: { ...DEFAULT_BINDINGS },
  playerName: 'Wanderer',
  mpUrl: '',
};

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
    return { ...DEFAULTS, ...raw, bindings: { ...DEFAULT_BINDINGS, ...(raw.bindings || {}) } };
  } catch {
    return { ...DEFAULTS, bindings: { ...DEFAULT_BINDINGS } };
  }
}

export const settings = load();

export function saveSettings() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export function qualityProfile() {
  switch (settings.quality) {
    case 'low':
      return { shadows: false, shadowSize: 512, post: false, pixelRatio: 0.75, msaa: 0, particles: 0.4, lod: 1 };
    case 'high':
      return { shadows: true, shadowSize: 2048, post: true, pixelRatio: Math.min(window.devicePixelRatio || 1, 2), msaa: 4, particles: 1, lod: 0 };
    default:
      return { shadows: true, shadowSize: 1024, post: true, pixelRatio: Math.min(window.devicePixelRatio || 1, 1.25), msaa: 2, particles: 0.7, lod: 0 };
  }
}
