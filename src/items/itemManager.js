// Physische Gegenstände: Welt-Physik, Aufheben, Werfen, Ladefläche, Chunk-Loot, Speichern
import * as THREE from 'three';
import { ITEM_DEFS, defaultState } from './defs.js';
import { makeItemMesh } from './models.js';
import { BED } from '../vehicle/carDef.js';

const _v = new THREE.Vector3();
const _p = { x: 0, z: 0 };
const VIS_DIST = 140;
const PHYS_DIST = 110;

export class ItemEntity {
  constructor(uid, type, state) {
    this.uid = uid;
    this.type = type;
    this.state = state;
    this.def = ITEM_DEFS[type];
    this.half = (this.def.h || 0.1) / 2;
    this.mode = 'world'; // world | car | held | inv
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.local = new THREE.Vector3(); // Position in Auto-Koordinaten
    this.lvy = 0;
    this.yaw = 0;
    this.spin = new THREE.Vector3();
    this.asleep = true;
    this.mesh = null;
    this.visible = true;
    this.netDirty = false;
  }
}

export class ItemManager {
  constructor(scene, world) {
    this.scene = scene;
    this.world = world;
    this.items = new Map();
    this.taken = new Set();
    this.spawned = new Set();
    this.car = null;
    this.counter = 0;
    this.clientId = 'x';
    this.group = new THREE.Group();
    scene.add(this.group);
    this.visTimer = 0;
    this.listeners = { settle: null, pick: null, drop: null, remove: null };
    this.netMode = false;
  }

  newUid() {
    return `D:${this.clientId}:${++this.counter}:${Date.now() % 100000}`;
  }

  create(uid, type, state, pos, opts = {}) {
    const e = new ItemEntity(uid, type, state || defaultState(type));
    e.pos.copy(pos);
    e.yaw = opts.yaw ?? Math.random() * Math.PI * 2;
    if (opts.vel) e.vel.copy(opts.vel);
    e.asleep = opts.asleep ?? true;
    e.mesh = makeItemMesh(type);
    e.mesh.userData.item = e;
    this.group.add(e.mesh);
    this._sync(e);
    this.items.set(uid, e);
    return e;
  }

  /** Neuer Gegenstand durch den Spieler (Drop/Wurf) */
  spawn(type, state, pos, vel, yaw) {
    const e = this.create(this.newUid(), type, state, pos, { vel, yaw, asleep: false });
    e.spin.set((Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 6);
    return e;
  }

  /** Aus Inventar wieder in die Welt (behält uid) */
  place(e, pos, vel) {
    e.mode = 'world';
    e.pos.copy(pos);
    e.vel.copy(vel || _v.set(0, 0, 0));
    e.asleep = false;
    e.spin.set((Math.random() - 0.5) * 5, 0, (Math.random() - 0.5) * 5);
    if (!e.mesh) {
      e.mesh = makeItemMesh(e.type);
      e.mesh.userData.item = e;
    }
    this.group.add(e.mesh);
    this._sync(e);
    if (!this.items.has(e.uid)) this.items.set(e.uid, e);
    this.listeners.drop?.(e);
    return e;
  }

  _sync(e) {
    if (e.mode === 'world' && e.mesh) {
      e.mesh.position.copy(e.pos);
      e.mesh.rotation.set(e.tiltX || 0, e.yaw, e.tiltZ || 0);
    }
  }

  onChunkLoaded(chunk) {
    if (this.spawned.has(chunk.key)) return;
    this.spawned.add(chunk.key);
    for (const l of chunk.content.loot) {
      if (this.taken.has(l.uid) || this.items.has(l.uid)) continue;
      const def = ITEM_DEFS[l.type];
      const y0 = this.world.groundAt(l.x, l.z, l.y + 0.1, 0.1);
      const p = new THREE.Vector3(l.x, y0 + def.h / 2 + 0.005, l.z);
      const e = this.create(l.uid, l.type, l.state, p, { yaw: ((l.x * 7.3 + l.z * 3.1) % 6.28) });
      if (def.cat === 'part' && def.slot === 'wheel') e.mesh.rotation.z = 0;
    }
  }

  /** Von der Welt entfernen (aufgehoben/verbraucht). Gibt Entity zurück. */
  take(e, silent = false) {
    if (e.mode === 'car') this._detach(e);
    if (e.uid.startsWith('L:') || e.uid.startsWith('S:')) this.taken.add(e.uid);
    this.items.delete(e.uid);
    if (e.mesh) {
      e.mesh.removeFromParent();
      e.mesh = null;
    }
    e.mode = 'inv';
    if (!silent) this.listeners.pick?.(e);
    return e;
  }

  /** Gegenstand verschwindet komplett (verbraucht) */
  destroy(e, silent = false) {
    if (this.items.has(e.uid) || e.mesh) this.take(e, true);
    if (!silent) this.listeners.remove?.(e);
  }

  /** Ray-Auswahl: nächster aufhebbarer Gegenstand */
  pickRay(origin, dir, maxDist = 3.4) {
    let best = null;
    let bestT = maxDist;
    for (const e of this.items.values()) {
      if (!e.visible || e.mode === 'held') continue;
      const p = e.mode === 'car' ? e.mesh.getWorldPosition(_v) : e.pos;
      const dx = p.x - origin.x;
      const dy = p.y - origin.y;
      const dz = p.z - origin.z;
      const t = dx * dir.x + dy * dir.y + dz * dir.z;
      if (t < 0.05 || t > bestT) continue;
      const d2 = dx * dx + dy * dy + dz * dz - t * t;
      const r = Math.max(0.2, Math.min(0.42, e.def.radius * 0.65));
      if (d2 < r * r) {
        best = e;
        bestT = t;
      }
    }
    return best;
  }

  nearbyOfType(pos, type, dist) {
    const out = [];
    for (const e of this.items.values()) if (e.type === type && e.pos.distanceTo(pos) < dist) out.push(e);
    return out;
  }

  _attach(e, local) {
    e.mode = 'car';
    e.local.copy(local);
    e.lvy = 0;
    e.vel.set(0, 0, 0);
    e.spin.set(0, 0, 0);
    e.tiltX = e.tiltZ = 0;
    e.asleep = true;
    this.car.group.add(e.mesh);
    e.mesh.position.copy(e.local);
    e.mesh.rotation.set(0, e.yaw - this.car.yawNow(), 0);
    this.listeners.settle?.(e);
  }

  _detach(e) {
    if (e.mode !== 'car' || !e.mesh) return;
    this.car.group.updateMatrixWorld(true);
    e.mesh.getWorldPosition(e.pos);
    e.yaw = this.car.yawNow() + e.mesh.rotation.y;
    e.mode = 'world';
    this.group.add(e.mesh);
    this._sync(e);
  }

  /** Legt Gegenstand gezielt auf die Ladefläche */
  loadIntoCar(e, localPos) {
    if (e.mode !== 'world' && e.mode !== 'inv') return;
    if (!e.mesh) {
      e.mesh = makeItemMesh(e.type);
      e.mesh.userData.item = e;
    }
    this.items.set(e.uid, e);
    e.yaw = this.car.yawNow() + (Math.random() - 0.5) * 0.6;
    this._attach(e, localPos);
    this.listeners.drop?.(e);
  }

  update(dt, focus, carMoving) {
    this.visTimer -= dt;
    if (this.visTimer <= 0) {
      this.visTimer = 0.4;
      for (const e of this.items.values()) {
        if (e.mode === 'car') {
          e.visible = true;
          continue;
        }
        const d = Math.hypot(e.pos.x - focus.x, e.pos.z - focus.z);
        const v = d < VIS_DIST;
        if (v !== e.visible && e.mesh) {
          e.mesh.visible = v;
        }
        e.visible = v;
      }
    }
    const car = this.car;
    for (const e of this.items.values()) {
      if (e.mode === 'car') {
        this._updateCar(e, dt);
        continue;
      }
      if (e.mode !== 'world' || e.asleep) continue;
      if (Math.hypot(e.pos.x - focus.x, e.pos.z - focus.z) > PHYS_DIST) {
        // zu weit weg: einfach auf den Boden setzen
        e.pos.y = this.world.groundAt(e.pos.x, e.pos.z, e.pos.y, 0.3) + e.half;
        e.asleep = true;
        this._sync(e);
        continue;
      }
      this._physics(e, dt, car);
    }
  }

  _physics(e, dt, car) {
    e.vel.y -= 15 * dt;
    e.pos.addScaledVector(e.vel, dt);
    const half = e.half;
    // Ladefläche?
    if (car && car.assembledForCargo()) {
      const l = car.worldToLocal(e.pos, _v);
      if (l.x > BED.x0 && l.x < BED.x1 && l.z > BED.z0 && l.z < BED.z1 && l.y > BED.floor - 0.1 && l.y < BED.floor + 2.2) {
        l.x = Math.max(BED.x0 + 0.15, Math.min(BED.x1 - 0.15, l.x));
        l.z = Math.max(BED.z0 + 0.15, Math.min(BED.z1 - 0.15, l.z));
        this._attach(e, l.clone());
        return;
      }
    }
    // horizontale Kollision
    _p.x = e.pos.x;
    _p.z = e.pos.z;
    const r = Math.min(0.22, e.def.radius * 0.6);
    const hit = this.world.pushOut(_p, r, e.pos.y - half, e.pos.y + half);
    if (hit) {
      e.vel.x = (_p.x - e.pos.x) * 4 + e.vel.x * -0.3;
      e.vel.z = (_p.z - e.pos.z) * 4 + e.vel.z * -0.3;
      e.pos.x = _p.x;
      e.pos.z = _p.z;
    }
    const g = this.world.groundAt(e.pos.x, e.pos.z, e.pos.y - half + 0.2, 0.2);
    if (e.pos.y - half <= g) {
      e.pos.y = g + half;
      if (e.vel.y < -2.2) {
        e.vel.y *= -0.3;
        e.vel.x *= 0.6;
        e.vel.z *= 0.6;
        this.onBounce?.(e);
      } else e.vel.y = 0;
      const f = Math.exp(-7 * dt);
      e.vel.x *= f;
      e.vel.z *= f;
      e.spin.multiplyScalar(f);
      e.tiltX = (e.tiltX || 0) * f;
      e.tiltZ = (e.tiltZ || 0) * f;
      if (Math.hypot(e.vel.x, e.vel.z) < 0.12 && Math.abs(e.vel.y) < 0.2) {
        e.asleep = true;
        e.vel.set(0, 0, 0);
        e.tiltX = e.tiltZ = 0;
        this.listeners.settle?.(e);
      }
    }
    e.yaw += e.spin.y * dt;
    e.tiltX = (e.tiltX || 0) + e.spin.x * dt;
    e.tiltZ = (e.tiltZ || 0) + e.spin.z * dt;
    this._sync(e);
  }

  _updateCar(e, dt) {
    const car = this.car;
    if (!car) return;
    const half = e.half;
    e.lvy -= 14 * dt;
    e.local.y += e.lvy * dt;
    let floor = BED.floor + half;
    for (const o of this.items.values()) {
      if (o === e || o.mode !== 'car') continue;
      if (Math.abs(o.local.x - e.local.x) < 0.22 && Math.abs(o.local.z - e.local.z) < 0.22 && o.local.y < e.local.y + 0.01) {
        floor = Math.max(floor, o.local.y + o.half + half);
      }
    }
    if (e.local.y < floor) {
      e.local.y = floor;
      e.lvy = 0;
    }
    e.local.x = Math.max(BED.x0 + 0.12, Math.min(BED.x1 - 0.12, e.local.x));
    e.local.z = Math.max(BED.z0 + 0.12, Math.min(BED.z1 - 0.12, e.local.z));
    e.mesh.position.copy(e.local);
    if (e.mesh.matrixWorld) e.mesh.getWorldPosition(e.pos);
  }

  /** Setzt Weltposition der Car-Items (nach Auto-Update) */
  syncCarItems() {
    for (const e of this.items.values()) if (e.mode === 'car' && e.mesh) e.mesh.getWorldPosition(e.pos);
  }

  /** Alle Items nahe einer Position wecken (z. B. nach Entfernen einer Unterlage) */
  wakeAround(x, z, r) {
    for (const e of this.items.values()) if (e.mode === 'world' && Math.hypot(e.pos.x - x, e.pos.z - z) < r) e.asleep = false;
  }

  serialize() {
    const items = [];
    for (const e of this.items.values()) {
      if (e.mode === 'world') items.push({ uid: e.uid, type: e.type, state: e.state, x: e.pos.x, y: e.pos.y, z: e.pos.z, yaw: e.yaw, mode: 'world' });
      else if (e.mode === 'car') items.push({ uid: e.uid, type: e.type, state: e.state, x: e.local.x, y: e.local.y, z: e.local.z, yaw: e.yaw - this.car.yawNow(), mode: 'car' });
    }
    return { items, taken: [...this.taken], spawned: [...this.spawned], counter: this.counter };
  }

  restore(data) {
    this.clear();
    this.taken = new Set(data.taken || []);
    this.spawned = new Set(data.spawned || []);
    this.counter = data.counter || 0;
    for (const s of data.items || []) {
      const e = this.create(s.uid, s.type, s.state, new THREE.Vector3(s.x, s.y, s.z), { yaw: s.yaw });
      if (s.mode === 'car') {
        e.yaw = (s.yaw || 0) + this.car.yawNow();
        this._attach(e, new THREE.Vector3(s.x, s.y, s.z));
      }
    }
  }

  clear() {
    for (const e of this.items.values()) e.mesh?.removeFromParent();
    this.items.clear();
    this.taken.clear();
    this.spawned.clear();
  }
}
