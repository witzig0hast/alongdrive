// Zombie-KI-Simulation (rein, ohne Three.js): wandern, hören/sehen, verfolgen, angreifen.
// Läuft im Einzelspieler lokal und im Mehrspieler server-autoritativ.
import { circleVs } from '../world/collision.js';
import { clamp, smooth } from '../core/rng.js';

export const ZS = { WANDER: 0, INVESTIGATE: 1, CHASE: 2, ATTACK: 3, DEAD: 4 };
const MAX_ZOMBIES = 30;

export class ZombieSim {
  /**
   * world: {terrain, queryColliders(x,z,r,cb), spawnPoints(x,z,r) -> [{x,z,kind}]}
   */
  constructor(world) {
    this.world = world;
    this.zombies = new Map();
    this.nextId = 1;
    this.spawnTimer = 2;
    this.cool = new Map(); // Spawn-Cooldowns
    this.occupied = new Map(); // spawnKey -> id
    this.events = [];
    this.kills = 0;
    this.enabled = true;
  }

  emit(type, data) {
    this.events.push({ type, ...data });
  }

  spawn(x, z, kind = 'ruin', key = null) {
    const runner = Math.random() < 0.16;
    const big = !runner && Math.random() < 0.12;
    const z0 = {
      id: this.nextId++,
      x, z,
      y: this.world.terrain.heightAt(x, z),
      yaw: Math.random() * Math.PI * 2,
      vx: 0, vz: 0,
      state: ZS.WANDER,
      hp: big ? 140 : runner ? 55 : 80,
      maxHp: big ? 140 : runner ? 55 : 80,
      speed: runner ? 4.6 : big ? 2.6 : 2.9 + Math.random() * 0.8,
      type: runner ? 1 : big ? 2 : 0, // 0 normal, 1 Läufer, 2 Brocken
      tx: x, tz: z,
      wanderT: Math.random() * 4,
      target: null,
      lostT: 0,
      attackCd: 0,
      windup: 0,
      stagger: 0,
      deadT: 0,
      key,
      groanT: 3 + Math.random() * 6,
      anim: Math.random() * 6,
      kind,
      hurtDirX: 0, hurtDirZ: 0,
      sawTime: 0,
    };
    this.zombies.set(z0.id, z0);
    if (key) this.occupied.set(key, z0.id);
    return z0;
  }

  noise(x, z, loud, key = 'noise') {
    for (const zb of this.zombies.values()) {
      if (zb.state === ZS.DEAD || zb.state === ZS.CHASE || zb.state === ZS.ATTACK) continue;
      const d = Math.hypot(zb.x - x, zb.z - z);
      if (d < loud) {
        zb.state = ZS.INVESTIGATE;
        zb.tx = x + (Math.random() - 0.5) * 4;
        zb.tz = z + (Math.random() - 0.5) * 4;
        zb.lostT = 0;
      }
    }
  }

  damage(id, amount, head = false, dirx = 0, dirz = 0, by = null) {
    const zb = this.zombies.get(id);
    if (!zb || zb.state === ZS.DEAD) return false;
    zb.hp -= head ? amount * 2 : amount;
    zb.stagger = 0.4;
    zb.hurtDirX = dirx;
    zb.hurtDirZ = dirz;
    zb.vx += dirx * 3.5;
    zb.vz += dirz * 3.5;
    if (zb.state !== ZS.CHASE && zb.state !== ZS.ATTACK && by) {
      zb.state = ZS.CHASE;
      zb.target = by;
    }
    if (zb.hp <= 0) {
      zb.state = ZS.DEAD;
      zb.deadT = 0;
      zb.fallDirX = dirx;
      zb.fallDirZ = dirz;
      if (zb.key) this.occupied.delete(zb.key);
      if (zb.key) this.cool.set(zb.key, performance_now() + 120000 + Math.random() * 120000);
      this.kills++;
      this.emit('died', { id, by });
      return true;
    }
    this.emit('hurt', { id });
    return false;
  }

  /**
   * players: [{id, x, y, z, inCar, carSpeed, sprint, crouch, light, noise}]
   * ctx: {night(0..1), storm(0..1), time}
   */
  update(dt, players, ctx) {
    if (!this.enabled) return;
    this.population(dt, players, ctx);
    const T = this.world.terrain;
    const zs = [...this.zombies.values()];
    for (const zb of zs) {
      zb.anim += dt * (zb.state === ZS.CHASE ? 1.7 : 1) * (0.7 + zb.speed * 0.3);
      if (zb.state === ZS.DEAD) {
        zb.deadT += dt;
        if (zb.deadT > 30) this.zombies.delete(zb.id);
        continue;
      }
      zb.stagger = Math.max(0, zb.stagger - dt);
      zb.attackCd = Math.max(0, zb.attackCd - dt);
      // Nächster Spieler
      let near = null;
      let nd = 1e9;
      for (const p of players) {
        const d = Math.hypot(p.x - zb.x, p.z - zb.z);
        if (d < nd) {
          nd = d;
          near = p;
        }
      }
      // Despawn
      if (!near || nd > 170) {
        if (zb.state !== ZS.CHASE) {
          this.remove(zb);
          continue;
        }
      }
      // Wahrnehmung
      if (near && zb.state !== ZS.CHASE && zb.state !== ZS.ATTACK) {
        const stormMul = 1 - (ctx.storm || 0) * 0.55;
        let sight = (ctx.night > 0.5 ? 16 : 30) * stormMul * (near.crouch ? 0.6 : 1);
        if (near.light) sight = Math.max(sight, 48 * stormMul);
        let hear = near.noise || 0;
        if (nd < sight) {
          zb.state = ZS.CHASE;
          zb.target = near.id;
          zb.lostT = 0;
          this.emit('aggro', { id: zb.id });
        } else if (nd < hear) {
          zb.state = ZS.INVESTIGATE;
          zb.tx = near.x;
          zb.tz = near.z;
          zb.lostT = 0;
        }
      }
      let tp = null;
      if (zb.target != null) tp = players.find((p) => p.id === zb.target) || null;
      let wantX = 0;
      let wantZ = 0;
      let speed = 0;
      switch (zb.state) {
        case ZS.WANDER: {
          zb.wanderT -= dt;
          if (zb.wanderT <= 0) {
            zb.wanderT = 3 + Math.random() * 6;
            if (Math.random() < 0.6) {
              const a = Math.random() * Math.PI * 2;
              const r = 4 + Math.random() * 10;
              zb.tx = zb.x + Math.cos(a) * r;
              zb.tz = zb.z + Math.sin(a) * r;
            } else {
              zb.tx = zb.x;
              zb.tz = zb.z;
            }
          }
          const d = Math.hypot(zb.tx - zb.x, zb.tz - zb.z);
          if (d > 1) {
            wantX = (zb.tx - zb.x) / d;
            wantZ = (zb.tz - zb.z) / d;
            speed = zb.speed * 0.32;
          }
          break;
        }
        case ZS.INVESTIGATE: {
          const d = Math.hypot(zb.tx - zb.x, zb.tz - zb.z);
          if (d > 1.5) {
            wantX = (zb.tx - zb.x) / d;
            wantZ = (zb.tz - zb.z) / d;
            speed = zb.speed * 0.8;
          } else {
            zb.lostT += dt;
            if (zb.lostT > 5) {
              zb.state = ZS.WANDER;
              zb.wanderT = 1;
            }
          }
          break;
        }
        case ZS.CHASE:
        case ZS.ATTACK: {
          if (!tp) {
            zb.state = ZS.WANDER;
            zb.target = null;
            break;
          }
          const dx = tp.x - zb.x;
          const dz = tp.z - zb.z;
          const d = Math.hypot(dx, dz);
          const reach = tp.inCar ? 2.6 : 1.45;
          if (d > 70) {
            zb.state = ZS.INVESTIGATE;
            zb.tx = tp.x;
            zb.tz = tp.z;
            zb.target = null;
            break;
          }
          if (d > reach) {
            if (zb.state === ZS.ATTACK && zb.windup <= 0) zb.state = ZS.CHASE;
            wantX = dx / d;
            wantZ = dz / d;
            speed = zb.stagger > 0 ? 0 : zb.speed * (tp.inCar && tp.carSpeed > 6 ? 1 : 1);
            zb.yaw = Math.atan2(dx, dz);
          } else {
            zb.state = ZS.ATTACK;
            zb.yaw = Math.atan2(dx, dz);
            if (zb.windup > 0) {
              zb.windup -= dt;
              if (zb.windup <= 0) {
                if (tp.inCar) {
                  if ((tp.carSpeed || 0) < 8) this.emit('attackCar', { dmg: 2.5 + Math.random() * 2 });
                } else {
                  this.emit('attackPlayer', { pid: tp.id, dmg: zb.type === 2 ? 17 : zb.type === 1 ? 7 : 11 });
                }
                zb.attackCd = 1.0;
              }
            } else if (zb.attackCd <= 0) {
              zb.windup = 0.45;
              this.emit('swing', { id: zb.id });
            }
          }
          break;
        }
      }
      // Beschleunigung & Bewegung
      if (zb.stagger <= 0 || zb.state === ZS.DEAD) {
        zb.vx += (wantX * speed - zb.vx) * Math.min(1, dt * 6);
        zb.vz += (wantZ * speed - zb.vz) * Math.min(1, dt * 6);
      } else {
        zb.vx *= Math.exp(-5 * dt);
        zb.vz *= Math.exp(-5 * dt);
      }
      if (speed > 0.2 && zb.state !== ZS.ATTACK) zb.yaw = Math.atan2(zb.vx, zb.vz);
      // Trennung von anderen Zombies
      for (const o of zs) {
        if (o === zb || o.state === ZS.DEAD) continue;
        const ox = zb.x - o.x;
        const oz = zb.z - o.z;
        const od = ox * ox + oz * oz;
        if (od < 0.64 && od > 1e-4) {
          const k = (0.8 - Math.sqrt(od)) * 2;
          zb.vx += (ox / Math.sqrt(od)) * k * dt * 10;
          zb.vz += (oz / Math.sqrt(od)) * k * dt * 10;
        }
      }
      const px = zb.x;
      const pz = zb.z;
      zb.x += zb.vx * dt;
      zb.z += zb.vz * dt;
      const gy = T.heightAt(zb.x, zb.z);
      // zu steil -> zurück
      if (gy - zb.y > 0.9) {
        zb.x = px;
        zb.z = pz;
      } else zb.y += (gy - zb.y) * Math.min(1, dt * 12);
      // Collider
      const p = { x: zb.x, z: zb.z };
      this.world.queryColliders(zb.x, zb.z, 0.6, (c) => {
        if (c.y1 < zb.y + 0.3 || c.y0 > zb.y + 1.8) return;
        const o = circleVs(c, p.x, p.z, 0.38);
        if (o) {
          p.x += o.nx * o.pen;
          p.z += o.nz * o.pen;
        }
      });
      zb.x = p.x;
      zb.z = p.z;
      zb.groanT -= dt;
      if (zb.groanT <= 0) {
        zb.groanT = (zb.state === ZS.CHASE ? 2.5 : 7) + Math.random() * 6;
        this.emit('groan', { id: zb.id, x: zb.x, y: zb.y, z: zb.z, aggro: zb.state === ZS.CHASE });
      }
    }
  }

  remove(zb) {
    if (zb.key) this.occupied.delete(zb.key);
    this.zombies.delete(zb.id);
  }

  population(dt, players, ctx) {
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0 || !players.length) return;
    this.spawnTimer = 1.2;
    let alive = 0;
    for (const z of this.zombies.values()) if (z.state !== ZS.DEAD) alive++;
    const cap = Math.min(MAX_ZOMBIES, Math.round((6 + ctx.night * 16) * Math.min(players.length, 3) * 0.8 + 4));
    if (alive >= cap) return;
    const now = performance_now();
    const p = players[Math.floor(Math.random() * players.length)];
    // 1) Spawnpunkte (Ruinen etc.)
    const pts = this.world.spawnPoints(p.x, p.z, 120);
    const cands = [];
    for (const s of pts) {
      const d = Math.hypot(s.x - p.x, s.z - p.z);
      if (d < 32 || d > 118) continue;
      const key = Math.round(s.x) + ',' + Math.round(s.z);
      if (this.occupied.has(key)) continue;
      if ((this.cool.get(key) || 0) > now) continue;
      cands.push({ ...s, key });
    }
    const dayProb = 0.35;
    if (cands.length) {
      const s = cands[Math.floor(Math.random() * cands.length)];
      const prob = ctx.night > 0.5 ? 0.95 : s.kind === 'ruin' || s.kind === 'mil' ? dayProb : 0.08;
      if (Math.random() < prob) {
        this.spawn(s.x, s.z, s.kind, s.key);
        this.cool.set(s.key, now + 45000);
        return;
      }
    }
    // 2) Nachts zufällige Wanderer
    if (ctx.night > 0.6 && Math.random() < 0.5) {
      const a = Math.random() * Math.PI * 2;
      const r = 55 + Math.random() * 40;
      this.spawn(p.x + Math.cos(a) * r, p.z + Math.sin(a) * r, 'wander');
    }
  }

  snapshot() {
    const out = [];
    for (const z of this.zombies.values()) {
      out.push([z.id, +z.x.toFixed(2), +z.y.toFixed(2), +z.z.toFixed(2), +z.yaw.toFixed(2), z.state, Math.round((z.hp / z.maxHp) * 100), z.type, +z.anim.toFixed(2), z.windup > 0 ? 1 : 0, z.deadT > 0 ? +z.fallDirX?.toFixed(2) || 0 : 0, z.deadT > 0 ? +z.fallDirZ?.toFixed(2) || 0 : 0]);
    }
    return out;
  }

  drainEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}

function performance_now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}
