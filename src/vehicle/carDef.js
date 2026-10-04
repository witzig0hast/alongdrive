// Fahrzeugdefinition. Lokale Achsen: +Z vorne, +Y oben, +X links (Fahrerseite).
export const BED = { x0: -0.82, x1: 0.82, z0: -2.62, z1: -0.62, floor: -0.2 };
export const HALF_W = 0.98;
export const HALF_L = 2.78;
export const REST_Y = 0.88; // Abstand Schwerpunkt-Mitte zum Boden im Ruhezustand

export const SEATS = {
  driver: { pos: [0.45, 0.22, 0.3], eye: [0.4, 0.66, 0.38] },
  passenger: { pos: [-0.45, 0.22, 0.3], eye: [-0.45, 0.66, 0.38] },
};

export const SLOTS = {
  engine: { item: 'engine', pos: [0, 0.02, 1.95], time: 4.0, label: 'Motor', ghost: [0.75, 0.5, 0.55] },
  radiator: { item: 'radiator', pos: [0, 0.12, 2.6], time: 2.5, label: 'Kühler', ghost: [0.78, 0.55, 0.15] },
  battery: { item: 'battery', pos: [0.58, 0.2, 2.2], time: 1.6, label: 'Batterie', ghost: [0.32, 0.22, 0.2] },
  plugs: { item: 'spark_plugs', pos: [0, 0.38, 1.95], time: 2.0, label: 'Zündkerzen', needs: 'engine', ghost: [0.3, 0.12, 0.2] },
  tank: { item: 'fuel_tank', pos: [0, -0.42, -1.55], time: 3.0, label: 'Tank', ghost: [0.95, 0.3, 0.5] },
  wheelFL: { item: 'wheel', pos: [0.98, -0.5, 1.75], time: 2.5, label: 'Rad vorne links', ghost: [0.3, 0.76, 0.76] },
  wheelFR: { item: 'wheel', pos: [-0.98, -0.5, 1.75], time: 2.5, label: 'Rad vorne rechts', ghost: [0.3, 0.76, 0.76] },
  wheelRL: { item: 'wheel', pos: [0.98, -0.5, -1.6], time: 2.5, label: 'Rad hinten links', ghost: [0.3, 0.76, 0.76] },
  wheelRR: { item: 'wheel', pos: [-0.98, -0.5, -1.6], time: 2.5, label: 'Rad hinten rechts', ghost: [0.3, 0.76, 0.76] },
  doorL: { item: 'door', pos: [1.0, 0.25, 0.45], time: 2.0, label: 'Tür links', optional: true, ghost: [0.1, 0.95, 1.15] },
  doorR: { item: 'door', pos: [-1.0, 0.25, 0.45], time: 2.0, label: 'Tür rechts', optional: true, ghost: [0.1, 0.95, 1.15] },
  hood: { item: 'hood', pos: [0, 0.3, 2.05], time: 2.0, label: 'Motorhaube', optional: true, ghost: [1.6, 0.1, 1.2] },
};
export const REQUIRED = ['engine', 'battery', 'tank', 'plugs', 'wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'];
export const SLOT_IDS = Object.keys(SLOTS);

export const WHEELS = [
  { id: 'wheelFL', pos: [0.98, -0.1, 1.75], front: true, drive: false },
  { id: 'wheelFR', pos: [-0.98, -0.1, 1.75], front: true, drive: false },
  { id: 'wheelRL', pos: [0.98, -0.1, -1.6], front: false, drive: true },
  { id: 'wheelRR', pos: [-0.98, -0.1, -1.6], front: false, drive: true },
];

export const PHYS = {
  mass: 1350,
  wheelRadius: 0.38,
  suspRest: 0.34,
  springK: 52000,
  damper: 4800,
  gears: [3.5, 2.2, 1.5, 1.1, 0.85],
  reverse: 3.2,
  finalDrive: 3.7,
  idleRpm: 900,
  redline: 6400,
  peakTorque: 300,
  tankCap: 60,
};
