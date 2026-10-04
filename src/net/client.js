// WebSocket-Client für den Mehrspieler: Lobby, Zustandsabgleich, Zombie-Snapshots
import * as THREE from 'three';
import { RemotePlayer } from './remotePlayers.js';

export class NetClient {
  constructor(url, name) {
    this.url = url;
    this.name = name;
    this.ws = null;
    this.id = null;
    this.code = null;
    this.remotes = new Map();
    this.zombies = new Map();
    this.zombieTarget = new Map();
    this.pending = null;
    this.onMessage = null;
    this.bytesIn = 0;
    this.bytesOut = 0;
    this.pingMs = 0;
    this._rate = { t: 0, in: 0, out: 0, kbIn: 0, kbOut: 0 };
    this.colorIdx = 0;
    this.queue = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      let ws;
      try {
        ws = new WebSocket(this.url);
      } catch (e) {
        return reject(new Error('Ungültige Server-URL'));
      }
      this.ws = ws;
      const timer = setTimeout(() => {
        reject(new Error('Zeitüberschreitung beim Verbinden'));
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }, 6000);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Server nicht erreichbar'));
      };
      ws.onmessage = (ev) => {
        this.bytesIn += ev.data.length;
        this.counts = this.counts || {};
        this._rate.in += ev.data.length;
        let m;
        try {
          m = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (this.pending && (m.t === 'joined' || m.t === 'error')) {
          const p = this.pending;
          this.pending = null;
          if (m.t === 'error') p.reject(new Error(m.msg));
          else {
            this.id = m.id;
            this.code = m.code;
            p.resolve(m);
          }
          return;
        }
        this.counts[m.t] = (this.counts[m.t] || 0) + 1;
        this.handle(m);
      };
      ws.onclose = () => {
        this.closed = true;
        this.onClose?.();
      };
    });
  }

  enter(mode, opts) {
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
      this.send(mode === 'create' ? { t: 'create', name: this.name, seed: opts.seed } : { t: 'join', name: this.name, code: opts.code });
      setTimeout(() => {
        if (this.pending) {
          this.pending = null;
          reject(new Error('Keine Antwort vom Server'));
        }
      }, 6000);
    });
  }

  send(m) {
    if (!this.ws || this.ws.readyState !== 1) return;
    const s = JSON.stringify(m);
    this.bytesOut += s.length;
    this._rate.out += s.length;
    this.ws.send(s);
  }

  disconnect() {
    try {
      this.ws?.close();
    } catch {
      /* ignore */
    }
  }

  handle(m) {
    switch (m.t) {
      case 'players': {
        for (const p of m.list) {
          if (p.id === this.id) continue;
          const r = this.remotes.get(p.id);
          if (!r) continue;
          r.target.set(p.pos[0], p.pos[1], p.pos[2]);
          r.tYaw = p.yaw;
          r.pitch = p.pitch || 0;
          r.a = p.a || {};
          r.setHeld(r.a.held);
        }
        return;
      }
      case 'zombies': {
        const seen = new Set();
        for (const z of m.z) {
          const [id, x, y, zz, yaw, state, hp, type, anim, windup, fx, fz] = z;
          seen.add(id);
          let o = this.zombies.get(id);
          if (!o) {
            o = { id, x, y, z: zz, yaw, state, hp: 1, maxHp: 1, type, anim, windup: 0, vx: 0, vz: 0, deadT: 0, fallDirX: 0, fallDirZ: 0 };
            this.zombies.set(id, o);
          }
          o.vx = (x - o.x) * 10;
          o.vz = (zz - o.z) * 10;
          o.x = x;
          o.y = y;
          o.z = zz;
          o.yaw = yaw;
          o.state = state;
          o.hp = hp / 100;
          o.type = type;
          o.anim = anim;
          o.windup = windup ? 0.2 : 0;
          o.fallDirX = fx;
          o.fallDirZ = fz;
          o.deadT = state === 4 ? (o.deadT || 0.01) : 0;
        }
        for (const id of this.zombies.keys()) if (!seen.has(id)) this.zombies.delete(id);
        return;
      }
      case 'pjoin':
        this.addRemote(m.id, m.name);
        break;
      case 'pleave': {
        const r = this.remotes.get(m.id);
        if (r) {
          r.dispose();
          this.remotes.delete(m.id);
        }
        break;
      }
      default:
    }
    if (this.onMessage) this.onMessage(m);
    else this.queue.push(m);
  }

  flush() {
    const q = this.queue;
    this.queue = [];
    for (const m of q) this.onMessage?.(m);
  }

  addRemote(id, name) {
    if (id === this.id || this.remotes.has(id)) return this.remotes.get(id);
    const r = new RemotePlayer(id, name, this.colorIdx++);
    this.remotes.set(id, r);
    this.scene?.add(r.group);
    return r;
  }

  zombieList() {
    // Zombies mit hp-Anteil: hp/maxHp = hp (0..1)
    return this.zombies.values();
  }

  update(dt, car) {
    for (const z of this.zombies.values()) if (z.deadT > 0) z.deadT += dt;
    for (const r of this.remotes.values()) r.update(dt, car);
    const R = this._rate;
    R.t += dt;
    if (R.t >= 1) {
      R.kbIn = R.in / 1024;
      R.kbOut = R.out / 1024;
      R.in = R.out = R.t = 0;
    }
  }

  stats() {
    return `↓${this._rate.kbIn.toFixed(1)} kB/s ↑${this._rate.kbOut.toFixed(1)} kB/s · ${this.remotes.size + 1} Spieler · ${this.zombies.size} Zombies · Code ${this.code}`;
  }

  setScene(scene) {
    this.scene = scene;
    for (const r of this.remotes.values()) scene.add(r.group);
  }
}
