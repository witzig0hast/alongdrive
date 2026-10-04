// Gegenstandsdefinitionen + prozedurale Modelle (reine Daten, auch serverseitig importierbar)
const B = (x, y, z, sx, sy, sz, c, r) => ({ s: 'box', p: [x, y, z], z: [sx, sy, sz], c, r });
const C = (x, y, z, rad, h, c, r) => ({ s: 'cyl', p: [x, y, z], z: [rad, h, rad], c, r });
const C6 = (x, y, z, rad, h, c, r) => ({ s: 'cyl6', p: [x, y, z], z: [rad, h, rad], c, r });
const HP = Math.PI / 2;

export const ITEM_DEFS = {
  canned_food: {
    name: 'Konserve', cat: 'food', size: 'small', hunger: 30, thirst: -3, h: 0.1, radius: 0.1,
    desc: 'Bohnen in Tomatensauce. Verdirbt nie.',
    prims: [C(0, 0, 0, 0.04, 0.1, 0xb9923a), C(0, 0, 0, 0.0415, 0.05, 0xb8362b), C(0, 0.052, 0, 0.038, 0.006, 0xcfcfcf)],
  },
  chocolate: {
    name: 'Schokoriegel', cat: 'food', size: 'small', hunger: 14, h: 0.03, radius: 0.1,
    desc: 'Alt, aber kalorienreich.',
    prims: [B(0, 0, 0, 0.16, 0.025, 0.06, 0x5a3a22), B(0, 0.002, 0, 0.12, 0.026, 0.05, 0xc8a02a)],
  },
  water: {
    name: 'Wasserflasche', cat: 'drink', size: 'small', thirst: 42, h: 0.22, radius: 0.1,
    desc: 'Klares Wasser. Kostbar.',
    prims: [C6(0, 0, 0, 0.035, 0.22, 0x7cc4e8), C6(0, 0.125, 0, 0.016, 0.03, 0xffffff)],
  },
  medkit: {
    name: 'Medkit', cat: 'heal', size: 'small', heal: 60, h: 0.16, radius: 0.15,
    desc: 'Heilt 60 Gesundheit.',
    prims: [B(0, 0, 0, 0.26, 0.16, 0.08, 0xe9e9e9), B(0, 0, 0.041, 0.1, 0.03, 0.004, 0xc0392b), B(0, 0, 0.041, 0.03, 0.1, 0.004, 0xc0392b)],
  },
  jerrycan: {
    name: 'Kanister', cat: 'fuel', size: 'large', cap: 20, h: 0.45, radius: 0.25,
    desc: 'Fasst 20 L Treibstoff. F an Zapfsäule: füllen, F am Auto: einfüllen.',
    prims: [B(0, 0, 0, 0.34, 0.45, 0.16, 0x6b7a2a), B(0.1, 0.25, 0, 0.1, 0.06, 0.1, 0x4f5b1f), C(0.1, 0.3, 0, 0.025, 0.06, 0x222222), B(-0.04, 0.2, 0, 0.1, 0.03, 0.12, 0x4f5b1f)],
  },
  battery: {
    name: 'Autobatterie', cat: 'part', size: 'large', slot: 'battery', h: 0.2, radius: 0.25,
    desc: 'Teil: Batterie', prims: [B(0, 0, 0, 0.3, 0.2, 0.18, 0x25303a), B(-0.08, 0.11, 0, 0.04, 0.03, 0.04, 0xb0b0b0), B(0.08, 0.11, 0, 0.04, 0.03, 0.04, 0xb0b0b0), B(0, 0.1, 0, 0.26, 0.01, 0.14, 0x3a4a58)],
  },
  engine: {
    name: 'Motorblock', cat: 'part', size: 'large', slot: 'engine', h: 0.5, radius: 0.5,
    desc: 'Teil: Motor', prims: [B(0, 0, 0, 0.7, 0.42, 0.5, 0x59616a), B(0, 0.28, 0, 0.55, 0.14, 0.4, 0x3d444b), C(-0.2, 0.3, 0, 0.06, 0.12, 0x9aa3ab), C(0, 0.3, 0, 0.06, 0.12, 0x9aa3ab), C(0.2, 0.3, 0, 0.06, 0.12, 0x9aa3ab), B(0.38, 0, 0, 0.1, 0.3, 0.3, 0x2c3238), C(0, -0.1, 0.27, 0.12, 0.05, 0x7a6a55, [HP, 0, 0])],
  },
  wheel: {
    name: 'Rad', cat: 'part', size: 'large', slot: 'wheel', h: 0.76, radius: 0.4,
    desc: 'Teil: Rad', prims: [C(0, 0, 0, 0.38, 0.26, 0x1d1d1f, [0, 0, HP]), C(0, 0, 0, 0.22, 0.28, 0x9a9da1, [0, 0, HP]), C(0, 0, 0, 0.06, 0.3, 0x55585c, [0, 0, HP])],
    rest: [0, 0, HP],
  },
  fuel_tank: {
    name: 'Tank', cat: 'part', size: 'large', slot: 'tank', h: 0.28, radius: 0.5,
    desc: 'Teil: Treibstofftank', prims: [B(0, 0, 0, 0.95, 0.28, 0.5, 0x7d8890), B(0.35, 0.16, 0.1, 0.12, 0.08, 0.12, 0x333b40), B(0, -0.1, 0, 0.7, 0.06, 0.4, 0x5d666d)],
  },
  spark_plugs: {
    name: 'Zündkerzen', cat: 'part', size: 'small', slot: 'plugs', h: 0.08, radius: 0.12,
    desc: 'Teil: Zündkerzen (Satz)', prims: [B(0, -0.03, 0, 0.16, 0.03, 0.1, 0xb8b8b8), C(-0.05, 0.02, 0, 0.012, 0.06, 0xf0f0e0), C(-0.017, 0.02, 0, 0.012, 0.06, 0xf0f0e0), C(0.017, 0.02, 0, 0.012, 0.06, 0xf0f0e0), C(0.05, 0.02, 0, 0.012, 0.06, 0xf0f0e0)],
  },
  radiator: {
    name: 'Kühler', cat: 'part', size: 'large', slot: 'radiator', h: 0.6, radius: 0.45,
    desc: 'Teil: Kühler (ohne Kühler überhitzt der Motor schneller)',
    prims: [B(0, 0, 0, 0.75, 0.55, 0.1, 0x3b3f45), B(0, 0, 0.06, 0.7, 0.5, 0.02, 0x8a9096), B(0, 0.3, 0, 0.12, 0.06, 0.12, 0x222222)],
  },
  door: {
    name: 'Autotür', cat: 'part', size: 'large', slot: 'door', h: 0.95, radius: 0.5,
    desc: 'Teil: Tür (optional)', prims: [B(0, 0, 0, 0.07, 0.95, 1.15, 0x8a3b2b), B(0, 0.3, 0, 0.08, 0.35, 0.9, 0x6f8d99)],
  },
  hood: {
    name: 'Motorhaube', cat: 'part', size: 'large', slot: 'hood', h: 0.08, radius: 0.7,
    desc: 'Teil: Motorhaube (optional)', prims: [B(0, 0, 0, 1.6, 0.06, 1.1, 0x8a3b2b)],
  },
  toolbox: {
    name: 'Werkzeugkasten', cat: 'tool', size: 'small', h: 0.18, radius: 0.25, uses: 8,
    desc: 'F am Auto: Motor/Teile reparieren (8 Anwendungen).',
    prims: [B(0, 0, 0, 0.4, 0.18, 0.18, 0xb03a2e), B(0, 0.11, 0, 0.18, 0.03, 0.03, 0x333333), B(0, 0.0, 0.092, 0.12, 0.03, 0.005, 0xcccccc)],
  },
  repair_kit: {
    name: 'Reifenflickzeug', cat: 'tool', size: 'small', h: 0.06, radius: 0.15, uses: 3,
    desc: 'F am Auto: Reifen reparieren (3 Anwendungen).',
    prims: [B(0, 0, 0, 0.2, 0.06, 0.14, 0xd9a21b), C(0.04, 0.04, 0, 0.03, 0.02, 0x222222)],
  },
  wrench: {
    name: 'Schraubenschlüssel', cat: 'melee', size: 'small', dmg: 24, h: 0.04, radius: 0.18, reach: 1.9, speed: 0.55,
    desc: 'Nahkampf (24)', prims: [B(0, 0, 0, 0.04, 0.025, 0.3, 0x9aa0a6), B(0, 0, 0.17, 0.09, 0.025, 0.07, 0x9aa0a6), B(0, 0, -0.17, 0.07, 0.025, 0.05, 0x9aa0a6)],
  },
  crowbar: {
    name: 'Brecheisen', cat: 'melee', size: 'small', dmg: 36, h: 0.04, radius: 0.2, reach: 2.1, speed: 0.65,
    desc: 'Nahkampf (36)', prims: [C(0, 0, 0, 0.015, 0.75, 0x30343a, [HP, 0, 0]), B(0, 0, 0.42, 0.03, 0.03, 0.1, 0x30343a, [0.5, 0, 0]), B(0, 0, -0.38, 0.03, 0.03, 0.08, 0x30343a, [-0.4, 0, 0])],
  },
  pistol: {
    name: 'Pistole', cat: 'gun', size: 'small', dmg: 34, mag: 12, ammo: 'ammo9', reload: 1.3, rpm: 0.28, range: 90, pellets: 1, spread: 0.008, h: 0.12, radius: 0.2,
    desc: 'Pistole (12 Schuss). R: nachladen.', prims: [B(0, 0.02, 0.02, 0.035, 0.05, 0.2, 0x25282b), B(0, -0.05, -0.03, 0.035, 0.1, 0.05, 0x3a3f44, [0.2, 0, 0])],
  },
  shotgun: {
    name: 'Schrotflinte', cat: 'gun', size: 'small', dmg: 13, mag: 6, ammo: 'shells', reload: 2.2, rpm: 0.9, range: 40, pellets: 8, spread: 0.06, h: 0.1, radius: 0.35,
    desc: 'Schrotflinte (6 Schuss). R: nachladen.', prims: [C(0, 0.02, 0.25, 0.018, 0.8, 0x30343a, [HP, 0, 0]), B(0, -0.01, -0.2, 0.05, 0.09, 0.3, 0x6b4426), B(0, -0.04, -0.4, 0.05, 0.12, 0.12, 0x6b4426, [0.4, 0, 0]), C(0, -0.03, 0.2, 0.025, 0.3, 0x6b4426, [HP, 0, 0])],
  },
  ammo9: {
    name: 'Pistolenmunition', cat: 'ammo', size: 'small', stack: 60, h: 0.05, radius: 0.12, desc: '9mm', give: 12,
    prims: [B(0, 0, 0, 0.1, 0.05, 0.07, 0x7a5a1e), B(0, 0.028, 0, 0.08, 0.01, 0.05, 0xd1a640)],
  },
  shells: {
    name: 'Schrotpatronen', cat: 'ammo', size: 'small', stack: 40, h: 0.05, radius: 0.12, desc: '12er Schrot', give: 6,
    prims: [B(0, 0, 0, 0.1, 0.05, 0.07, 0x7a2a1e), B(0, 0.028, 0, 0.08, 0.01, 0.05, 0xd1b640)],
  },
  flashlight: {
    name: 'Taschenlampe', cat: 'light', size: 'small', h: 0.04, radius: 0.15,
    desc: 'F: ein/aus (verbraucht Batterie nicht, aber lockt Zombies an).',
    prims: [C(0, 0, 0, 0.025, 0.17, 0x2c3138, [HP, 0, 0]), C(0, 0, 0.1, 0.04, 0.04, 0xd8b83a, [HP, 0, 0])],
  },
  lighter: {
    name: 'Feuerzeug', cat: 'tool', size: 'small', h: 0.02, radius: 0.1,
    desc: 'Zum Entzünden von Lagerfeuern.', prims: [B(0, 0, 0, 0.03, 0.06, 0.015, 0xb0b4b8), B(0, 0.035, 0, 0.03, 0.012, 0.015, 0x707478)],
  },
  wood: {
    name: 'Brennholz', cat: 'fuel_wood', size: 'small', stack: 12, h: 0.1, radius: 0.25,
    desc: 'F (3 Stück + Feuerzeug): Lagerfeuer errichten.',
    prims: [C(0, 0, 0, 0.035, 0.45, 0x6e4a2b, [HP, 0, 0.1]), C(0.04, 0.06, 0.02, 0.03, 0.4, 0x7b5533, [HP, 0, -0.2]), C(-0.03, 0.05, -0.04, 0.03, 0.42, 0x5f3f24, [HP, 0, 0.3])],
  },
};

export const ITEM_TYPES = Object.keys(ITEM_DEFS);

/** Anfangszustand eines neuen Gegenstands */
export function defaultState(type, rng) {
  const d = ITEM_DEFS[type];
  const st = {};
  if (d.cat === 'part') st.cond = d.slot === 'battery' ? 1 : 1;
  if (type === 'battery') st.charge = 0.6;
  if (type === 'jerrycan') st.fuel = 0;
  if (d.uses) st.uses = d.uses;
  if (d.cat === 'gun') st.mag = 0;
  if (d.stack) st.count = d.give || 1 + Math.floor((rng ? rng() : 0.5) * 3);
  if (type === 'wood') st.count = 2 + Math.floor((rng ? rng() : 0.5) * 4);
  if (type === 'flashlight') st.on = false;
  return st;
}

export function isLarge(type) {
  return ITEM_DEFS[type].size === 'large';
}
