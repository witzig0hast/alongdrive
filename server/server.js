// Dead Desert – Mehrspieler-Server (Node.js + ws)
// - Lobbys mit Seed + Beitrittscode
// - Server-autoritative Zombies (nutzt dieselbe Simulation und Weltgenerierung wie der Client)
// - Relais für Spielerpositionen, Fahrzeug, Gegenstände, Lagerfeuer, Zapfsäulen, Chat
// - liefert zusätzlich den gebauten Client (dist/) aus, wenn vorhanden
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Terrain, CHUNK } from '../src/world/heightfield.js';
import { genChunk, chunkKey } from '../src/world/worldgen.js';
import { colliderBounds } from '../src/world/collision.js';
import { ZombieSim } from '../src/ai/zombieSim.js';
import { stormIntensity, ambientTemp, hourOf } from '../src/world/weather.js';
import { smooth } from '../src/core/rng.js';
import { sunElevation } from '../src/world/weather.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, '..', 'dist');
const PORT = +(process.env.PORT || 8080);
const TICK = 1 / 20;
const MAX_PLAYERS = +(process.env.MAX_PLAYERS || 8);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon', '.map': 'application/json',
};

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, rooms: rooms.size }));
  }
  let url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/') url = '/index.html';
  const file = path.normalize(path.join(DIST, url));
  if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (!fs.existsSync(DIST)) {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Dead Desert Server läuft. Client nicht gebaut (npm run build) – verbinde per WebSocket.');
    }
    res.writeHead(404);
    return res.end('Not found');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
});

const wss = new WebSocketServer({ server, maxPayload: 256 * 1024 });
const rooms = new Map();
let nextPlayerId = 1;

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += chars[(Math.random() * chars.length) | 0];
    if (!rooms.has(c)) return c;
  }
}

class Room {
  constructor(code, seed) {
    this.code = code;
    this.seed = String(seed).slice(0, 40);
    this.players = new Map();
    this.t0 = Date.now();
    this.terrain = new Terrain(this.seed);
    this.chunks = new Map();
    this.taken = new Set();
    this.dynamic = new Map(); // uid -> item
    this.pumps = {};
    this.fires = [];
    this.car = null; // letzter bekannter Fahrzeugzustand
    this.carDriver = null;
    this.carPassenger = null;
    this.zsim = new ZombieSim({
      terrain: this.terrain,
      queryColliders: (x, z, r, cb) => this.queryColliders(x, z, r, cb),
      spawnPoints: (x, z, r) => this.spawnPoints(x, z, r),
    });
    this.emptySince = null;
    this.snapTimer = 0;
    this.zTimer = 0;
    this.timeTimer = 0;
  }

  get time() {
    return (Date.now() - this.t0) / 1000;
  }

  chunk(cx, cz) {
    const k = chunkKey(cx, cz);
    let c = this.chunks.get(k);
    if (!c) {
      c = genChunk(this.terrain, this.terrain.seed, cx, cz);
      for (const col of c.colliders) col.bb = colliderBounds(col);
      c.used = Date.now();
      this.chunks.set(k, c);
      if (this.chunks.size > 400) this.pruneChunks();
    }
    c.used = Date.now();
    return c;
  }

  pruneChunks() {
    const arr = [...this.chunks.entries()].sort((a, b) => a[1].used - b[1].used);
    for (let i = 0; i < 120; i++) this.chunks.delete(arr[i][0]);
  }

  queryColliders(x, z, r, cb) {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ch = this.chunk(cx + dx, cz + dz);
        for (const c of ch.colliders) {
          const bb = c.bb;
          if (x + r < bb[0] || x - r > bb[2] || z + r < bb[1] || z - r > bb[3]) continue;
          cb(c);
        }
      }
    }
    // Auto als Hindernis
    if (this.car && this.car.p) {
      const [px, py, pz] = this.car.p;
      const yaw = this.car.q ? quatYaw(this.car.q) : 0;
      const sin = Math.sin(yaw);
      const cos = Math.cos(yaw);
      cb({ t: 'obb', x: px + sin * 0.6, z: pz + cos * 0.6, hx: 1.0, hz: 2.7, ry: yaw, y0: py - 0.85, y1: py + 1.1, car: true, bb: [px - 4, pz - 4, px + 4, pz + 4] });
    }
  }

  spawnPoints(x, z, r) {
    const out = [];
    const c0 = Math.floor((x - r) / CHUNK);
    const c1 = Math.floor((x + r) / CHUNK);
    const d0 = Math.floor((z - r) / CHUNK);
    const d1 = Math.floor((z + r) / CHUNK);
    for (let cz = d0; cz <= d1; cz++) for (let cx = c0; cx <= c1; cx++) for (const s of this.chunk(cx, cz).zspawns) out.push(s);
    return out;
  }

  broadcast(msg, except = null) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) if (p !== except && p.ws.readyState === 1) p.ws.send(data);
  }

  snapshotFor() {
    return {
      time: this.time,
      taken: [...this.taken],
      items: [...this.dynamic.values()],
      pumps: this.pumps,
      fires: this.fires,
      car: this.car,
      carDriver: this.carDriver,
      carPassenger: this.carPassenger,
      players: [...this.players.values()].map((p) => ({ id: p.id, name: p.name, pos: p.pos, yaw: p.yaw, pitch: p.pitch, a: p.a })),
    };
  }

  tick(dt) {
    const players = [];
    for (const p of this.players.values()) {
      if (p.dead) continue;
      const inCar = !!p.a?.seat;
      const sp = Math.abs(this.car?.speed || 0);
      let noise = 4;
      if (inCar) noise = this.car?.eng ? 55 + sp * 2.2 : 3;
      else if (p.a?.sprint) noise = 24;
      else if (p.a?.crouch) noise = 2.5;
      else if (p.a?.moving) noise = 9;
      if (!inCar && this.car?.eng) noise = Math.max(noise, 50);
      players.push({
        id: p.id, x: p.pos[0], y: p.pos[1], z: p.pos[2], inCar, carSpeed: sp, sprint: !!p.a?.sprint, crouch: !!p.a?.crouch && !inCar,
        light: !!p.a?.light || (inCar && !!this.car?.lights), noise,
      });
    }
    const time = this.time;
    const hour = hourOf(time);
    const night = 1 - smooth(-0.25, 0.02, sunElevation(hour));
    const storm = stormIntensity(this.seed, time);
    this.zsim.enabled = players.length > 0;
    this.zsim.update(dt, players, { night, storm });
    // Ereignisse
    for (const e of this.zsim.drainEvents()) {
      if (e.type === 'attackPlayer') {
        const p = this.players.get(e.pid);
        if (p) this.send(p, { t: 'hurt', dmg: e.dmg, cause: 'Zombie-Angriff' });
      } else if (e.type === 'attackCar') this.broadcast({ t: 'carhit', dmg: e.dmg });
      else if (e.type === 'groan' || e.type === 'died' || e.type === 'swing') this.broadcast({ t: 'zev', e });
    }
    this.snapTimer += dt;
    if (this.snapTimer >= 0.066) {
      this.snapTimer = 0;
      const list = [];
      for (const p of this.players.values()) list.push({ id: p.id, pos: p.pos, yaw: p.yaw, pitch: p.pitch, a: p.a });
      this.broadcast({ t: 'players', list });
    }
    this.zTimer += dt;
    if (this.zTimer >= 0.1) {
      this.zTimer = 0;
      this.broadcast({ t: 'zombies', z: this.zsim.snapshot() });
    }
    this.timeTimer += dt;
    if (this.timeTimer >= 10) {
      this.timeTimer = 0;
      this.broadcast({ t: 'time', time: this.time });
    }
  }

  send(p, msg) {
    if (p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }
}

function quatYaw(q) {
  // Gieren um Y aus Quaternion (x,y,z,w); Vorwärts = +Z
  const fx = 2 * (q[0] * q[2] + q[3] * q[1]);
  const fz = 1 - 2 * (q[0] * q[0] + q[1] * q[1]);
  return Math.atan2(fx, fz);
}

const clean = (s, n = 16) => String(s ?? '').replace(/[<>&"]/g, '').slice(0, n) || 'Wanderer';
const num = (v, d = 0) => (Number.isFinite(v) ? v : d);
const vec = (a) => (Array.isArray(a) && a.length >= 3 ? [num(a[0]), num(a[1]), num(a[2])] : [0, 0, 0]);

wss.on('connection', (ws) => {
  const me = { ws, id: 'p' + nextPlayerId++, name: 'Wanderer', room: null, pos: [3, 0, 3], yaw: 0, pitch: 0, a: {}, dead: false, alive: true };
  ws.isAlive = true;
  ws.on('pong', () => (ws.isAlive = true));

  ws.on('message', (data) => {
    let m;
    try {
      m = JSON.parse(data.toString());
    } catch {
      return;
    }
    if (!m || typeof m.t !== 'string') return;
    const room = me.room;
    switch (m.t) {
      case 'create':
      case 'join': {
        if (room) return;
        me.name = clean(m.name);
        let r;
        if (m.t === 'create') {
          const code = makeCode();
          r = new Room(code, m.seed || 'dead-desert');
          rooms.set(code, r);
          console.log(`[room ${code}] erstellt (Seed ${r.seed}) von ${me.name}`);
        } else {
          r = rooms.get(String(m.code || '').toUpperCase());
          if (!r) return ws.send(JSON.stringify({ t: 'error', msg: 'Lobby nicht gefunden' }));
          if (r.players.size >= MAX_PLAYERS) return ws.send(JSON.stringify({ t: 'error', msg: 'Lobby ist voll' }));
        }
        me.room = r;
        me.dead = false;
        r.emptySince = null;
        ws.send(JSON.stringify({ t: 'joined', id: me.id, code: r.code, seed: r.seed, host: m.t === 'create', snapshot: r.snapshotFor() }));
        r.players.set(me.id, me);
        r.broadcast({ t: 'pjoin', id: me.id, name: me.name }, me);
        r.broadcast({ t: 'chat', sys: true, text: `${me.name} ist beigetreten` }, null);
        break;
      }
      case 'state':
        if (!room) return;
        me.pos = vec(m.p);
        me.yaw = num(m.yaw);
        me.pitch = num(m.pitch);
        me.a = m.a && typeof m.a === 'object' ? { moving: !!m.a.moving, sprint: !!m.a.sprint, crouch: !!m.a.crouch, seat: m.a.seat || null, held: m.a.held || null, light: !!m.a.light, anim: num(m.a.anim) } : {};
        break;
      case 'chat': {
        if (!room) return;
        const text = String(m.text || '').slice(0, 120);
        if (text) room.broadcast({ t: 'chat', name: me.name, text });
        break;
      }
      case 'pick': {
        if (!room) return;
        const uid = String(m.uid);
        if (room.taken.has(uid) || (!uid.startsWith('L:') && !uid.startsWith('S:') && !room.dynamic.has(uid))) return room.send(me, { t: 'pickdeny', uid });
        if (uid.startsWith('L:') || uid.startsWith('S:')) room.taken.add(uid);
        room.dynamic.delete(uid);
        room.broadcast({ t: 'pick', uid, by: me.id }, me);
        break;
      }
      case 'drop': {
        if (!room || !m.item) return;
        const it = m.item;
        const rec = { uid: String(it.uid), type: String(it.type), state: it.state || {}, x: num(it.x), y: num(it.y), z: num(it.z), yaw: num(it.yaw), vel: it.vel, car: it.car || null };
        room.dynamic.set(rec.uid, rec);
        if (rec.uid.startsWith('L:') || rec.uid.startsWith('S:')) room.taken.add(rec.uid);
        room.broadcast({ t: 'drop', item: rec, by: me.id }, me);
        break;
      }
      case 'imove': {
        if (!room) return;
        const rec = room.dynamic.get(String(m.uid));
        if (rec) {
          rec.x = num(m.x);
          rec.y = num(m.y);
          rec.z = num(m.z);
          rec.yaw = num(m.yaw);
          rec.car = m.car || null;
          rec.vel = null;
        }
        room.broadcast({ t: 'imove', uid: m.uid, x: m.x, y: m.y, z: m.z, yaw: m.yaw, car: m.car || null }, me);
        break;
      }
      case 'seat': {
        if (!room) return;
        if (m.seat === 'driver') room.carDriver = m.on ? me.id : null;
        if (m.seat === 'passenger') room.carPassenger = m.on ? me.id : null;
        room.broadcast({ t: 'seat', id: me.id, seat: m.seat, on: !!m.on }, me);
        break;
      }
      case 'car': {
        if (!room) return;
        const { t, ...snap } = m;
        room.car = { ...(room.car || {}), ...snap };
        room.broadcast({ t: 'car', ...snap }, me);
        break;
      }
      case 'carstate': {
        if (!room) return;
        room.car = { ...(room.car || {}), installed: m.installed, fuel: m.fuel, hull: m.hull, temp: m.temp, odometer: m.odometer };
        room.broadcast({ t: 'carstate', installed: m.installed, fuel: m.fuel, hull: m.hull, temp: m.temp, odometer: m.odometer }, me);
        break;
      }
      case 'carpart': {
        if (!room) return;
        room.car = room.car || {};
        room.car.installed = room.car.installed || {};
        room.car.installed[m.slot] = { type: m.type, state: m.state };
        room.broadcast({ t: 'carpart', slot: m.slot, type: m.type, state: m.state }, me);
        break;
      }
      case 'carfuel': {
        if (!room) return;
        room.car = room.car || {};
        room.car.fuel = num(m.fuel);
        room.broadcast({ t: 'carfuel', fuel: m.fuel }, me);
        break;
      }
      case 'pump':
        if (!room) return;
        room.pumps[String(m.id)] = num(m.fuel);
        room.broadcast({ t: 'pump', id: m.id, fuel: m.fuel }, me);
        break;
      case 'fire':
        if (!room) return;
        room.fires.push({ x: num(m.x), y: num(m.y), z: num(m.z), t: room.time + 240 });
        room.fires = room.fires.filter((f) => f.t > room.time);
        room.broadcast({ t: 'fire', x: m.x, y: m.y, z: m.z }, me);
        room.zsim.noise(num(m.x), num(m.z), 30);
        break;
      case 'zhit':
        if (!room) return;
        room.zsim.damage(+m.id, Math.min(400, num(m.dmg)), !!m.head, num(m.dx), num(m.dz), me.id);
        break;
      case 'noise':
        if (!room) return;
        room.zsim.noise(num(m.x), num(m.z), Math.min(160, num(m.r)));
        break;
      case 'fx':
        if (!room) return;
        room.broadcast({ ...m, id: me.id }, me);
        break;
      case 'dead':
        if (!room) return;
        me.dead = true;
        room.broadcast({ t: 'chat', sys: true, text: `${me.name} ist gestorben` });
        room.broadcast({ t: 'pdead', id: me.id }, me);
        break;
      default:
    }
  });

  ws.on('close', () => {
    const room = me.room;
    if (!room) return;
    room.players.delete(me.id);
    if (room.carDriver === me.id) {
      room.carDriver = null;
      room.broadcast({ t: 'seat', id: me.id, seat: 'driver', on: false });
    }
    if (room.carPassenger === me.id) {
      room.carPassenger = null;
      room.broadcast({ t: 'seat', id: me.id, seat: 'passenger', on: false });
    }
    room.broadcast({ t: 'pleave', id: me.id });
    room.broadcast({ t: 'chat', sys: true, text: `${me.name} hat das Spiel verlassen` });
    if (room.players.size === 0) room.emptySince = Date.now();
  });
  ws.on('error', () => {});
});

// Spielschleife
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  for (const [code, room] of rooms) {
    if (room.players.size === 0) {
      if (room.emptySince && now - room.emptySince > 5 * 60 * 1000) {
        rooms.delete(code);
        console.log(`[room ${code}] geschlossen`);
      }
      continue;
    }
    try {
      room.tick(dt);
    } catch (e) {
      console.error(`[room ${code}] Tick-Fehler`, e);
    }
  }
}, TICK * 1000);

// Verbindungsprüfung
setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 20000);

server.listen(PORT, () => console.log(`Dead Desert Server auf Port ${PORT} (http://localhost:${PORT})`));
