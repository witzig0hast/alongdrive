// Prozedurale Chunk-Inhalte (rein datenbasiert): POIs, Felsen, Pflanzen, Loot, Collider, Zombie-Spawns.
// Wird vom Client (Meshes) und vom Server (Collider/Zombies) benutzt.
import { mulberry32, hash3, pickWeighted, pick, smooth, clamp, TAU } from '../core/rng.js';
import { CHUNK } from './heightfield.js';
import { ITEM_DEFS, defaultState } from '../items/defs.js';

export const chunkKey = (cx, cz) => cx + ',' + cz;
export const chunkOf = (v) => Math.floor(v / CHUNK);

const COL = {
  wall: 0xb8a27e, wallDark: 0x9c8767, concrete: 0xa09b90, rust: 0x8a4b2a, wood: 0x6e4f33, metal: 0x707880,
  roof: 0x5d554b, red: 0x9c3b2e, mil: 0x5b6240, dark: 0x2d2d30, white: 0xd8d4c8, sandbag: 0xb3a07a,
  yellow: 0xd2a82b, blue: 0x3d5f7a, glass: 0x5f7f8c,
};

const LOOT = {
  house: [['canned_food', 5], ['water', 4], ['chocolate', 2], ['medkit', 1], ['flashlight', 1], ['lighter', 1], ['wood', 1.2], ['ammo9', 0.9], ['wrench', 1], ['crowbar', 0.5], ['pistol', 0.25], ['spark_plugs', 0.6]],
  shop: [['canned_food', 5], ['water', 6], ['chocolate', 4], ['medkit', 1.5], ['repair_kit', 1], ['flashlight', 1], ['lighter', 1], ['toolbox', 0.5], ['wood', 0.5]],
  parts: [['wheel', 3], ['battery', 2], ['spark_plugs', 3], ['radiator', 1.4], ['fuel_tank', 1.1], ['engine', 0.5], ['jerrycan', 2.5], ['toolbox', 1], ['repair_kit', 1.5], ['door', 0.8], ['hood', 0.5], ['wrench', 1]],
  mil: [['pistol', 2], ['shotgun', 1.4], ['ammo9', 4], ['shells', 3], ['medkit', 3], ['canned_food', 2], ['water', 2], ['flashlight', 1], ['crowbar', 1]],
  mast: [['battery', 3], ['toolbox', 2], ['flashlight', 2], ['wrench', 2], ['repair_kit', 1], ['spark_plugs', 1]],
  outdoor: [['water', 3], ['jerrycan', 2], ['canned_food', 2], ['wood', 3], ['chocolate', 1]],
};

class Placer {
  constructor(res, x, y, z, ry) {
    this.res = res;
    this.x = x;
    this.y = y;
    this.z = z;
    this.ry = ry;
    this.c = Math.cos(ry);
    this.s = Math.sin(ry);
  }
  w(lx, lz) {
    return [this.x + lx * this.c + lz * this.s, this.z - lx * this.s + lz * this.c];
  }
  sub(lx, lz, dry = 0) {
    const [wx, wz] = this.w(lx, lz);
    return new Placer(this.res, wx, this.y, wz, this.ry + dry);
  }
  /** Box (Mitte lx/lz, Unterkante y0 relativ zur POI-Basis) */
  box(lx, y0, lz, sx, sy, sz, color, o = {}) {
    const [wx, wz] = this.w(lx, lz);
    const ry = this.ry + (o.ry || 0);
    const y = this.y + y0;
    this.res.prims.push({ s: 'box', p: [wx, y + sy / 2, wz], z: [sx, sy, sz], r: [0, ry, 0], c: color });
    if (o.col !== false) this.res.colliders.push({ t: 'obb', x: wx, z: wz, hx: sx / 2, hz: sz / 2, ry, y0: y, y1: y + sy });
  }
  cyl(lx, y0, lz, r, h, color, o = {}) {
    const [wx, wz] = this.w(lx, lz);
    const y = this.y + y0;
    this.res.prims.push({ s: o.six ? 'cyl6' : 'cyl', p: [wx, y + h / 2, wz], z: [r, h, r], r: o.rot || [0, 0, 0], c: color });
    if (o.col !== false) this.res.colliders.push({ t: 'cyl', x: wx, z: wz, r, y0: y, y1: y + h });
  }
  cone(lx, y0, lz, r, h, color) {
    const [wx, wz] = this.w(lx, lz);
    this.res.prims.push({ s: 'cone', p: [wx, this.y + y0 + h / 2, wz], z: [r, h, r], c: color });
  }
  loot(lx, y0, lz, table, p = 0.7) {
    this.res.lootPoints.push({ x: this.w(lx, lz)[0], z: this.w(lx, lz)[1], y: this.y + y0, table, p });
  }
  forced(lx, y0, lz, type, state) {
    const [wx, wz] = this.w(lx, lz);
    this.res.forced.push({ type, x: wx, z: wz, y: this.y + y0, state });
  }
  zombie(lx, lz, kind = 'ruin') {
    const [wx, wz] = this.w(lx, lz);
    this.res.zspawns.push({ x: wx, z: wz, kind });
  }
  light(lx, y0, lz, color, intensity, dist) {
    const [wx, wz] = this.w(lx, lz);
    this.res.lights.push({ x: wx, y: this.y + y0, z: wz, color, intensity, dist });
  }
  /** Wand entlang lokaler X-Achse mit Öffnungen [{c, w, y0, y1}] */
  wallX(cx, z, len, h, thick, color, openings = []) {
    this._wall(cx, z, len, h, thick, color, openings, false);
  }
  wallZ(x, cz, len, h, thick, color, openings = []) {
    this._wall(x, cz, len, h, thick, color, openings, true);
  }
  _wall(a, b, len, h, thick, color, openings, alongZ) {
    // a,b = Mitte der Wand; len = Länge
    const ops = openings.slice().sort((p, q) => p.c - q.c);
    let cursor = -len / 2;
    const put = (c0, c1, y0, y1) => {
      if (c1 - c0 < 0.05 || y1 - y0 < 0.05) return;
      const mid = (c0 + c1) / 2;
      const l = c1 - c0;
      if (alongZ) this.box(a, y0, b + mid, thick, y1 - y0, l, color);
      else this.box(a + mid, y0, b, l, y1 - y0, thick, color);
    };
    for (const o of ops) {
      const o0 = o.c - o.w / 2;
      const o1 = o.c + o.w / 2;
      put(cursor, o0, 0, h);
      put(o0, o1, 0, o.y0 ?? 0);
      put(o0, o1, o.y1 ?? 2.2, h);
      cursor = o1;
    }
    put(cursor, len / 2, 0, h);
  }
}

// ---------------------------------------------------------------- POI-Builder

function plinth(P, w, d, color = COL.concrete) {
  P.box(0, -2.5, 0, w, 2.62, d, color); // Oberkante +0.12
}

function house(P, rng, ruin = true, w = 7 + rng() * 3, d = 6 + rng() * 3) {
  const h = 3 + rng() * 0.5;
  plinth(P, w + 0.4, d + 0.4);
  const door = { c: (rng() - 0.5) * (w - 3), w: 1.3, y0: 0.12, y1: 2.2 };
  const win = (c) => ({ c, w: 1.1, y0: 1.0, y1: 2.0 });
  const col = pick(rng, [COL.wall, COL.wallDark, 0xa89270]);
  P.wallX(0, d / 2, w, h, 0.3, col, [door, win(-w / 2 + 1.5), win(w / 2 - 1.5)].filter((o, i) => i === 0 || Math.abs(o.c - door.c) > 1.6));
  P.wallX(0, -d / 2, w, h, 0.3, col, [win(0)]);
  P.wallZ(-w / 2, 0, d, h, 0.3, col, [win(rng() * 2 - 1)]);
  P.wallZ(w / 2, 0, d, h, 0.3, col, rng() < 0.4 ? [{ c: 0, w: 1.2, y0: 0.12, y1: 2.2 }] : []);
  if (ruin) {
    // zerbrochene Wandstücke abtragen: Ruine optisch durch fehlendes Dach + Schutt
    for (let i = 0; i < 5; i++) {
      const [rx, rz] = [(rng() - 0.5) * (w - 1), (rng() - 0.5) * (d - 1)];
      P.res.prims.push({ s: 'box', p: [P.w(rx, rz)[0], P.y + 0.3, P.w(rx, rz)[1]], z: [0.5 + rng() * 0.8, 0.3 + rng() * 0.4, 0.5 + rng() * 0.6], r: [rng(), rng() * TAU, rng()], c: col });
    }
  }
  // Dach (teilweise)
  const parts = ruin ? 2 : 1;
  if (!ruin) P.box(0, h, 0, w + 0.6, 0.25, d + 0.6, COL.roof);
  else {
    P.box(-w / 4 - 0.1, h, 0, w / 2 + 0.3, 0.2, d + 0.5, COL.roof, { ry: 0 });
    if (rng() < 0.5) P.box(w / 4 + 0.4, h - 0.2, -d / 4, w / 3, 0.2, d / 2, COL.roof, { ry: 0.05 });
  }
  // Möbel
  P.box(-w / 2 + 1.2, 0.12, -d / 2 + 1, 2, 0.5, 1, COL.wood); // Bett
  P.box(w / 2 - 1.5, 0.12, d / 2 - 1.5, 1.1, 0.8, 0.8, COL.wood); // Tisch/Schrank
  P.loot(w / 2 - 1.5, 0.92, d / 2 - 1.5, 'house', 0.9);
  P.loot(-w / 2 + 1.2, 0.64, -d / 2 + 1, 'house', 0.7);
  P.loot(0, 0.12, 0, 'house', 0.5);
  P.zombie(0, 0, 'ruin');
  if (rng() < 0.5) P.zombie(1, -1, 'ruin');
  return { w, d };
}

function gasStation(P, rng, pumpFuel) {
  plinth(P, 26, 20, COL.concrete);
  // Überdachung
  for (const [x, z] of [[-6, 4], [6, 4], [-6, 10], [6, 10]]) P.box(x, 0.12, z, 0.5, 4.6, 0.5, COL.white);
  P.box(0, 4.7, 7, 15, 0.5, 9, COL.red, { col: false });
  P.box(0, 4.55, 7, 14, 0.15, 8, COL.white, { col: false });
  P.light(0, 4.0, 7, 0xfff0c8, 1.0, 22);
  // Pumpen
  for (let i = 0; i < 2; i++) {
    const lx = -3 + i * 6;
    P.box(lx, 0.12, 7, 0.9, 1.5, 0.6, i ? COL.yellow : COL.red);
    P.box(lx, 1.2, 7, 0.7, 0.35, 0.62, 0x222a30, { col: false });
    P.res.pumps.push({ id: 'pump' + i, x: P.w(lx, 7)[0], z: P.w(lx, 7)[1], y: P.y + 0.12, ry: P.ry, fuel: pumpFuel(i) });
  }
  // Shop
  const sw = 10;
  const sd = 6;
  P.sub(0, -6, 0);
  const S = P.sub(0, -6);
  S.wallX(0, sd / 2, sw, 3.4, 0.3, COL.wall, [{ c: -1.5, w: 3.4, y0: 0.12, y1: 2.8 }]);
  S.wallX(0, -sd / 2, sw, 3.4, 0.3, COL.wall, []);
  S.wallZ(-sw / 2, 0, sd, 3.4, 0.3, COL.wall, [{ c: 0, w: 1.2, y0: 1.1, y1: 2.0 }]);
  S.wallZ(sw / 2, 0, sd, 3.4, 0.3, COL.wall, []);
  S.box(0, 3.4, 0, sw + 0.6, 0.25, sd + 0.6, COL.roof);
  S.box(2, 0.12, -1.5, 4, 0.9, 0.7, COL.wood); // Theke/Regal
  S.box(-3.5, 0.12, -2.4, 1, 2, 0.5, COL.metal);
  S.box(3.8, 0.12, 1.5, 1, 2, 0.5, COL.metal);
  S.loot(2, 1.04, -1.5, 'shop', 0.9);
  S.loot(3, 1.04, -1.5, 'shop', 0.8);
  S.loot(-3.5, 0.12, -2.0, 'shop', 0.9);
  S.loot(-3.5, 1.0, -2.0, 'shop', 0.8);
  S.loot(3.8, 0.12, 1.2, 'shop', 0.8);
  S.loot(3.8, 1.0, 1.2, 'shop', 0.6);
  S.zombie(0, 0, 'ruin');
  if (rng() < 0.6) S.zombie(2, -1, 'ruin');
  // Werkstattbereich / Schild
  P.box(10, 0.12, 4, 0.4, 6.5, 0.4, COL.metal);
  P.box(10, 6.2, 4, 0.5, 1.8, 3, COL.yellow, { col: false });
  P.cyl(-10, 0.12, 6, 0.35, 0.9, COL.rust);
  P.cyl(-10.9, 0.12, 6.4, 0.35, 0.9, COL.red);
  P.loot(-10, 1.1, 6, 'outdoor', 0.7);
  P.loot(8, 0.12, 9, 'parts', 0.5);
  // Autowrack
  wreck(P.sub(-8, -4, 0.4), rng, false);
}

function wreck(P, rng, loot = true, kind = null) {
  const col = pick(rng, [COL.rust, 0x4a5a63, 0x7a6a3a, 0x3c3c3f, 0x6a3030]);
  const truck = kind === 'truck' || (kind === null && rng() < 0.25);
  const L = truck ? 6.2 : 4.4;
  // Karosserie als OBB-Collider
  P.box(0, 0.35, 0, 1.9, 0.7, L, col);
  P.box(0, 1.05, truck ? -L * 0.25 : -0.3, 1.7, 0.7, truck ? 1.8 : 2.0, col, { col: true });
  P.box(0, 1.1, truck ? -L * 0.25 : -0.3, 1.74, 0.45, truck ? 1.82 : 2.02, COL.glass, { col: false });
  if (truck) P.box(0, 0.7, L * 0.2, 2.1, 1.3, L * 0.55, COL.rust, { col: false });
  // Räder (kaputt/fehlend)
  for (const [x, z] of [[-1, 1.3], [1, 1.3], [-1, -1.3], [1, -1.3]]) {
    if (rng() < 0.5) P.res.prims.push({ s: 'cyl', p: [P.w(x, z)[0], P.y + 0.3, P.w(x, z)[1]], z: [0.33, 0.25, 0.33], r: [0, 0, Math.PI / 2], c: 0x1b1b1d });
  }
  if (loot) {
    P.loot(0, 1.5, 0.5, 'parts', 0.8);
    P.loot(1.8, 0.0, 1, 'parts', 0.5);
  }
  if (rng() < 0.3) P.zombie(2, 2, 'wreck');
}

function waterTower(P, rng) {
  plinth(P, 9, 9);
  for (const [x, z] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
    P.cyl(x, 0.12, z, 0.28, 9, COL.rust, { six: true });
  }
  for (let i = 0; i < 3; i++) {
    const y = 2 + i * 2.6;
    P.box(0, y, -3, 6, 0.15, 0.15, COL.metal, { col: false });
    P.box(0, y, 3, 6, 0.15, 0.15, COL.metal, { col: false });
    P.box(-3, y, 0, 0.15, 0.15, 6, COL.metal, { col: false });
    P.box(3, y, 0, 0.15, 0.15, 6, COL.metal, { col: false });
  }
  P.cyl(0, 9.1, 0, 3.2, 4.2, 0x7d5a3c, { col: false });
  P.cone(0, 13.3, 0, 3.6, 1.8, COL.roof);
  P.loot(2.5, 0.12, 2.5, 'outdoor', 0.9);
  P.loot(-2.5, 0.12, 2.5, 'outdoor', 0.7);
  if (rng() < 0.5) P.zombie(4, 4, 'wreck');
}

function radioMast(P, rng) {
  plinth(P, 14, 14);
  const H = 42;
  const seg = 7;
  for (let i = 0; i < seg; i++) {
    const w = 3.2 - i * 0.38;
    const y = 0.12 + (H / seg) * i;
    const hh = H / seg;
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) P.box((x * w) / 2, y, (z * w) / 2, 0.16, hh, 0.16, COL.metal, { col: i < 1 });
    P.box(0, y + hh * 0.5, w / 2, w, 0.1, 0.1, COL.metal, { col: false, ry: 0 });
    P.box(0, y + hh * 0.5, -w / 2, w, 0.1, 0.1, COL.metal, { col: false });
    P.box(w / 2, y + hh * 0.5, 0, 0.1, 0.1, w, COL.metal, { col: false });
    P.box(-w / 2, y + hh * 0.5, 0, 0.1, 0.1, w, COL.metal, { col: false });
  }
  P.box(0, H + 0.1, 0, 0.4, 0.4, 0.4, 0xff2a2a, { col: false });
  P.light(0, H, 0, 0xff2a2a, 0, 0);
  // Betriebshütte
  const S = P.sub(0, 8);
  S.wallX(0, 1.8, 4.5, 2.8, 0.25, COL.concrete, [{ c: 0, w: 1.2, y0: 0.12, y1: 2.1 }]);
  S.wallX(0, -1.8, 4.5, 2.8, 0.25, COL.concrete);
  S.wallZ(-2.2, 0, 3.6, 2.8, 0.25, COL.concrete);
  S.wallZ(2.2, 0, 3.6, 2.8, 0.25, COL.concrete);
  S.box(0, 2.8, 0, 5, 0.2, 4.2, COL.roof);
  S.box(1.4, 0.12, -1.2, 1.2, 1.0, 0.7, COL.metal);
  S.loot(1.4, 1.14, -1.2, 'mast', 0.95);
  S.loot(-1.4, 0.12, -1.2, 'mast', 0.8);
  S.loot(0, 0.12, 0, 'mast', 0.5);
  if (rng() < 0.5) S.zombie(0, 0, 'ruin');
}

function militaryPost(P, rng) {
  plinth(P, 40, 34, COL.concrete);
  // Zaun
  for (let i = -9; i <= 9; i++) {
    for (const z of [-16, 16]) P.box(i * 2, 0.12, z, 0.12, 2.0, 0.12, COL.metal, { col: false });
    if (Math.abs(i) < 9 || true) for (const x of [-19, 19]) if (i * 2 >= -16 && i * 2 <= 16) P.box(x, 0.12, i * 1.8, 0.12, 2.0, 0.12, COL.metal, { col: false });
  }
  P.box(0, 1.0, -16, 38, 0.8, 0.05, 0x6a6e70, { col: true });
  P.box(-9.5, 1.0, 16, 19, 0.8, 0.05, 0x6a6e70, { col: true }); // Tor offen auf Mitte
  P.box(14.5, 1.0, 16, 9, 0.8, 0.05, 0x6a6e70, { col: true });
  P.box(-19, 1.0, 0, 0.05, 0.8, 32, 0x6a6e70, { col: true });
  P.box(19, 1.0, 0, 0.05, 0.8, 32, 0x6a6e70, { col: true });
  // Baracke
  const B = P.sub(-8, -6);
  B.wallX(0, 4, 14, 3.2, 0.3, COL.mil, [{ c: -3, w: 1.3, y0: 0.12, y1: 2.2 }, { c: 3, w: 1.1, y0: 1.0, y1: 2.0 }]);
  B.wallX(0, -4, 14, 3.2, 0.3, COL.mil, [{ c: 0, w: 1.1, y0: 1.0, y1: 2.0 }]);
  B.wallZ(-7, 0, 8, 3.2, 0.3, COL.mil, []);
  B.wallZ(7, 0, 8, 3.2, 0.3, COL.mil, [{ c: 1, w: 1.1, y0: 1.0, y1: 2.0 }]);
  B.box(0, 3.2, 0, 14.8, 0.25, 8.8, COL.dark);
  for (let i = 0; i < 4; i++) B.box(-5 + i * 3.3, 0.12, -2.8, 0.9, 0.5, 2, 0x44463a); // Betten
  B.box(5, 0.12, 2.5, 2.4, 1, 0.9, COL.wood);
  B.loot(5, 1.14, 2.5, 'mil', 0.95);
  B.loot(-5, 0.64, -2.8, 'mil', 0.7);
  B.loot(2, 0.64, -2.8, 'mil', 0.7);
  B.zombie(0, 0, 'mil');
  B.zombie(3, 1, 'mil');
  // Wachturm
  const T = P.sub(11, -8);
  for (const [x, z] of [[-1.2, -1.2], [1.2, -1.2], [-1.2, 1.2], [1.2, 1.2]]) T.box(x, 0.12, z, 0.25, 6, 0.25, COL.wood);
  T.box(0, 6.1, 0, 3.4, 0.2, 3.4, COL.wood);
  T.box(0, 6.3, 1.5, 3.4, 0.9, 0.1, COL.wood, { col: false });
  T.box(0, 6.3, -1.5, 3.4, 0.9, 0.1, COL.wood, { col: false });
  T.box(-1.5, 6.3, 0, 0.1, 0.9, 3, COL.wood, { col: false });
  T.box(1.5, 6.3, 0, 0.1, 0.9, 3, COL.wood, { col: false });
  T.box(0, 8.0, 0, 3.8, 0.2, 3.8, COL.roof, { col: false });
  for (let i = 0; i < 6; i++) T.box(-1.3, 0.12 + i * 1.0, 1.4, 0.1, 0.1, 0.8, COL.wood, { col: false, ry: 0 });
  T.loot(0, 6.3, 0, 'mil', 0.8);
  // Sandsäcke & Kisten
  for (let i = 0; i < 5; i++) P.box(-4 + i * 1.2, 0.12, 12, 1.1, 0.5, 0.6, COL.sandbag);
  for (let i = 0; i < 4; i++) P.box(-4 + i * 1.2 + 0.5, 0.62, 12, 1.1, 0.5, 0.6, COL.sandbag);
  P.box(10, 0.12, 8, 1.4, 1.0, 1.0, COL.mil);
  P.box(10, 0.12, 9.6, 1.4, 1.0, 1.0, 0x6a7044);
  P.loot(10, 1.14, 8, 'mil', 0.95);
  P.loot(10, 1.14, 9.6, 'mil', 0.8);
  P.loot(8.5, 0.12, 8.8, 'mil', 0.6);
  wreck(P.sub(8, 11, 0.3), rng, true, 'truck');
  P.zombie(-2, 8, 'mil');
  P.zombie(-12, 8, 'mil');
  P.zombie(2, -10, 'mil');
}

function settlement(P, rng) {
  const n = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rng() * 0.4;
    const r = 20 + rng() * 8;
    const H = P.sub(Math.cos(a) * r, Math.sin(a) * r, -a + Math.PI / 2 + (rng() - 0.5) * 0.3);
    house(H, rng, rng() < 0.7);
  }
  // Brunnen
  P.cyl(0, -0.3, 0, 1.2, 1.1, COL.concrete);
  P.cyl(0, 0.8, 0, 0.9, 0.05, 0x1b2a30, { col: false });
  P.box(-1.3, 0.8, 0, 0.15, 2.2, 0.15, COL.wood, { col: false });
  P.box(1.3, 0.8, 0, 0.15, 2.2, 0.15, COL.wood, { col: false });
  P.box(0, 2.9, 0, 3, 0.15, 1.6, COL.roof, { col: false });
  P.loot(3, 0.0, 3, 'outdoor', 0.9);
  P.loot(-3, 0.0, 2, 'house', 0.8);
  for (let i = 0; i < 3; i++) P.zombie((rng() - 0.5) * 14, (rng() - 0.5) * 14, 'ruin');
  wreck(P.sub(8, -8, rng() * TAU), rng);
}

// ---------------------------------------------------------------- Startbereich

function garage(P) {
  const W = 14;
  const D = 12;
  const H = 4.2;
  P.box(0, -0.6, 0, W + 1.5, 0.65, D + 1.5, COL.concrete); // Bodenplatte, Oberkante 0.05
  const col = 0x8f8776;
  P.wallX(0, -D / 2, W, H, 0.35, col, [{ c: 3, w: 1.4, y0: 1.2, y1: 2.4 }]);
  P.wallX(-5.5, D / 2, 3, H, 0.35, col);
  P.wallX(5.5, D / 2, 3, H, 0.35, col);
  P.box(0, 3.5, D / 2, 8, 0.7, 0.35, col); // Sturz über dem Tor
  P.wallZ(-W / 2, 0, D, H, 0.35, col, [{ c: 1, w: 1.8, y0: 1.2, y1: 2.5 }]);
  P.wallZ(W / 2, 0, D, H, 0.35, col, [{ c: -2, w: 1.8, y0: 1.2, y1: 2.5 }, { c: 3, w: 1.0, y0: 0.05, y1: 2.1 }]);
  P.box(0, H, 0, W + 1.0, 0.3, D + 1.0, COL.roof);
  // Dachbinder
  for (let i = -2; i <= 2; i++) P.box(i * 3, H - 0.35, 0, 0.2, 0.35, D, COL.metal, { col: false });
  // Lampen
  for (const [x, z] of [[-3.5, -2], [3.5, -2], [0, 3]]) {
    P.box(x, H - 0.55, z, 2.0, 0.08, 0.3, 0xfff1c0, { col: false });
    P.light(x, H - 0.8, z, 0xffe6b0, 0.9, 14);
  }
  // Werkbank
  P.box(-4.6, 0.05, -4.9, 3.6, 0.9, 1.0, COL.wood);
  P.box(-4.6, 0.95, -4.9, 3.8, 0.08, 1.15, 0x4d3924);
  P.box(-4.6, 1.8, -5.7, 3.6, 0.05, 0.4, COL.wood, { col: false }); // Wandbrett
  P.box(-6.5, 0.05, -2.6, 0.9, 1.0, 1.4, COL.metal); // Werkzeugwagen
  // Regale rechts
  for (const z of [-3.2, 1.2]) {
    for (const y of [0.9, 1.5, 2.1]) P.box(6.45, y, z, 0.8, 0.05, 3.2, COL.wood);
    for (const dz of [-1.55, 1.55]) P.box(6.45, 0.05, z + dz, 0.08, 2.2, 0.08, COL.metal, { col: false });
    P.box(6.82, 0.05, z, 0.04, 2.2, 3.2, 0x5a4a35, { col: false });
  }
  // Fässer / Reifenstapel
  P.cyl(-6.2, 0.05, 4.6, 0.32, 0.9, COL.rust);
  P.cyl(-5.4, 0.05, 5.0, 0.32, 0.9, COL.blue);
  for (let i = 0; i < 3; i++) P.cyl(6.0, 0.05 + i * 0.28, 4.6, 0.38, 0.26, 0x1d1d1f, { col: i === 2 });
  // Schild über dem Tor
  P.box(0, 4.35, D / 2 + 0.2, 6, 0.9, 0.12, 0x7a2b22, { col: false });

  // Fester Start-Loot
  P.forced(-5.6, 1.1, -4.9, 'spark_plugs');
  P.forced(-4.4, 1.1, -4.9, 'crowbar');
  P.forced(-3.6, 1.1, -4.9, 'toolbox');
  P.forced(-3.2, 1.1, -4.9, 'lighter');
  P.forced(6.45, 0.95, -3.7, 'canned_food');
  P.forced(6.45, 0.95, -2.6, 'water');
  P.forced(6.45, 1.55, -3.2, 'chocolate');
  P.forced(6.45, 1.55, 1.2, 'flashlight');
  P.forced(6.45, 0.95, 1.8, 'water');
  P.forced(6.45, 0.95, 0.6, 'canned_food');
  P.forced(6.45, 2.15, 1.2, 'radiator');
  P.forced(6.45, 2.15, -3.2, 'wood');
  P.forced(-6.0, 0.05, 1.0, 'engine');
  P.forced(-6.1, 0.05, -0.6, 'battery', { charge: 0.7, cond: 1 });
  P.forced(-5.8, 0.05, 2.9, 'wheel', { cond: 0.9 });
  P.forced(-4.9, 0.05, 3.0, 'wheel', { cond: 0.8 });
  P.forced(-5.0, 0.05, -2.2, 'jerrycan', { fuel: 6 });
  P.forced(-4.2, 0.05, -2.2, 'jerrycan', { fuel: 0 });
  P.forced(5.0, 0.05, 4.3, 'medkit');
}

function shed(P) {
  plinth(P, 7, 6);
  P.wallX(0, -2.7, 6.4, 2.8, 0.2, COL.wood);
  P.wallZ(-3.2, 0, 5.4, 2.8, 0.2, COL.wood);
  P.wallZ(3.2, 0, 5.4, 2.8, 0.2, COL.wood, [{ c: -1, w: 1.0, y0: 1.0, y1: 1.9 }]);
  P.wallX(-2.2, 2.7, 2, 2.8, 0.2, COL.wood);
  P.wallX(2.2, 2.7, 2, 2.8, 0.2, COL.wood);
  P.box(0, 2.8, 0, 7.2, 0.2, 6.2, COL.roof);
  P.box(0, 0.12, -1.9, 3, 0.5, 0.8, COL.wood, { col: true });
  P.forced(-2, 0.12, 0, 'wheel', { cond: 0.85 });
  P.forced(-1.2, 0.12, -0.5, 'wheel', { cond: 0.75 });
  P.forced(1.4, 0.64, -1.9, 'fuel_tank', { cond: 1 });
  P.forced(2.4, 0.12, 0.3, 'door', { cond: 1 });
  P.forced(2.4, 0.12, 1.3, 'door', { cond: 1 });
  P.forced(0, 0.76, -1.9, 'hood', { cond: 1 });
  P.forced(-2.4, 0.12, -1.8, 'canned_food');
  P.forced(-2.6, 0.12, -1.0, 'water');
}

// ---------------------------------------------------------------- Chunk

const GARAGE_SPAWN = { x: 0, z: 0 };
export const SPAWN_POINT = { x: 0, z: 9.5 }; // vor der Garage
export const CAR_START = { x: 0, z: -0.6, ry: 0 };

export function genChunk(terrain, seed, cx, cz) {
  const x0 = cx * CHUNK;
  const z0 = cz * CHUNK;
  const res = {
    key: chunkKey(cx, cz), cx, cz, x0, z0,
    prims: [], colliders: [], rocks: [], plants: [], lootPoints: [], forced: [], loot: [],
    zspawns: [], pumps: [], lights: [], pois: [],
  };
  const rng = mulberry32(hash3(seed, cx, cz, 77));
  const flatTop = (x, z, r) => {
    let mn = 1e9;
    let mx = -1e9;
    let sum = 0;
    const pts = [[0, 0]];
    for (let i = 0; i < 8; i++) pts.push([Math.cos((i / 8) * TAU) * r, Math.sin((i / 8) * TAU) * r]);
    for (const [dx, dz] of pts) {
      const h = terrain.heightAt(x + dx, z + dz);
      mn = Math.min(mn, h);
      mx = Math.max(mx, h);
      sum += h;
    }
    return { mn, mx, avg: sum / pts.length };
  };
  const inChunk = (x, z) => x >= x0 && x < x0 + CHUNK && z >= z0 && z < z0 + CHUNK;

  const place = (type, x, z, ry, fn, r) => {
    const t = flatTop(x, z, r * 0.7);
    const P = new Placer(res, x, t.mx, z, ry);
    fn(P);
    res.pois.push({ type, x, z, y: t.mx, r });
  };

  // --- Startbereich (feste Strukturen)
  if (inChunk(GARAGE_SPAWN.x, GARAGE_SPAWN.z)) {
    const P = new Placer(res, 0, 0, 0, 0);
    garage(P);
    res.pois.push({ type: 'garage', x: 0, z: 0, y: 0, r: 12 });
  }
  if (inChunk(-62, 40)) {
    const t = terrain.heightAt(-62, 40);
    const P = new Placer(res, -62, t, 40, Math.PI / 2);
    shed(P);
    res.pois.push({ type: 'shed', x: -62, z: 40, y: t, r: 7 });
  }
  if (inChunk(95, -66)) {
    const t = terrain.heightAt(95, -66);
    const P = new Placer(res, 95, t, -66, -Math.PI / 2);
    gasStation(P, rng, () => 60);
    res.pois.push({ type: 'gas_station', x: 95, z: -66, y: t, r: 16 });
  }

  // --- zufällige POIs
  const cxm = x0 + CHUNK / 2;
  const czm = z0 + CHUNK / 2;
  const dOrigin = Math.hypot(cxm, czm);
  const poiTypes = [
    ['house', 4], ['wreck', 5], ['gas', 1.4], ['tower', 1.2], ['mast', 1], ['settle', 1.1], ['mil', 0.7],
  ];
  if (dOrigin > 190 && rng() < 0.26) {
    const type = pickWeighted(rng, poiTypes);
    const radius = { house: 9, wreck: 6, gas: 16, tower: 6, mast: 8, settle: 36, mil: 24 }[type];
    for (let tries = 0; tries < 8; tries++) {
      const m = Math.min(radius + 6, CHUNK / 2 - 4);
      const x = x0 + m + rng() * (CHUNK - 2 * m);
      const z = z0 + m + rng() * (CHUNK - 2 * m);
      const f = flatTop(x, z, radius * 0.7);
      const s = terrain.sample(x, z, {});
      const tol = type === 'wreck' ? 4 : type === 'settle' || type === 'mil' ? 2.4 : 1.8;
      if (f.mx - f.mn > tol || s.canyon > 0.1) continue;
      const ry = Math.floor(rng() * 4) * (Math.PI / 2) + (type === 'wreck' ? rng() * 0.8 : 0);
      const pr = rng;
      if (type === 'house') place('house', x, z, ry, (P) => house(P, pr), radius);
      else if (type === 'wreck') {
        place('wreck', x, z, ry, (P) => {
          wreck(P, pr);
          if (pr() < 0.5) wreck(P.sub(5.5 + pr() * 2, 3 + pr() * 3, pr() * 2), pr);
        }, radius);
      } else if (type === 'gas') {
        place('gas_station', x, z, ry, (P) => gasStation(P, pr, () => (pr() < 0.3 ? 0 : Math.round(15 + pr() * 70))), radius);
      } else if (type === 'tower') place('water_tower', x, z, ry, (P) => waterTower(P, pr), radius);
      else if (type === 'mast') place('radio_mast', x, z, ry, (P) => radioMast(P, pr), radius);
      else if (type === 'settle') place('settlement', x, z, ry, (P) => settlement(P, pr), radius);
      else if (type === 'mil') place('military', x, z, ry, (P) => militaryPost(P, pr), radius);
      break;
    }
  }

  // --- Felsen & Pflanzen
  const midS = terrain.sample(cxm, czm, {});
  const rockCount = Math.floor((midS.plat > 0.4 ? 26 : 9) * (1 - midS.salt) * smooth(60, 220, dOrigin) * (0.6 + rng() * 0.8));
  const inPoi = (x, z) => res.pois.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < (p.r + 3) ** 2);
  for (let i = 0; i < rockCount; i++) {
    const x = x0 + rng() * CHUNK;
    const z = z0 + rng() * CHUNK;
    if (inPoi(x, z)) continue;
    const s = terrain.sample(x, z, {});
    if (s.salt > 0.4) continue;
    const big = rng() < 0.22;
    const sc = big ? 2.2 + rng() * 3.5 : 0.5 + rng() * 1.3;
    const y = s.h - sc * 0.25;
    res.rocks.push({ x, y, z, sx: sc * (0.8 + rng() * 0.6), sy: sc * (0.6 + rng() * 0.7), sz: sc * (0.8 + rng() * 0.6), ry: rng() * TAU, v: Math.floor(rng() * 3), shade: 0.75 + rng() * 0.4, plat: s.plat });
    if (sc > 1.1) res.colliders.push({ t: 'cyl', x, z, r: sc * 0.8, y0: y - 1, y1: y + sc * 1.05 });
  }
  const plantCount = Math.floor((midS.plat > 0.4 ? 3 : 14) * (1 - midS.salt) * smooth(30, 160, dOrigin) * (0.4 + rng()));
  for (let i = 0; i < plantCount; i++) {
    const x = x0 + rng() * CHUNK;
    const z = z0 + rng() * CHUNK;
    if (inPoi(x, z)) continue;
    const s = terrain.sample(x, z, {});
    if (s.salt > 0.2 || s.canyon > 0.3) continue;
    const r = rng();
    res.plants.push({ x, y: s.h, z, s: 0.7 + rng() * 0.9, ry: rng() * TAU, type: r < 0.45 ? 'bush' : r < 0.75 ? 'cactus' : 'deadtree' });
  }
  // einzelner Outdoor-Loot (Lagerplatz) selten
  if (rng() < 0.08 && dOrigin > 200) {
    const x = x0 + 10 + rng() * (CHUNK - 20);
    const z = z0 + 10 + rng() * (CHUNK - 20);
    if (!inPoi(x, z) && terrain.sample(x, z, {}).salt < 0.5) {
      const y = terrain.heightAt(x, z);
      res.lootPoints.push({ x, z, y, table: 'outdoor', p: 1 });
      res.lootPoints.push({ x: x + 1.2, z: z + 0.5, y, table: 'outdoor', p: 0.8 });
      res.zspawns.push({ x, z, kind: 'camp' });
    }
  }

  // --- Loot materialisieren
  const lrng = mulberry32(hash3(seed, cx, cz, 4242));
  let idx = 0;
  for (const f of res.forced) {
    res.loot.push({ uid: `S:${res.key}:${idx++}`, type: f.type, x: f.x, y: f.y, z: f.z, state: { ...defaultState(f.type, lrng), ...(f.state || {}) } });
  }
  for (const lp of res.lootPoints) {
    const roll = lrng();
    const type = pickWeighted(lrng, LOOT[lp.table]);
    if (roll > lp.p) {
      idx++;
      continue;
    }
    const st = defaultState(type, lrng);
    if (type === 'jerrycan') st.fuel = Math.round(lrng() * 12);
    if (type === 'battery') st.charge = 0.2 + lrng() * 0.7;
    if (type === 'engine') st.cond = 0.45 + lrng() * 0.55;
    if (type === 'wheel') st.cond = 0.3 + lrng() * 0.7;
    if (type === 'spark_plugs') st.cond = 0.4 + lrng() * 0.6;
    if (type === 'radiator') st.cond = 0.5 + lrng() * 0.5;
    if (type === 'pistol') st.mag = Math.floor(lrng() * 8);
    if (type === 'shotgun') st.mag = Math.floor(lrng() * 4);
    res.loot.push({ uid: `L:${res.key}:${idx++}`, type, x: lp.x, y: lp.y, z: lp.z, state: st });
  }
  return res;
}

export function itemHalfHeight(type) {
  return (ITEM_DEFS[type].h || 0.1) / 2;
}
