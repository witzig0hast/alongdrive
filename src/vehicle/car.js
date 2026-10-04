// Fahrzeug: eigene Raycast-Vehicle-Physik (Federung, Reifengrip nach Untergrund, Gewicht),
// Teile/Zustände, Motor, Treibstoff, Temperatur, Schäden, Ladefläche.
import * as THREE from 'three';
import { buildCarMesh } from './carMesh.js';
import { SLOTS, SLOT_IDS, REQUIRED, WHEELS, PHYS, SEATS, REST_Y, BED } from './carDef.js';
import { GRIP } from '../world/heightfield.js';
import { circleVs } from '../world/collision.js';
import { clamp, smooth, lerp } from '../core/rng.js';

const G = 9.81;
const CRR = [0.05, 0.016, 0.022];
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _n = { x: 0, y: 1, z: 0 };

const INERTIA = new THREE.Vector3(3600, 3900, 1500); // x=Nicken, y=Gieren, z=Rollen

export class Car {
  constructor(scene, world) {
    this.world = world;
    this.scene = scene;
    this.mesh = buildCarMesh();
    this.group = new THREE.Group();
    this.group.add(this.mesh.root);
    scene.add(this.group);

    this.pos = new THREE.Vector3(0, REST_Y + 0.05, -0.6);
    this.quat = new THREE.Quaternion();
    this.vel = new THREE.Vector3();
    this.ang = new THREE.Vector3();

    this.installed = {}; // slotId -> {type, state}
    this.fuel = 0;
    this.temp = 20;
    this.hull = 100;
    this.odometer = 0; // Meter
    this.engineOn = false;
    this.cranking = 0;
    this.stalled = '';
    this.lightsOn = false;
    this.hornOn = false;
    this.input = { throttle: 0, brake: 0, steer: 0, handbrake: false };
    this.steer = 0;
    this.rpm = 0;
    this.gear = 1;
    this.reverse = false;
    this.shiftTimer = 0;
    this.speed = 0; // m/s (vorwärts +)
    this.speedKmh = 0;
    this.driver = null; // 'local' | 'remote' | null
    this.passenger = null;
    this.remote = false; // von anderem Spieler gesteuert (Mehrspieler)
    this.sleeping = true;
    this.contacts = [false, false, false, false];
    this.wheelSlip = [0, 0, 0, 0];
    this.wheelSpin = [0, 0, 0, 0];
    this.suspLen = [0.4, 0.4, 0.4, 0.4];
    this.impact = 0; // letzter Aufprall (für Sound)
    this.skid = 0;
    this.load = 0;
    this.surf = 0;
    this.lastDrive = 0;
    this.target = null; // Mehrspieler-Interpolation

    this.colHull = { t: 'obb', x: 0, z: 0, hx: 1.0, hz: 1.7, ry: 0, y0: 0, y1: 0, dyn: true, car: true, ox: 0, oz: 1.1 };
    this.colBed = { t: 'obb', x: 0, z: 0, hx: 0.95, hz: 1.15, ry: 0, y0: 0, y1: 0, dyn: true, car: true, bed: true, ox: 0, oz: -1.65 };
    world.dynamic.push(this.colHull, this.colBed);
    this._syncVisual();
    this.refreshParts();
  }

  // ------------------------------------------------------------- Zustand / Teile
  yawNow() {
    const f = _fwd.set(0, 0, 1).applyQuaternion(this.quat);
    return Math.atan2(f.x, f.z);
  }

  heading() {
    return this.yawNow();
  }

  worldToLocal(p, out) {
    return out.copy(p).sub(this.pos).applyQuaternion(_q.copy(this.quat).invert());
  }

  localToWorld(l, out) {
    return out.copy(l).applyQuaternion(this.quat).add(this.pos);
  }

  assembledForCargo() {
    return true;
  }

  isInstalled(id) {
    return !!this.installed[id];
  }

  missingRequired() {
    return REQUIRED.filter((id) => !this.installed[id]);
  }

  assembled() {
    return this.missingRequired().length === 0;
  }

  install(slotId, item) {
    this.installed[slotId] = { type: item.type, state: { ...item.state } };
    this.refreshParts();
  }

  slotState(id) {
    return this.installed[id]?.state;
  }

  refreshParts() {
    const m = this.mesh;
    for (const id of SLOT_IDS) {
      const inst = !!this.installed[id];
      if (m.parts[id]) m.parts[id].visible = inst;
      if (m.wheels[id]) m.wheels[id].pivot.visible = inst;
    }
    const wheelCount = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'].filter((i) => this.installed[i]).length;
    m.stands.visible = wheelCount < 4;
    // flache Reifen
    for (const w of WHEELS) {
      const st = this.slotState(w.id);
      if (st && m.wheels[w.id]) {
        const flat = st.cond <= 0.03;
        m.wheels[w.id].spin.scale.set(1, flat ? 0.78 : 1, flat ? 0.78 : 1);
      }
    }
  }

  engineCond() {
    return this.slotState('engine')?.cond ?? 0;
  }

  battery() {
    return this.slotState('battery');
  }

  // ------------------------------------------------------------- Eingabe / Bedienung
  setInput(i) {
    this.input = i;
  }

  tryStart() {
    if (this.engineOn) return 'Motor läuft bereits';
    const miss = this.missingRequired();
    if (miss.length) return 'Auto unvollständig: ' + miss.map((m) => SLOTS[m].label).join(', ');
    if (this.fuel <= 0.05) return 'Kein Treibstoff im Tank';
    const b = this.battery();
    if (!b || b.charge < 0.04) return 'Batterie leer';
    if (this.hull <= 0) return 'Karosserie total zerstört – reparieren (Werkzeugkasten)';
    if (this.temp > 112) return 'Motor zu heiß – abkühlen lassen';
    if (this.engineCond() < 0.02) return 'Motor defekt – reparieren (Werkzeugkasten)';
    this.cranking = 0.9;
    b.charge = Math.max(0, b.charge - 0.025);
    this.stalled = '';
    return null;
  }

  stopEngine() {
    this.engineOn = false;
    this.cranking = 0;
  }

  /** Reparatur mit Werkzeugkasten; gibt Meldung oder null */
  repair(kind) {
    const eng = this.slotState('engine');
    const plugs = this.slotState('plugs');
    const rad = this.slotState('radiator');
    if (kind === 'tire') {
      let worst = null;
      for (const w of WHEELS) {
        const st = this.slotState(w.id);
        if (st && (!worst || st.cond < worst.cond)) worst = st;
      }
      if (!worst || worst.cond > 0.85) return 'Reifen sind in Ordnung';
      worst.cond = Math.min(1, worst.cond + 0.45);
      this.refreshParts();
      return 'Reifen geflickt';
    }
    const cands = [];
    if (this.hull < 90) cands.push([this.hull / 100, 'hull']);
    if (eng && eng.cond < 0.9) cands.push([eng.cond, 'engine']);
    if (plugs && plugs.cond < 0.8) cands.push([plugs.cond, 'plugs']);
    if (rad && rad.cond < 0.8) cands.push([rad.cond, 'rad']);
    if (!cands.length) return 'Alles in Ordnung – nichts zu reparieren';
    cands.sort((a, b) => a[0] - b[0]);
    const k = cands[0][1];
    if (k === 'hull') this.hull = Math.min(100, this.hull + 25);
    if (k === 'engine') eng.cond = Math.min(1, eng.cond + 0.3);
    if (k === 'plugs') plugs.cond = Math.min(1, plugs.cond + 0.3);
    if (k === 'rad') rad.cond = Math.min(1, rad.cond + 0.3);
    return { hull: 'Karosserie repariert', engine: 'Motor repariert', plugs: 'Zündkerzen gereinigt', rad: 'Kühler repariert' }[k];
  }

  damage(amount, kind = 'body') {
    if (amount <= 0) return;
    this.hull = clamp(this.hull - amount, 0, 100);
    const eng = this.slotState('engine');
    if (eng && (kind === 'front' || amount > 12)) eng.cond = clamp(eng.cond - amount * 0.004, 0, 1);
  }

  puncture() {
    const ids = WHEELS.map((w) => w.id).filter((id) => this.installed[id]);
    if (!ids.length) return;
    const id = ids[Math.floor(Math.random() * ids.length)];
    this.installed[id].state.cond = 0.02;
    this.refreshParts();
  }

  // ------------------------------------------------------------- Physik
  update(dt, ctx) {
    const world = this.world;
    this.surf = world.surfaceAt(this.pos.x, this.pos.z);
    if (this.remote) {
      this._updateRemote(dt);
      this._syncVisual();
      this._updateSystems(dt, ctx);
      return;
    }
    const physical = this.assembled() || this.driver;
    const awake = this.driver || this.vel.lengthSq() > 0.01 || this.ang.lengthSq() > 0.01 || !this.sleeping;
    if (physical && this.wheelCount() > 0) {
      if (!this.sleeping || this.driver || ctx.forceAwake) {
        this.sleeping = false;
        const n = Math.min(4, Math.ceil(dt / (1 / 120)));
        const h = dt / n;
        this.impact = 0;
        for (let i = 0; i < n; i++) this._step(h);
        this._collideStatics(dt);
        if (!this.driver && this.vel.length() < 0.06 && this.ang.length() < 0.05 && this.contacts.every((c) => c || true)) {
          this.sleepTimer = (this.sleepTimer || 0) + dt;
          if (this.sleepTimer > 1.0) {
            this.sleeping = true;
            this.vel.set(0, 0, 0);
            this.ang.set(0, 0, 0);
          }
        } else this.sleepTimer = 0;
      }
    } else if (!physical || this.wheelCount() === 0) {
      // unmontiert: ruht auf Böcken in der Garage; nach dem Einbau fällt es sanft auf die Federung
      this.sleeping = true;
    }
    this._updateSystems(dt, ctx);
    this._syncVisual();
  }

  wheelCount() {
    return WHEELS.filter((w) => this.installed[w.id]).length;
  }

  wake() {
    this.sleeping = false;
    this.sleepTimer = 0;
  }

  _engineTorque(rpm) {
    const x = clamp(rpm, 800, 6800);
    const rel = (x - 4000) / 3200;
    return PHYS.peakTorque * (1 - rel * rel * 0.75);
  }

  _step(h) {
    const world = this.world;
    const T = world.terrain;
    const q = this.quat;
    const pos = this.pos;
    const up = _up.set(0, 1, 0).applyQuaternion(q);
    const fwdW = _fwd.set(0, 0, 1).applyQuaternion(q);
    const m = PHYS.mass;
    let Fx = 0;
    let Fy = -G * m;
    let Fz = 0;
    let Tx = 0;
    let Ty = 0;
    let Tz = 0;
    const applyF = (fx, fy, fz, px, py, pz) => {
      Fx += fx;
      Fy += fy;
      Fz += fz;
      const rx = px - pos.x;
      const ry = py - pos.y;
      const rz = pz - pos.z;
      Tx += ry * fz - rz * fy;
      Ty += rz * fx - rx * fz;
      Tz += rx * fy - ry * fx;
    };

    // Fahrzeugsteuerung
    const inp = this.input;
    const vel = this.vel;
    const vFwd = vel.x * fwdW.x + vel.y * fwdW.y + vel.z * fwdW.z;
    this.speed = vFwd;
    let throttle = 0;
    let brake = 0;
    const wantFwd = inp.throttle > 0.05;
    const wantBack = inp.brake > 0.05;
    if (this.reverse) {
      if (wantBack) throttle = inp.brake;
      if (wantFwd) brake = inp.throttle;
      if (wantFwd && vFwd > -0.5) this.reverse = false;
    } else {
      if (wantFwd) throttle = inp.throttle;
      if (wantBack) {
        if (vFwd < 0.8) {
          this.reverse = true;
          throttle = inp.brake;
        } else brake = inp.brake;
      }
    }
    if (!this.engineOn || !this.driver) throttle = 0;
    this.load = throttle;
    const eng = this.slotState('engine');
    const plugs = this.slotState('plugs');
    const power = (0.35 + 0.65 * (eng?.cond ?? 0)) * (0.7 + 0.3 * (plugs?.cond ?? 0)) * (this.hull < 30 ? 0.7 : 1) * (this.temp > 118 ? 0.6 : 1);

    // Drehzahl aus Raddrehzahl der Antriebsräder
    let driveV = 0;
    let driveN = 0;
    // Räder
    const wheelData = [];
    for (let wi = 0; wi < 4; wi++) {
      const W = WHEELS[wi];
      const inst = this.installed[W.id];
      if (!inst) {
        this.contacts[wi] = false;
        continue;
      }
      const cond = inst.state.cond ?? 1;
      const att = _v1.set(W.pos[0], W.pos[1], W.pos[2]).applyQuaternion(q).add(pos);
      const ax = att.x;
      const ay = att.y;
      const az = att.z;
      const gh = T.heightAt(ax, az);
      const upY = Math.max(0.25, up.y);
      const dist = (ay - gh) / upY;
      const L0 = PHYS.suspRest + 0.12;
      const sw = dist - PHYS.wheelRadius;
      if (sw >= L0) {
        this.contacts[wi] = false;
        this.suspLen[wi] += (L0 - this.suspLen[wi]) * Math.min(1, h * 12);
        continue;
      }
      this.contacts[wi] = true;
      const swc = Math.max(sw, 0.03);
      this.suspLen[wi] = swc;
      const comp = L0 - swc;
      const rx = ax - pos.x;
      const ry = ay - pos.y;
      const rz = az - pos.z;
      const vax = vel.x + (this.ang.y * rz - this.ang.z * ry);
      const vay = vel.y + (this.ang.z * rx - this.ang.x * rz);
      const vaz = vel.z + (this.ang.x * ry - this.ang.y * rx);
      const vUp = vax * up.x + vay * up.y + vaz * up.z;
      let N = PHYS.springK * comp - PHYS.damper * vUp;
      if (sw < 0.03) N += (0.03 - sw) * 120000; // Anschlag
      N = clamp(N, 0, 60000);
      applyF(up.x * N, up.y * N, up.z * N, ax, ay, az);

      // Reifenkraft
      const cpx = ax - up.x * (swc + PHYS.wheelRadius);
      const cpy = ay - up.y * (swc + PHYS.wheelRadius);
      const cpz = az - up.z * (swc + PHYS.wheelRadius);
      T.normalAt(cpx, cpz, _n);
      const crx = cpx - pos.x;
      const cry = cpy - pos.y;
      const crz = cpz - pos.z;
      const vcx = vel.x + (this.ang.y * crz - this.ang.z * cry);
      const vcy = vel.y + (this.ang.z * crx - this.ang.x * crz);
      const vcz = vel.z + (this.ang.x * cry - this.ang.y * crx);
      // Radrichtung (gelenkt)
      let fx = fwdW.x;
      let fy = fwdW.y;
      let fz = fwdW.z;
      if (W.front) {
        const sa = this.steer;
        _q2.setFromAxisAngle(up, sa);
        _v2.set(fx, fy, fz).applyQuaternion(_q2);
        fx = _v2.x;
        fy = _v2.y;
        fz = _v2.z;
      }
      const nd = fx * _n.x + fy * _n.y + fz * _n.z;
      fx -= _n.x * nd;
      fy -= _n.y * nd;
      fz -= _n.z * nd;
      const fl = Math.hypot(fx, fy, fz) || 1;
      fx /= fl;
      fy /= fl;
      fz /= fl;
      // seitlich = n × fwd
      const sx = _n.y * fz - _n.z * fy;
      const sy = _n.z * fx - _n.x * fz;
      const sz = _n.x * fy - _n.y * fx;
      const vLong = vcx * fx + vcy * fy + vcz * fz;
      const vLat = vcx * sx + vcy * sy + vcz * sz;
      const flat = cond <= 0.03;
      let mu = GRIP[world.surfaceAt(cpx, cpz)] * (flat ? 0.4 : 0.55 + 0.45 * Math.min(1, cond * 1.4));
      const mEff = m / 4;
      let FL = 0;
      // Antrieb
      if (W.drive) {
        driveV += vLong;
        driveN++;
      }
      wheelData.push({ wi, W, N, fx, fy, fz, sx, sy, sz, vLong, vLat, mu, cpx, cpy, cpz, flat, cond });
    }
    // Drehzahl + Getriebe
    const wr = PHYS.wheelRadius;
    const vDrive = driveN ? driveV / driveN : vFwd;
    const ratio = (this.reverse ? PHYS.reverse : PHYS.gears[this.gear]) * PHYS.finalDrive;
    let rpm = Math.max(PHYS.idleRpm, (Math.abs(vDrive) / wr) * ratio * (60 / (Math.PI * 2)));
    if (this.engineOn && this.driver && throttle > 0.1 && rpm < 2400) rpm = Math.max(rpm, 1500 + 2200 * throttle * 0.3);
    this.rpm += (rpm - this.rpm) * Math.min(1, h * 14);
    if (!this.engineOn) this.rpm += (0 - this.rpm) * Math.min(1, h * 6);
    // Automatik
    this.shiftTimer -= h;
    if (!this.reverse && this.shiftTimer <= 0 && this.engineOn) {
      if (this.rpm > 5500 && this.gear < PHYS.gears.length - 1 && throttle > 0.2) {
        this.gear++;
        this.shiftTimer = 0.45;
      } else if (this.rpm < 2100 && this.gear > 0) {
        this.gear--;
        this.shiftTimer = 0.35;
      }
    }
    if (this.reverse) this.gear = 0;

    let totalDrive = 0;
    if (throttle > 0 && this.engineOn && this.rpm < PHYS.redline) {
      const tq = this._engineTorque(Math.max(this.rpm, 2200)) * power * throttle;
      totalDrive = ((tq * ratio * 0.88) / wr) * (this.reverse ? -1 : 1);
    }
    const nDriveContacts = wheelData.filter((d) => d.W.drive).length || 1;

    let skid = 0;
    for (const d of wheelData) {
      const mEff = m / 4;
      let FL = 0;
      if (d.W.drive) FL += totalDrive / nDriveContacts;
      let latMul = 1;
      // Bremsen
      const brk = brake > 0 ? brake : 0;
      if (brk > 0 || (inp.handbrake && !d.W.front) || (!this.driver && !this.engineOn)) {
        const hb = (inp.handbrake && !d.W.front) || (!this.driver && Math.abs(d.vLong) < 2.5);
        const maxB = hb ? d.mu * d.N : brk * 5200 * (d.W.front ? 1 : 0.8);
        const want = Math.min(maxB, (Math.abs(d.vLong) * mEff) / h * 0.9);
        FL += -Math.sign(d.vLong) * want;
        if (hb && inp.handbrake && !d.W.front) latMul = 0.42;
      }
      // Rollwiderstand (Sand!)
      const crr = CRR[world.surfaceAt(d.cpx, d.cpz)] * (d.flat ? 6 : 1);
      FL += -Math.sign(d.vLong) * Math.min(crr * d.N, (Math.abs(d.vLong) * mEff) / h * 0.5);
      let FS = clamp(-d.vLat * 5200, -(Math.abs(d.vLat) * mEff) / h * 0.9, (Math.abs(d.vLat) * mEff) / h * 0.9);
      const maxF = d.mu * d.N * (d.W.front ? 1 : latMul < 1 ? 0.8 : 1);
      FS *= latMul;
      const mag = Math.hypot(FL, FS);
      let slip = 0;
      if (mag > maxF && mag > 1) {
        const s = maxF / mag;
        FL *= s;
        FS *= s;
        slip = 1;
      }
      this.wheelSlip[d.wi] = Math.max(slip * Math.min(1, mag / 4000), Math.abs(d.vLat) > 3 ? 0.7 : 0);
      skid = Math.max(skid, this.wheelSlip[d.wi]);
      applyF(d.fx * FL + d.sx * FS, d.fy * FL + d.sy * FS, d.fz * FL + d.sz * FS, d.cpx, d.cpy, d.cpz);
      // Reifenverschleiß
      const wear = (Math.abs(d.vLong) * 0.0000045 + (Math.abs(d.vLat) > 1 ? 0.00025 : 0) + (inp.handbrake && !d.W.front ? 0.0004 : 0)) * h * (this.surf === 1 ? 1.4 : 1);
      const st = this.installed[d.W.id].state;
      st.cond = Math.max(0, (st.cond ?? 1) - wear * (d.mu > 0 ? 1 : 0) * 5);
      // Raddrehung
      this.wheelSpin[d.wi] += (d.vLong / wr) * h;
    }
    this.skid = skid;

    // Karosserie-Bodenkontakt (Überschlag, Aufsetzen)
    const hp = [
      [0.95, -0.5, 2.6], [-0.95, -0.5, 2.6], [0.95, -0.5, -2.6], [-0.95, -0.5, -2.6], [0, -0.52, 0],
      [0.95, 1.1, 1.3], [-0.95, 1.1, 1.3], [0.95, 1.1, -0.5], [-0.95, 1.1, -0.5], [0.9, 0.45, -2.7], [-0.9, 0.45, -2.7],
    ];
    for (const p of hp) {
      _v3.set(p[0], p[1], p[2]).applyQuaternion(q).add(pos);
      const gh = T.heightAt(_v3.x, _v3.z) + 0.02;
      const dep = gh - _v3.y;
      if (dep > 0) {
        const rx = _v3.x - pos.x;
        const ry = _v3.y - pos.y;
        const rz = _v3.z - pos.z;
        const vpx = vel.x + (this.ang.y * rz - this.ang.z * ry);
        const vpy = vel.y + (this.ang.z * rx - this.ang.x * rz);
        const vpz = vel.z + (this.ang.x * ry - this.ang.y * rx);
        T.normalAt(_v3.x, _v3.z, _n);
        const vn = vpx * _n.x + vpy * _n.y + vpz * _n.z;
        const Fn = clamp(60000 * dep - 5500 * vn, 0, 90000);
        let tx = vpx - _n.x * vn;
        let ty = vpy - _n.y * vn;
        let tz = vpz - _n.z * vn;
        const tl = Math.hypot(tx, ty, tz);
        let ffx = 0;
        let ffy = 0;
        let ffz = 0;
        if (tl > 0.01) {
          const f = Math.min(0.7 * Fn, (tl * m) / 8 / h);
          ffx = (-tx / tl) * f;
          ffy = (-ty / tl) * f;
          ffz = (-tz / tl) * f;
        }
        applyF(_n.x * Fn + ffx, _n.y * Fn + ffy, _n.z * Fn + ffz, _v3.x, _v3.y, _v3.z);
        if (vn < -3) {
          this.impact = Math.max(this.impact, -vn);
          this._impactDamage(-vn * 0.55, p[1] < 0 ? 'under' : 'roof');
        }
      }
    }

    // Luftwiderstand
    const spd = vel.length();
    const drag = 0.5 * 1.2 * 0.95 * 2.6;
    Fx -= drag * spd * vel.x;
    Fy -= drag * spd * vel.y * 0.5;
    Fz -= drag * spd * vel.z;

    // Integration
    vel.x += (Fx / m) * h;
    vel.y += (Fy / m) * h;
    vel.z += (Fz / m) * h;
    pos.x += vel.x * h;
    pos.y += vel.y * h;
    pos.z += vel.z * h;

    // Winkel: ins lokale System
    _q2.copy(q).invert();
    const wl = _v1.copy(this.ang).applyQuaternion(_q2);
    const tl = _v2.set(Tx, Ty, Tz).applyQuaternion(_q2);
    const Ix = INERTIA.x;
    const Iy = INERTIA.y;
    const Iz = INERTIA.z;
    // Euler-Gleichung
    const ax_ = (tl.x - (Iz - Iy) * wl.y * wl.z) / Ix;
    const ay_ = (tl.y - (Ix - Iz) * wl.z * wl.x) / Iy;
    const az_ = (tl.z - (Iy - Ix) * wl.x * wl.y) / Iz;
    wl.x += ax_ * h;
    wl.y += ay_ * h;
    wl.z += az_ * h;
    // Dämpfung (Rollen stärker)
    wl.x *= 1 - 0.4 * h;
    wl.y *= 1 - 0.25 * h;
    wl.z *= 1 - 0.9 * h;
    this.ang.copy(wl).applyQuaternion(q);
    // Quaternion integrieren
    const wx = this.ang.x;
    const wy = this.ang.y;
    const wz = this.ang.z;
    const hq = 0.5 * h;
    const nq = _q2.set(
      q.x + hq * (wx * q.w + wy * q.z - wz * q.y),
      q.y + hq * (wy * q.w + wz * q.x - wx * q.z),
      q.z + hq * (wz * q.w + wx * q.y - wy * q.x),
      q.w + hq * (-wx * q.x - wy * q.y - wz * q.z),
    );
    q.copy(nq).normalize();
    // Sicherheitsnetz: nie unter dem Terrain
    const gmin = T.heightAt(pos.x, pos.z) - 0.1;
    if (pos.y < gmin + 0.2) {
      pos.y = gmin + 0.2;
      if (vel.y < 0) vel.y *= -0.2;
    }
    // Strecke
    this.odometer += Math.hypot(vel.x, vel.z) * h;
  }

  _impactDamage(speed, where) {
    if (speed < 2) return;
    const dmg = Math.pow(speed - 1.5, 1.35) * 1.4;
    this.damage(dmg, where === 'front' ? 'front' : 'body');
    this.impact = Math.max(this.impact, speed);
    if (speed > 9 && Math.random() < 0.3) this.puncture();
  }

  /** Kollision mit Strukturen / Felsen (4 Kreise entlang der Karosserie) */
  _collideStatics(dt) {
    const yaw = this.yawNow();
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    const bottom = this.pos.y - 0.6;
    const top = this.pos.y + 1.1;
    for (let iter = 0; iter < 2; iter++) {
      for (const lz of [2.2, 0.7, -0.8, -2.3]) {
        const cx = this.pos.x + sin * lz;
        const cz = this.pos.z + cos * lz;
        this.world.queryColliders(cx, cz, 1.2, (c) => {
          if (c.car || c.dyn) return;
          if (c.y1 < bottom + 0.45 || c.y0 > top) return;
          const o = circleVs(c, cx, cz, 0.95);
          if (!o) return;
          this.pos.x += o.nx * o.pen;
          this.pos.z += o.nz * o.pen;
          const vn = this.vel.x * o.nx + this.vel.z * o.nz;
          if (vn < 0) {
            const e = 0.25;
            this.vel.x -= (1 + e) * vn * o.nx;
            this.vel.z -= (1 + e) * vn * o.nz;
            // Giermoment durch Aufprallpunkt
            const rx = cx - this.pos.x;
            const rz = cz - this.pos.z;
            this.ang.y += ((rx * o.nz - rz * o.nx) * -vn * 0.35) / 3.0 * Math.sign(1);
            this._impactDamage(-vn, lz > 0 ? 'front' : 'rear');
            if (-vn > 2) this.impact = Math.max(this.impact, -vn);
          }
        });
      }
    }
  }

  _updateSystems(dt, ctx) {
    const amb = ctx?.ambient ?? 25;
    const eng = this.slotState('engine');
    const bat = this.battery();
    const speed = this.vel.length();
    this.speedKmh = this.speed * 3.6;

    // Anlassen
    if (this.cranking > 0) {
      this.cranking -= dt;
      if (this.cranking <= 0) {
        const plugs = this.slotState('plugs');
        const chance = 0.45 + 0.55 * Math.min(1, (eng?.cond ?? 0) * 0.5 + (plugs?.cond ?? 0) * 0.5 + 0.2);
        if (Math.random() < chance && this.fuel > 0.05) {
          this.engineOn = true;
          this.rpm = PHYS.idleRpm;
          this.onStartResult?.(true);
        } else this.onStartResult?.(false);
      }
    }
    const rpmN = clamp(this.rpm / PHYS.redline, 0, 1.1);
    if (this.engineOn) {
      // Treibstoff
      const lph = 0.0005 + 0.014 * this.load * rpmN + 0.0012 * rpmN;
      this.fuel = Math.max(0, this.fuel - lph * dt);
      if (this.fuel <= 0) {
        this.engineOn = false;
        this.stalled = 'Tank leer – Motor aus';
        this.onStall?.(this.stalled);
      }
      // Batterie lädt
      if (bat) bat.charge = Math.min(1, bat.charge + 0.0025 * dt);
      // Verschleiß
      if (eng) eng.cond = Math.max(0, eng.cond - 0.00006 * (0.2 + this.load * rpmN) * dt);
      const plugs = this.slotState('plugs');
      if (plugs) plugs.cond = Math.max(0, plugs.cond - 0.00003 * (0.5 + this.load) * dt);
      if (eng && eng.cond < 0.02) {
        this.engineOn = false;
        this.stalled = 'Motor ausgefallen';
        this.onStall?.(this.stalled);
      }
    }
    // Temperatur
    const heat = this.engineOn ? 0.35 + 3.0 * this.load * rpmN : 0;
    const rad = this.slotState('radiator');
    const radEff = rad ? 0.55 + 0.45 * rad.cond : 0.28;
    const thermo = smooth(80, 100, this.temp);
    const coef = (0.0015 + thermo * (0.02 + 0.0015 * Math.abs(this.speed))) * radEff * (this.engineOn ? 1 : 0.5);
    this.temp += (heat - coef * (this.temp - amb)) * dt;
    if (this.temp > 115 && eng) {
      eng.cond = Math.max(0, eng.cond - (this.temp - 115) * 0.0005 * dt);
    }
    if (this.temp > 130 && this.engineOn) {
      this.engineOn = false;
      this.stalled = 'Motor überhitzt!';
      this.onStall?.(this.stalled);
    }
    // Licht
    if (this.lightsOn && bat) {
      bat.charge = Math.max(0, bat.charge - 0.0007 * dt * (this.engineOn ? 0.2 : 1));
      if (bat.charge <= 0) this.lightsOn = false;
    }
    if (this.hull <= 0 && this.engineOn) {
      this.engineOn = false;
      this.stalled = 'Totalschaden';
      this.onStall?.(this.stalled);
    }
    if (this.engineOn && bat && bat.charge <= 0 && false) this.engineOn = false;
  }

  _updateRemote(dt) {
    const t = this.target;
    if (!t) return;
    const k = 1 - Math.exp(-14 * dt);
    this.pos.lerp(_v1.set(t.p[0], t.p[1], t.p[2]), k);
    this.quat.slerp(_q.set(t.q[0], t.q[1], t.q[2], t.q[3]), k);
    this.vel.set(t.v[0], t.v[1], t.v[2]);
    this.steer += (t.steer - this.steer) * k;
    this.rpm += (t.rpm - this.rpm) * k;
    this.speed = t.speed;
    this.engineOn = !!t.eng;
    this.lightsOn = !!t.lights;
    for (let i = 0; i < 4; i++) this.wheelSpin[i] += (this.speed / PHYS.wheelRadius) * dt;
  }

  snapshot() {
    return {
      p: [this.pos.x, this.pos.y, this.pos.z],
      q: [this.quat.x, this.quat.y, this.quat.z, this.quat.w],
      v: [this.vel.x, this.vel.y, this.vel.z],
      steer: this.steer,
      rpm: this.rpm,
      speed: this.speed,
      eng: this.engineOn,
      lights: this.lightsOn,
    };
  }

  // ------------------------------------------------------------- Visualisierung
  _syncVisual() {
    this.group.position.copy(this.pos);
    this.group.quaternion.copy(this.quat);
    this.group.updateMatrixWorld(true);
    const m = this.mesh;
    for (let i = 0; i < 4; i++) {
      const W = WHEELS[i];
      const w = m.wheels[W.id];
      if (!w.pivot.visible) continue;
      w.pivot.position.y = W.pos[1] - this.suspLen[i];
      w.spin.rotation.x = this.wheelSpin[i];
      w.pivot.rotation.y = W.front ? this.steer : 0;
    }
    m.steer.rotation.z = -this.steer * 2.2;
    const lamp = this.lightsOn;
    m.hlMat.color.setHex(lamp ? 0xfff2c0 : 0x555a5e);
    m.tlMat.color.setHex(lamp ? 0xc02020 : this.input.brake > 0.1 && !this.reverse ? 0xff3030 : 0x501010);
    // dynamische Collider
    const yaw = this.yawNow();
    const sin = Math.sin(yaw);
    const cos = Math.cos(yaw);
    for (const c of [this.colHull, this.colBed]) {
      c.x = this.pos.x + sin * c.oz;
      c.z = this.pos.z + cos * c.oz;
      c.ry = yaw;
      c.y0 = this.pos.y - 0.85;
      c.y1 = c === this.colBed ? this.pos.y + 0.48 : this.pos.y + 1.1;
      c.bb = null;
    }
  }

  placeAt(x, z, ry = 0) {
    const gy = this.world.groundAt(x, z, 0.6, 0.6, true);
    this.pos.set(x, gy + REST_Y, z);
    this.quat.setFromAxisAngle(_v1.set(0, 1, 0), ry);
    this.vel.set(0, 0, 0);
    this.ang.set(0, 0, 0);
    this.sleeping = true;
    this._syncVisual();
  }

  seatWorld(seat, out) {
    const s = SEATS[seat];
    return this.localToWorld(_v2.set(...s.pos), out);
  }

  eyeWorld(seat, out) {
    const s = SEATS[seat];
    return this.localToWorld(_v2.set(...s.eye), out);
  }

  /** Einstiegsposition außerhalb neben der Tür */
  exitPos(seat, out) {
    const side = seat === 'driver' ? 2.0 : -2.0;
    this.localToWorld(_v2.set(side, -0.8, 0.4), out);
    out.y = this.world.groundAt(out.x, out.z, out.y + 1.5, 1.0, true);
    return out;
  }

  setGhost(slotId, show, ok = true) {
    for (const id of SLOT_IDS) {
      const g = this.mesh.ghosts[id];
      g.visible = show === id && !this.installed[id];
      if (g.visible) g.material = ok ? this.mesh.ghostMat : this.mesh.ghostMatBad;
    }
  }

  // ------------------------------------------------------------- Speichern
  toJSON() {
    return {
      installed: this.installed,
      fuel: this.fuel,
      temp: this.temp,
      hull: this.hull,
      odometer: this.odometer,
      lightsOn: this.lightsOn,
      pos: this.pos.toArray(),
      quat: this.quat.toArray(),
    };
  }

  load(o) {
    this.installed = o.installed || {};
    this.fuel = o.fuel ?? 0;
    this.temp = o.temp ?? 20;
    this.hull = o.hull ?? 100;
    this.odometer = o.odometer ?? 0;
    this.lightsOn = !!o.lightsOn;
    this.pos.fromArray(o.pos);
    this.quat.fromArray(o.quat);
    this.vel.set(0, 0, 0);
    this.ang.set(0, 0, 0);
    this.engineOn = false;
    this.sleeping = true;
    this.refreshParts();
    this._syncVisual();
  }

  dispose() {
    this.scene.remove(this.group);
    const i1 = this.world.dynamic.indexOf(this.colHull);
    if (i1 >= 0) this.world.dynamic.splice(i1, 1);
    const i2 = this.world.dynamic.indexOf(this.colBed);
    if (i2 >= 0) this.world.dynamic.splice(i2, 1);
  }
}
