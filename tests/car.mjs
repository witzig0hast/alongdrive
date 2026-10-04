// Stabilitätstest der Fahrphysik (ohne Browser): zufällige Eingaben, Kollisionen mit POIs/Felsen, keine NaNs/Explosionen
import * as THREE from 'three';
import { Terrain, CHUNK, GRIP } from '../src/world/heightfield.js';
import { genChunk, chunkKey } from '../src/world/worldgen.js';
import { colliderBounds } from '../src/world/collision.js';
import { mulberry32 } from '../src/core/rng.js';
import { Car } from '../src/vehicle/car.js';
import { REQUIRED, SLOTS } from '../src/vehicle/carDef.js';

const terrain = new Terrain('car-test');
const chunks = new Map();
const getChunk = (cx, cz) => {
  const k = chunkKey(cx, cz);
  let c = chunks.get(k);
  if (!c) {
    c = genChunk(terrain, terrain.seed, cx, cz);
    for (const col of c.colliders) col.bb = colliderBounds(col);
    chunks.set(k, c);
  }
  return c;
};
const world = {
  terrain,
  dynamic: [],
  surfaceAt: (x, z) => terrain.surfaceAt(x, z),
  heightAt: (x, z) => terrain.heightAt(x, z),
  groundAt: (x, z) => terrain.heightAt(x, z),
  queryColliders(x, z, r, cb) {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) for (const c of getChunk(cx + dx, cz + dz).colliders) {
      const bb = c.bb;
      if (x + r < bb[0] || x - r > bb[2] || z + r < bb[1] || z - r > bb[3]) continue;
      cb(c);
    }
    for (const c of this.dynamic) cb(c);
  },
};
const scene = { add() {}, remove() {} };
let fails = 0;
const check = (cond, msg) => {
  if (!cond) {
    console.error('  ✗', msg);
    fails++;
  } else console.log('  ✓', msg);
};

function build() {
  const car = new Car(scene, world);
  for (const id of REQUIRED) car.installed[id] = { type: SLOTS[id].item, state: { cond: 1, charge: 1 } };
  car.installed.radiator = { type: 'radiator', state: { cond: 1 } };
  car.fuel = 60;
  car.refreshParts();
  return car;
}

console.log('Fahrphysik');
{
  // 1) Beschleunigung & Höchstgeschwindigkeit auf ebenem Boden (künstlich flaches Gelände, Sand)
  const flat = new Terrain('flat');
  flat.heightAt = () => 0;
  flat.surfaceAt = () => 0;
  const fw = { ...world, terrain: flat, surfaceAt: () => 0, heightAt: () => 0, groundAt: () => 0 };
  const car = new Car(scene, fw);
  for (const id of REQUIRED) car.installed[id] = { type: SLOTS[id].item, state: { cond: 1, charge: 1 } };
  car.installed.radiator = { type: 'radiator', state: { cond: 1 } };
  car.fuel = 60;
  car.refreshParts();
  car.placeAt(0, 40, 0);
  car.driver = 'local';
  car.engineOn = true;
  const dt = 1 / 60;
  let t = 0;
  let t100 = null;
  let vmax = 0;
  for (let i = 0; i < 60 * 40; i++) {
    car.setInput({ throttle: 1, brake: 0, steer: 0, handbrake: false });
    car.update(dt, { ambient: 25 });
    t += dt;
    if (t100 == null && car.speedKmh >= 100) t100 = t;
    vmax = Math.max(vmax, car.speedKmh);
  }
  console.log(`   0–100 km/h: ${t100 ? t100.toFixed(1) + ' s' : 'nicht erreicht'}, Vmax ${vmax.toFixed(0)} km/h`);
  check(t100 && t100 > 4 && t100 < 25, 'Beschleunigung plausibel');
  check(vmax > 100 && vmax < 220, 'Höchstgeschwindigkeit plausibel');
  check(Number.isFinite(car.pos.x) && car.pos.y > -5, 'Position endlich');
  check(car.fuel < 60 && car.temp > 30, 'Treibstoff sinkt, Motor erwärmt sich');
}
{
  // 2) Chaos-Test: zufällige Eingaben, Gelände mit Felsen/POIs
  const rng = mulberry32(5);
  let bad = 0;
  let maxV = 0;
  let maxAng = 0;
  let overheated = 0;
  for (let run = 0; run < 6; run++) {
    const car = build();
    const sx = (rng() - 0.5) * 6000;
    const sz = (rng() - 0.5) * 6000;
    car.placeAt(sx, sz, rng() * 6.28);
    car.driver = 'local';
    car.engineOn = true;
    let inp = { throttle: 1, brake: 0, steer: 0, handbrake: false };
    for (let i = 0; i < 60 * 90; i++) {
      if (i % 40 === 0) {
        inp = { throttle: rng() < 0.8 ? 1 : 0, brake: rng() < 0.15 ? 1 : 0, steer: (rng() - 0.5) * 2, handbrake: rng() < 0.1 };
      }
      car.setInput(inp);
      car.steer += (inp.steer * 0.5 - car.steer) * 0.1;
      car.update(1 / 60, { ambient: 38 });
      if (!Number.isFinite(car.pos.x + car.pos.y + car.pos.z + car.vel.x + car.vel.y + car.vel.z + car.quat.x + car.quat.w + car.ang.x)) {
        bad++;
        break;
      }
      maxV = Math.max(maxV, car.vel.length());
      maxAng = Math.max(maxAng, car.ang.length());
      const gh = terrain.heightAt(car.pos.x, car.pos.z);
      if (car.pos.y < gh - 1.5 || car.pos.y > gh + 80) {
        bad++;
        console.log('   unter/über Terrain', car.pos.y, gh);
        break;
      }
      if (car.temp > 120) overheated++;
      if (!car.engineOn) car.engineOn = car.fuel > 0 && car.temp < 120 && car.hull > 0;
    }
  }
  console.log(`   maxV ${maxV.toFixed(1)} m/s, maxω ${maxAng.toFixed(1)} rad/s`);
  check(bad === 0, 'keine NaNs / Explosionen / Terrain-Durchdringung');
  check(maxV < 70 && maxAng < 25, 'Geschwindigkeiten bleiben beschränkt');
}
{
  // 3) Aufprall auf Wand: Auto wird gestoppt und beschädigt
  const car = build();
  const t = new Terrain('x');
  // Garagenwand (Rückwand z=-6): Auto von innen mit Vollgas nach hinten
  const w = { ...world, terrain: world.terrain };
  car.placeAt(0, -0.6, Math.PI); // schaut nach -Z (Rückwand)
  car.driver = 'local';
  car.engineOn = true;
  const hull0 = car.hull;
  let minZ = 0;
  for (let i = 0; i < 60 * 8; i++) {
    car.setInput({ throttle: 1, brake: 0, steer: 0, handbrake: false });
    car.update(1 / 60, { ambient: 25 });
    minZ = Math.min(minZ, car.pos.z);
  }
  check(minZ > -7.5, `Garagenwand hält das Auto auf (min z = ${minZ.toFixed(2)})`);
  check(car.hull < hull0, `Aufprallschaden (${car.hull.toFixed(1)} %)`);
}
{
  // 4) Überhitzung bei Vollgas im Stand/Bergan ohne Kühler
  const car = build();
  delete car.installed.radiator;
  car.placeAt(0, 40, 0);
  car.driver = 'local';
  car.engineOn = true;
  car.setInput({ throttle: 1, brake: 1, steer: 0, handbrake: true });
  let maxT = 0;
  for (let i = 0; i < 60 * 120; i++) {
    car.setInput({ throttle: 1, brake: 0, steer: 0, handbrake: true });
    car.update(1 / 60, { ambient: 38 });
    maxT = Math.max(maxT, car.temp);
    if (!car.engineOn) break;
  }
  check(maxT > 105, `Überhitzung ohne Kühler bei Vollgas (max ${maxT.toFixed(0)} °C)`);
}
console.log(fails ? `\n${fails} FEHLER` : '\nFahrphysik-Tests bestanden');
process.exit(fails ? 1 : 0);
