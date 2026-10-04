// Unit-Tests für die reinen (DOM-freien) Module: Terrain, Weltgenerierung, Kollision, Zombie-KI, Wetter
import assert from 'node:assert/strict';
import { Terrain, CHUNK } from '../src/world/heightfield.js';
import { genChunk } from '../src/world/worldgen.js';
import { circleVs, pointInside } from '../src/world/collision.js';
import { ZombieSim, ZS } from '../src/ai/zombieSim.js';
import { stormIntensity, hourOf, ambientTemp, sunElevation } from '../src/world/weather.js';
import { ITEM_DEFS, defaultState } from '../src/items/defs.js';
import { Vitals } from '../src/player/vitals.js';
import { Inventory } from '../src/player/inventory.js';

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed++;
    console.log('  ✓', name);
  } catch (e) {
    console.error('  ✗', name, '\n   ', e.message);
    process.exitCode = 1;
  }
};

console.log('Terrain');
test('deterministisch pro Seed', () => {
  const a = new Terrain('abc');
  const b = new Terrain('abc');
  const c = new Terrain('xyz');
  assert.equal(a.heightAt(1234.5, -987.6), b.heightAt(1234.5, -987.6));
  assert.notEqual(a.heightAt(1234.5, -987.6), c.heightAt(1234.5, -987.6));
});
test('Startbereich ist flach bei 0', () => {
  const t = new Terrain('seed');
  for (const [x, z] of [[0, 0], [20, 30], [-60, 40], [95, -66], [100, 70]]) assert.ok(Math.abs(t.heightAt(x, z)) < 0.01, `h(${x},${z})=${t.heightAt(x, z)}`);
});
test('Höhen sind endlich und begrenzt (viele Stichproben)', () => {
  const t = new Terrain('range');
  let min = 1e9;
  let max = -1e9;
  for (let i = 0; i < 20000; i++) {
    const h = t.heightAt((i * 137.1) % 30000 - 15000, (i * 91.7) % 30000 - 15000);
    assert.ok(Number.isFinite(h));
    min = Math.min(min, h);
    max = Math.max(max, h);
  }
  assert.ok(max > 15 && min < -5, `Spanne ${min.toFixed(1)}..${max.toFixed(1)}`);
});
test('Biome: Sand, Fels und Salz kommen vor', () => {
  const t = new Terrain('biomes');
  const seen = new Set();
  for (let i = 0; i < 6000; i++) seen.add(t.surfaceAt((i * 211.3) % 40000 - 20000, (i * 173.9) % 40000 - 20000));
  assert.ok(seen.has(0) && seen.has(1) && seen.has(2), [...seen].join());
});

console.log('Weltgenerierung');
test('Chunk-Inhalt ist deterministisch', () => {
  const t = new Terrain('chunky');
  const a = genChunk(t, t.seed, 7, -3);
  const b = genChunk(t, t.seed, 7, -3);
  assert.deepEqual(a.loot.map((l) => l.uid + l.type), b.loot.map((l) => l.uid + l.type));
  assert.equal(a.colliders.length, b.colliders.length);
});
test('Startchunk (0,0) enthält Garage mit allen Start-Teilen', () => {
  const t = new Terrain('s');
  const c = genChunk(t, t.seed, 0, 0);
  const types = c.loot.map((l) => l.type);
  for (const need of ['engine', 'battery', 'spark_plugs', 'radiator', 'jerrycan', 'toolbox']) assert.ok(types.includes(need), 'fehlt: ' + need);
  assert.equal(types.filter((x) => x === 'wheel').length, 2);
});
test('Schuppen liefert Tank + 2 Räder, Tankstelle hat Zapfsäulen', () => {
  const t = new Terrain('s');
  const shed = genChunk(t, t.seed, -1, 0).loot.map((l) => l.type);
  assert.ok(shed.includes('fuel_tank'));
  assert.equal(shed.filter((x) => x === 'wheel').length, 2);
  const gas = genChunk(t, t.seed, 0, -1);
  assert.ok(gas.pumps.length >= 2);
});
test('Alle benötigten Teile sind im Startgebiet erreichbar', () => {
  const t = new Terrain('any-seed-123');
  const all = [];
  for (let cz = -1; cz <= 0; cz++) for (let cx = -1; cx <= 0; cx++) all.push(...genChunk(t, t.seed, cx, cz).loot.map((l) => l.type));
  const count = (x) => all.filter((y) => y === x).length;
  assert.ok(count('wheel') >= 4 && count('engine') >= 1 && count('battery') >= 1 && count('fuel_tank') >= 1 && count('spark_plugs') >= 1);
});
test('Loot-Typen existieren in den Definitionen; POIs entstehen in der Ferne', () => {
  const t = new Terrain('poi');
  const kinds = new Set();
  for (let cz = -12; cz < 12; cz++) {
    for (let cx = -12; cx < 12; cx++) {
      const c = genChunk(t, t.seed, cx, cz);
      for (const l of c.loot) assert.ok(ITEM_DEFS[l.type], l.type);
      for (const p of c.pois) kinds.add(p.type);
    }
  }
  for (const k of ['house', 'wreck', 'gas_station', 'water_tower', 'radio_mast', 'settlement', 'military']) assert.ok(kinds.has(k), 'POI fehlt: ' + k);
});

console.log('Kollision');
test('Kreis gegen gedrehte Box und Zylinder', () => {
  const box = { t: 'obb', x: 0, z: 0, hx: 2, hz: 1, ry: Math.PI / 2 };
  assert.ok(circleVs(box, 0, 2.2, 0.5)); // Box ist gedreht: lange Seite entlang Z
  assert.equal(circleVs(box, 2.2, 0, 0.5), null);
  const cyl = { t: 'cyl', x: 5, z: 5, r: 1 };
  const o = circleVs(cyl, 6.2, 5, 0.5);
  assert.ok(o && o.nx > 0.99 && Math.abs(o.pen - 0.3) < 1e-6);
  assert.ok(pointInside(box, 0, 1.9) && !pointInside(box, 1.2, 0));
});

console.log('Zombie-KI');
test('Zombie hört Lärm, verfolgt Spieler und greift an', () => {
  const t = new Terrain('z');
  const sim = new ZombieSim({ terrain: t, queryColliders: () => {}, spawnPoints: () => [] });
  const z = sim.spawn(300, 300, 'test');
  const players = [{ id: 'p', x: 300, y: 0, z: 310, inCar: false, carSpeed: 0, sprint: false, crouch: false, light: false, noise: 0 }];
  // Sicht: 10 m < 30 m -> Verfolgung
  for (let i = 0; i < 30; i++) sim.update(0.1, players, { night: 0, storm: 0 });
  assert.ok([ZS.CHASE, ZS.ATTACK].includes(z.state), 'Zustand ' + z.state);
  let attacked = false;
  for (let i = 0; i < 100 && !attacked; i++) {
    sim.update(0.1, players, { night: 0, storm: 0 });
    attacked = sim.drainEvents().some((e) => e.type === 'attackPlayer');
  }
  assert.ok(attacked, 'kein Angriff');
});
test('Hupe/Geräusch lockt weit entfernte Zombies an', () => {
  const t = new Terrain('z');
  const sim = new ZombieSim({ terrain: t, queryColliders: () => {}, spawnPoints: () => [] });
  const z = sim.spawn(500, 500, 'test');
  sim.noise(560, 500, 100);
  assert.equal(z.state, ZS.INVESTIGATE);
});
test('Schaden tötet, Zähler steigt', () => {
  const t = new Terrain('z');
  const sim = new ZombieSim({ terrain: t, queryColliders: () => {}, spawnPoints: () => [] });
  const z = sim.spawn(0, 500, 'test');
  assert.ok(sim.damage(z.id, 500, false, 1, 0, 'p'));
  assert.equal(z.state, ZS.DEAD);
  assert.equal(sim.kills, 1);
});
test('Nachts spawnen Zombies an Spawnpunkten nahe Spielern', () => {
  const t = new Terrain('z');
  const sim = new ZombieSim({ terrain: t, queryColliders: () => {}, spawnPoints: () => [{ x: 1060, z: 1000, kind: 'ruin' }, { x: 1000, z: 1070, kind: 'ruin' }] });
  const players = [{ id: 'p', x: 1000, y: 0, z: 1000, noise: 0 }];
  for (let i = 0; i < 100; i++) sim.update(0.5, players, { night: 1, storm: 0 });
  assert.ok(sim.zombies.size >= 2);
});

console.log('Überleben / Wetter / Inventar');
test('Tageszyklus: Mittag heiß, Nacht kalt', () => {
  assert.ok(ambientTemp(14.5) > 36);
  assert.ok(ambientTemp(2.5) < 5);
  assert.ok(sunElevation(12) > 0.95 && sunElevation(0) < -0.9);
  assert.equal(Math.round(hourOf(0)), 7);
});
test('Sandstürme treten deterministisch auf', () => {
  let storms = 0;
  for (let t = 0; t < 36000; t += 10) if (stormIntensity('seed', t) > 0.5) storms++;
  assert.ok(storms > 20 && storms < 3000, 'storms=' + storms);
  assert.equal(stormIntensity('seed', 12345), stormIntensity('seed', 12345));
});
test('Durst, Hunger und Unterkühlung kosten Gesundheit', () => {
  const v = new Vitals();
  v.thirst = 0;
  v.hunger = 0;
  for (let i = 0; i < 400; i++) v.update(0.5, { ambient: 25, sprinting: false, moving: false });
  assert.ok(v.dead && /Verdurstet/.test(v.deathCause));
  const c = new Vitals();
  for (let i = 0; i < 4000; i++) c.update(0.5, { ambient: -2, sprinting: false, moving: false });
  assert.ok(c.temp < 36, 'temp ' + c.temp);
});
test('Mittagssonne ohne Schatten überhitzt, Schatten schützt', () => {
  const sun = new Vitals();
  const shade = new Vitals();
  for (let i = 0; i < 600; i++) {
    sun.update(0.5, { ambient: 38, sun: 1 });
    shade.update(0.5, { ambient: 38, sun: 0 });
  }
  assert.ok(sun.temp > 39.4 && shade.temp < 38.8, `sun ${sun.temp} shade ${shade.temp}`);
});
test('Lagerfeuer wärmt', () => {
  const a = new Vitals();
  const b = new Vitals();
  for (let i = 0; i < 400; i++) {
    a.update(0.5, { ambient: -2, fireWarmth: 0 });
    b.update(0.5, { ambient: -2, fireWarmth: 1 });
  }
  assert.ok(b.temp > a.temp + 1.5);
});
test('Inventar: große Teile nur in den Händen, Stapel werden zusammengeführt', () => {
  const inv = new Inventory();
  const mk = (type, st = {}) => ({ uid: Math.random() + '', type, state: { ...defaultState(type), ...st } });
  assert.ok(inv.add(mk('engine')));
  assert.ok(!inv.add(mk('wheel')));
  assert.ok(inv.add(mk('ammo9', { count: 10 })));
  assert.ok(inv.add(mk('ammo9', { count: 5 })));
  assert.equal(inv.count('ammo9'), 15);
  assert.ok(inv.consume('ammo9', 12));
  assert.equal(inv.count('ammo9'), 3);
});

console.log(`\n${passed} Tests bestanden${process.exitCode ? ' – FEHLER' : ''}`);
