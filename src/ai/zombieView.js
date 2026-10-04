// Darstellung der Zombies (Low-Poly-Humanoide mit Lauf-/Angriffs-/Fall-Animation) + Raycast für Treffer
import * as THREE from 'three';
import { primGeometry, vcMaterial } from '../world/prims.js';
import { ZS } from './zombieSim.js';

const SKIN = [0x7d8c6b, 0x8b8f72, 0x6e7d66];
const SHIRT = [0x5b4a3a, 0x4a5560, 0x6a5a4a];
const PANTS = [0x2e3038, 0x3b3a30, 0x2a2f3a];

function B(x, y, z, sx, sy, sz, c) {
  return { s: 'box', p: [x, y, z], z: [sx, sy, sz], c };
}

const geoCache = {};
function partGeos(variant) {
  if (geoCache[variant]) return geoCache[variant];
  const skin = SKIN[variant % 3];
  const shirt = SHIRT[variant % 3];
  const pants = PANTS[variant % 3];
  const g = {
    torso: primGeometry([B(0, 0, 0, 0.5, 0.66, 0.28, shirt), B(0.08, -0.05, 0.145, 0.18, 0.26, 0.01, 0x7a1f1a), B(-0.15, 0.2, 0.145, 0.14, 0.12, 0.01, 0x5a1410)]),
    head: primGeometry([B(0, 0, 0, 0.27, 0.3, 0.27, skin), B(0.0, -0.1, 0.135, 0.12, 0.08, 0.01, 0x4a1010), B(-0.06, 0.03, 0.137, 0.05, 0.04, 0.01, 0x101010), B(0.06, 0.03, 0.137, 0.05, 0.04, 0.01, 0x101010)]),
    arm: primGeometry([B(0, -0.27, 0, 0.14, 0.58, 0.14, skin), B(0, -0.05, 0, 0.16, 0.2, 0.16, shirt)]),
    leg: primGeometry([B(0, -0.37, 0, 0.19, 0.76, 0.2, pants), B(0, -0.72, 0.03, 0.2, 0.1, 0.26, 0x1c1c1c)]),
  };
  geoCache[variant] = g;
  return g;
}
const mat = vcMaterial();

class View {
  constructor(id, type, variant) {
    this.id = id;
    this.group = new THREE.Group();
    const g = partGeos(variant);
    const mk = (geo, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };
    this.body = new THREE.Group();
    this.body.add(mk(g.torso, 0, 1.12, 0));
    this.head = mk(g.head, 0, 1.65, 0);
    this.body.add(this.head);
    this.armL = mk(g.arm, 0.34, 1.38, 0);
    this.armR = mk(g.arm, -0.34, 1.38, 0);
    this.legL = mk(g.leg, 0.13, 0.78, 0);
    this.legR = mk(g.leg, -0.13, 0.78, 0);
    this.body.add(this.armL, this.armR, this.legL, this.legR);
    this.group.add(this.body);
    const s = type === 2 ? 1.28 : type === 1 ? 0.95 : 1;
    this.group.scale.set(s * (type === 2 ? 1.2 : 1), s, s * (type === 2 ? 1.1 : 1));
    this.pos = new THREE.Vector3();
    this.initialised = false;
    this.fall = 0;
    this.lastYaw = 0;
  }
}

export class ZombieView {
  constructor(scene) {
    this.scene = scene;
    this.views = new Map();
    this.root = new THREE.Group();
    scene.add(this.root);
  }

  /** data: Iterable von Zombie-Objekten (x,y,z,yaw,state,type,anim,windup,deadT,hp/maxHp|hpFrac) */
  sync(data, dt, smooth = false) {
    const seen = new Set();
    for (const z of data) {
      seen.add(z.id);
      let v = this.views.get(z.id);
      if (!v) {
        v = new View(z.id, z.type, z.id % 3);
        this.views.set(z.id, v);
        this.root.add(v.group);
      }
      if (!v.initialised || !smooth) {
        v.pos.set(z.x, z.y, z.z);
        v.initialised = true;
      } else {
        const k = 1 - Math.exp(-12 * dt);
        v.pos.x += (z.x - v.pos.x) * k;
        v.pos.y += (z.y - v.pos.y) * k;
        v.pos.z += (z.z - v.pos.z) * k;
      }
      v.data = z;
      v.group.position.copy(v.pos);
      // Drehung (kürzester Weg)
      let dy = z.yaw - v.lastYaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      v.lastYaw += dy * Math.min(1, dt * 10);
      v.group.rotation.y = v.lastYaw;
      this.animate(v, z, dt);
    }
    for (const [id, v] of this.views) {
      if (!seen.has(id)) {
        v.group.removeFromParent();
        this.views.delete(id);
      }
    }
  }

  animate(v, z, dt) {
    const t = z.anim;
    const moving = z.state === ZS.CHASE || z.state === ZS.INVESTIGATE || (z.state === ZS.WANDER && Math.abs(z.vx || 0) + Math.abs(z.vz || 0) > 0.2);
    const amp = z.state === ZS.CHASE ? 0.75 : 0.45;
    if (z.state === ZS.DEAD) {
      v.fall = Math.min(1, v.fall + dt * 2.2);
      const f = v.fall * v.fall * (3 - 2 * v.fall);
      v.body.rotation.x = -f * (Math.PI / 2) * 0.98;
      v.body.position.y = -0.1 * f + 0.1 * f;
      v.body.position.z = -0.5 * f;
      v.armL.rotation.x = -0.4 * f;
      v.armR.rotation.x = -0.3 * f;
      v.legL.rotation.x = 0;
      v.legR.rotation.x = 0;
      if (z.deadT > 24) v.group.position.y -= (z.deadT - 24) * 0.25;
      return;
    }
    v.fall = 0;
    v.body.rotation.x = z.state === ZS.CHASE ? 0.12 : 0.05;
    v.body.position.set(0, 0, 0);
    const sw = moving ? Math.sin(t * 5) : 0;
    v.legL.rotation.x = sw * amp;
    v.legR.rotation.x = -sw * amp;
    const raise = z.state === ZS.CHASE || z.state === ZS.ATTACK ? -1.35 : -0.5 + Math.sin(t * 1.2) * 0.1;
    let swing = 0;
    if (z.windup > 0) swing = -0.8 + Math.sin((1 - z.windup / 0.45) * Math.PI) * 1.1;
    v.armL.rotation.x = raise + sw * 0.15 + swing;
    v.armR.rotation.x = raise - sw * 0.15 + swing;
    v.armL.rotation.z = Math.sin(t * 0.9) * 0.1;
    v.armR.rotation.z = -Math.sin(t * 0.9) * 0.1;
    v.head.rotation.z = Math.sin(t * 0.7) * 0.12;
    v.head.rotation.x = z.state === ZS.CHASE ? 0.05 : 0.25;
    v.body.rotation.z = moving ? Math.sin(t * 5) * 0.05 : 0;
  }

  /** Strahl gegen alle lebenden Zombies. Gibt {id,dist,head} oder null */
  raycast(o, d, maxDist = 100) {
    let best = null;
    for (const v of this.views.values()) {
      const z = v.data;
      if (!z || z.state === ZS.DEAD) continue;
      const s = v.group.scale.y;
      const px = z.x - o.x;
      const pz = z.z - o.z;
      if (px * px + pz * pz > maxDist * maxDist) continue;
      const spheres = [
        [1.66 * s, 0.21 * s, true],
        [1.15 * s, 0.34 * s, false],
        [0.6 * s, 0.3 * s, false],
      ];
      for (const [h, r, head] of spheres) {
        const cx = z.x - o.x;
        const cy = z.y + h - o.y;
        const cz = z.z - o.z;
        const tca = cx * d.x + cy * d.y + cz * d.z;
        if (tca < 0 || tca > maxDist) continue;
        const d2 = cx * cx + cy * cy + cz * cz - tca * tca;
        if (d2 > r * r) continue;
        const t = tca - Math.sqrt(r * r - d2);
        if (!best || t < best.dist) best = { id: z.id, dist: Math.max(0, t), head };
      }
    }
    return best;
  }

  /** Sucht Zombie in Reichweite vor dem Spieler (Nahkampf) */
  melee(o, d, reach) {
    return this.raycast(o, d, reach + 0.3);
  }

  dispose() {
    this.root.removeFromParent();
  }
}
