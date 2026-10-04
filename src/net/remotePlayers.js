// Darstellung der Mitspieler (Low-Poly-Humanoide, Lauf-Animation, Taschenlampen-Hinweis)
import * as THREE from 'three';
import { primGeometry, vcMaterial } from '../world/prims.js';
import { ITEM_DEFS } from '../items/defs.js';
import { makeItemMesh } from '../items/models.js';

const B = (x, y, z, sx, sy, sz, c) => ({ s: 'box', p: [x, y, z], z: [sx, sy, sz], c });
const COLORS = [0x3d6ea8, 0x4a9a5a, 0xb8782e, 0x9a4a8a, 0xa84a4a, 0x4a9a9a, 0x8a8a3a, 0x6a5aa8];
const geos = {};
function parts(ci) {
  if (geos[ci]) return geos[ci];
  const shirt = COLORS[ci % COLORS.length];
  geos[ci] = {
    torso: primGeometry([B(0, 0, 0, 0.5, 0.66, 0.28, shirt)]),
    head: primGeometry([B(0, 0, 0, 0.27, 0.3, 0.27, 0xd2a07c), B(0, 0.12, 0, 0.29, 0.07, 0.29, 0x3a2a1a)]),
    arm: primGeometry([B(0, -0.27, 0, 0.14, 0.58, 0.14, 0xd2a07c), B(0, -0.05, 0, 0.16, 0.2, 0.16, shirt)]),
    leg: primGeometry([B(0, -0.37, 0, 0.19, 0.76, 0.2, 0x35404f), B(0, -0.72, 0.03, 0.2, 0.1, 0.26, 0x1c1c1c)]),
  };
  return geos[ci];
}
const mat = vcMaterial();

export class RemotePlayer {
  constructor(id, name, colorIdx) {
    this.id = id;
    this.name = name;
    this.pos = new THREE.Vector3();
    this.target = new THREE.Vector3();
    this.yaw = 0;
    this.tYaw = 0;
    this.pitch = 0;
    this.a = {};
    this.dead = false;
    this.group = new THREE.Group();
    const g = parts(colorIdx);
    const mk = (geo, x, y, z) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      m.castShadow = true;
      return m;
    };
    this.body = new THREE.Group();
    this.torso = mk(g.torso, 0, 1.12, 0);
    this.head = mk(g.head, 0, 1.65, 0);
    this.armL = mk(g.arm, 0.34, 1.38, 0);
    this.armR = mk(g.arm, -0.34, 1.38, 0);
    this.legL = mk(g.leg, 0.13, 0.78, 0);
    this.legR = mk(g.leg, -0.13, 0.78, 0);
    this.body.add(this.torso, this.head, this.armL, this.armR, this.legL, this.legR);
    this.group.add(this.body);
    this.held = null;
    this.heldType = null;
    this.walk = 0;
    this.first = true;
  }

  setHeld(type) {
    if (type === this.heldType) return;
    this.heldType = type;
    if (this.held) {
      this.armR.remove(this.held);
      this.held = null;
    }
    if (type && ITEM_DEFS[type]) {
      this.held = makeItemMesh(type);
      this.held.position.set(0, -0.55, 0.15);
      this.held.rotation.set(0, 0, 0);
      this.armR.add(this.held);
    }
  }

  update(dt, car) {
    const seat = this.a?.seat;
    if (seat && car) {
      car.seatWorld(seat, this.pos);
      this.pos.y -= 0.3;
      this.yaw = car.yawNow();
      this.group.rotation.y = this.yaw;
      this.legL.rotation.x = this.legR.rotation.x = -1.3;
      this.armL.rotation.x = this.armR.rotation.x = -1.0;
      this.group.position.copy(this.pos);
      this.group.visible = !this.dead;
      return;
    }
    if (this.first) {
      this.pos.copy(this.target);
      this.yaw = this.tYaw;
      this.first = false;
    } else {
      const k = 1 - Math.exp(-14 * dt);
      this.pos.lerp(this.target, k);
      let d = this.tYaw - this.yaw;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.yaw += d * k;
    }
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.yaw;
    this.group.visible = !this.dead;
    const moving = this.a?.moving;
    this.walk += dt * (this.a?.sprint ? 11 : 7) * (moving ? 1 : 0);
    const sw = moving ? Math.sin(this.walk) * (this.a?.sprint ? 0.9 : 0.6) : 0;
    this.legL.rotation.x = sw;
    this.legR.rotation.x = -sw;
    this.armL.rotation.x = -sw * 0.8;
    this.armR.rotation.x = this.held ? -1.1 + this.pitch * 0.5 : sw * 0.8;
    this.body.position.y = this.a?.crouch ? -0.35 : 0;
    this.head.rotation.x = -this.pitch * 0.6;
  }

  dispose() {
    this.group.removeFromParent();
  }
}
