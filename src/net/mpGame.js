// Mehrspieler-Anbindung des Spiels (Mixin auf Game): Zustandsabgleich, Gegenstände, Auto, Chat
import * as THREE from 'three';
import { ITEM_DEFS } from '../items/defs.js';

const _v = new THREE.Vector3();

export const NetMixin = {
  /** Vor dem Laden der Chunks: bereits genommenes Loot übernehmen */
  preApplyMp(snap) {
    this.items.taken = new Set(snap.taken || []);
  },

  /** Nach Weltaufbau: dynamische Gegenstände, Auto, Pumpen, Feuer */
  applyMpSnapshot(snap) {
    const p = this.player;
    this.time = snap.time || 0;
    p.pos.set(2.5 + Math.random() * 2.5, 0.05, 3 + Math.random() * 1.5);
    p.yaw = 0.7;
    this.savedPumps = snap.pumps || {};
    for (const [id, f] of Object.entries(this.savedPumps)) {
      const pu = this.pumps.get(id);
      if (pu) pu.fuel = f;
    }
    // Auto
    const c = snap.car;
    this.car.placeAt(0, -0.6, 0);
    if (c) {
      if (c.installed) this.car.installed = c.installed;
      if (c.fuel != null) this.car.fuel = c.fuel;
      if (c.hull != null) this.car.hull = c.hull;
      if (c.temp != null) this.car.temp = c.temp;
      if (c.odometer != null) this.car.odometer = c.odometer;
      if (c.p) {
        this.car.pos.fromArray(c.p);
        this.car.quat.fromArray(c.q);
      }
      this.car.refreshParts();
    }
    this.car.sleeping = true;
    if (snap.carDriver) {
      this.car.driver = 'remote';
      this.car.remote = true;
    }
    if (snap.carPassenger) this.car.passenger = 'remote';
    for (const it of snap.items || []) this.netCreateItem(it);
    for (const f of snap.fires || []) this.addCampfire(f.x, f.y, f.z, Math.max(10, f.t - snap.time));
    this.world.update(p.pos.x, p.pos.z, 6);
  },

  netCreateItem(it) {
    const items = this.items;
    const old = items.items.get(it.uid);
    if (old) items.take(old, true);
    items.taken.delete(it.uid);
    const e = items.create(it.uid, it.type, it.state, new THREE.Vector3(it.car ? 0 : it.x, it.car ? 0 : it.y, it.car ? 0 : it.z), {
      yaw: it.yaw,
      vel: it.vel ? new THREE.Vector3(it.vel.x ?? it.vel[0], it.vel.y ?? it.vel[1], it.vel.z ?? it.vel[2]) : null,
      asleep: !it.vel,
    });
    if (it.car) {
      items.muted = true;
      items._attach(e, new THREE.Vector3(it.x, it.y, it.z));
      items.muted = false;
    }
    return e;
  },

  itemRecord(e) {
    const r = { uid: e.uid, type: e.type, state: e.state, yaw: e.yaw };
    if (e.mode === 'car') {
      r.x = e.local.x;
      r.y = e.local.y;
      r.z = e.local.z;
      r.car = true;
      r.yaw = e.yaw - this.car.yawNow();
    } else {
      r.x = e.pos.x;
      r.y = e.pos.y;
      r.z = e.pos.z;
      r.vel = { x: e.vel.x, y: e.vel.y, z: e.vel.z };
    }
    return r;
  },

  attachNet(net, info) {
    this.net = net;
    net.setScene(this.scene);
    net.game = this;
    this.zsim.enabled = false;
    this.zsim.zombies.clear();
    for (const p of info.snapshot.players || []) {
      const r = net.addRemote(p.id, p.name);
      if (r && p.pos) {
        r.target.set(...p.pos);
        r.tYaw = p.yaw;
        r.a = p.a || {};
      }
    }
    const items = this.items;
    items.netMode = true;
    items.listeners.pick = (e) => net.send({ t: 'pick', uid: e.uid });
    items.listeners.drop = (e) => {
      if (items.muted) return;
      e.owner = true;
      net.send({ t: 'drop', item: this.itemRecord(e) });
    };
    items.listeners.settle = (e) => {
      if (items.muted || !e.owner) return;
      e.owner = false;
      const r = this.itemRecord(e);
      net.send({ t: 'imove', uid: e.uid, x: r.x, y: r.y, z: r.z, yaw: r.yaw, car: r.car ? { x: r.x, y: r.y, z: r.z } : null });
    };
    net.onMessage = (m) => this.onNetMessage(m);
    net.flush();
    net.onClose = () => {
      if (this.running) this.hud.toast('Verbindung zum Server verloren');
    };
    this.netSend = { state: 0, car: 0, carstate: 0 };
    this.hud.addChat('', `Lobby ${info.code} – Seed ${info.seed}`, true);
  },

  netTick(dt) {
    const net = this.net;
    if (!net || !this.running) return;
    const p = this.player;
    const S = this.netSend;
    S.state -= dt;
    if (S.state <= 0) {
      S.state = 0.066;
      const held = this.inv.held();
      net.send({
        t: 'state',
        p: p.seat ? [this.car.pos.x, this.car.pos.y, this.car.pos.z] : [p.pos.x, p.pos.y, p.pos.z],
        yaw: p.seat ? this.car.yawNow() : p.yaw,
        pitch: p.pitch,
        a: { moving: p.moving && p.onGround, sprint: p.sprinting, crouch: p.crouch, seat: p.seat, held: held ? held.type : null, light: this.flashlightOn(), anim: 0 },
      });
    }
    if (p.seat === 'driver') {
      S.car -= dt;
      if (S.car <= 0) {
        S.car = 0.066;
        net.send({ t: 'car', ...this.car.snapshot() });
      }
    }
    S.carstate -= dt;
    if (S.carstate <= 0 && (p.seat === 'driver' || this.fuelDirty)) {
      S.carstate = 1;
      this.fuelDirty = false;
      const c = this.car;
      net.send({ t: 'carstate', installed: c.installed, fuel: c.fuel, hull: c.hull, temp: c.temp, odometer: c.odometer });
    }
    net.update(dt, this.car);
    if (this.car.remote && this.car.driver !== 'remote') this.car.remote = false;
  },

  onNetMessage(m) {
    const car = this.car;
    switch (m.t) {
      case 'chat':
        this.hud.addChat(m.name, m.text, !!m.sys);
        if (!m.sys) this.audio.play('chat');
        break;
      case 'time':
        if (Math.abs(this.time - m.time) > 1.5) this.time = m.time;
        break;
      case 'hurt':
        this.playerDamage(m.dmg, m.cause || 'Zombie-Angriff');
        this.camShake = 0.3;
        break;
      case 'zev':
        this.handleZombieEvent(m.e);
        break;
      case 'carhit':
        if (!car.remote) {
          car.damage(m.dmg);
          this.audio.play('thud', { pos: car.pos });
        }
        break;
      case 'pick': {
        const e = this.items.items.get(m.uid);
        this.items.muted = true;
        if (e) this.items.take(e, true);
        else this.items.taken.add(m.uid);
        this.items.muted = false;
        break;
      }
      case 'pickdeny': {
        const it = this.inv.all().find((i) => i.uid === m.uid);
        if (it) {
          this.inv.remove(it);
          this.afterInventoryChange();
          this.hud.toast('Jemand war schneller – Gegenstand weg');
        }
        break;
      }
      case 'drop':
        this.netCreateItem(m.item);
        break;
      case 'imove': {
        const e = this.items.items.get(m.uid);
        if (!e) break;
        this.items.muted = true;
        if (m.car) {
          if (e.mode !== 'car') {
            e.mesh.removeFromParent();
            this.items._attach(e, new THREE.Vector3(m.car.x, m.car.y, m.car.z));
          } else e.local.set(m.car.x, m.car.y, m.car.z);
        } else {
          if (e.mode === 'car') this.items._detach(e);
          e.pos.set(m.x, m.y, m.z);
          e.yaw = m.yaw;
          e.vel.set(0, 0, 0);
          e.asleep = true;
          this.items._sync(e);
        }
        this.items.muted = false;
        break;
      }
      case 'seat': {
        if (m.seat === 'driver') {
          if (m.on) {
            car.driver = 'remote';
            car.remote = true;
          } else {
            if (car.target) {
              car.pos.fromArray(car.target.p);
              car.quat.fromArray(car.target.q);
              car.vel.set(0, 0, 0);
              car.ang.set(0, 0, 0);
            }
            if (car.driver === 'remote') car.driver = null;
            car.remote = false;
            car.sleeping = true;
            car.target = null;
          }
        } else if (car.passenger !== 'local') car.passenger = m.on ? 'remote' : null;
        break;
      }
      case 'car':
        if (car.driver !== 'local') {
          car.remote = true;
          car.driver = 'remote';
          car.target = m;
        }
        break;
      case 'carstate':
        if (car.driver !== 'local') {
          car.installed = m.installed || car.installed;
          car.fuel = m.fuel;
          car.hull = m.hull;
          car.temp = m.temp;
          car.odometer = m.odometer;
          car.refreshParts();
        }
        break;
      case 'carpart':
        car.installed[m.slot] = { type: m.type, state: m.state };
        car.refreshParts();
        this.audio.play('install', { pos: car.pos });
        break;
      case 'carfuel':
        car.fuel = m.fuel;
        break;
      case 'pump': {
        const pu = this.pumps.get(m.id);
        if (pu) pu.fuel = m.fuel;
        else this.savedPumps = { ...(this.savedPumps || {}), [m.id]: m.fuel };
        break;
      }
      case 'fire':
        this.addCampfire(m.x, m.y, m.z, 240);
        break;
      case 'fx':
        if (m.k === 'shot') this.audio.play(m.w === 'shotgun' ? 'shotgun' : 'pistol', { pos: { x: m.x, y: 1.5, z: m.z } });
        break;
      case 'pdead': {
        const r = this.net.remotes.get(m.id);
        if (r) r.dead = true;
        break;
      }
      case 'pjoin':
        this.audio.play('beep');
        break;
      default:
    }
  },
};
