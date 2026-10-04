// Ego-Perspektive: gehaltener Gegenstand + Hände (eigene Szene, wird über die Welt gerendert)
import * as THREE from 'three';
import { ITEM_DEFS } from '../items/defs.js';
import { makeItemMesh } from '../items/models.js';

export class ViewModel {
  constructor(camera) {
    this.scene = new THREE.Scene();
    this.camera = camera;
    this.scene.add(camera);
    this.amb = new THREE.AmbientLight(0xffffff, 1.0);
    this.dir = new THREE.DirectionalLight(0xffffff, 2.0);
    this.dir.position.set(0.5, 1, 0.8);
    this.scene.add(this.amb, this.dir);
    this.anchor = new THREE.Group();
    camera.add(this.anchor);
    this.anchor.position.set(0.24, -0.24, -0.5);
    this.itemGroup = new THREE.Group();
    this.anchor.add(this.itemGroup);
    this.mesh = null;
    this.type = null;
    const skin = new THREE.MeshLambertMaterial({ color: 0xc89a78 });
    const sleeve = new THREE.MeshLambertMaterial({ color: 0x5a4a3a });
    this.armR = new THREE.Group();
    const fr = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.09, 0.5), sleeve);
    fr.position.set(0, 0, 0.25);
    const hand = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.11), skin);
    hand.position.set(0, 0, 0.0);
    this.armR.add(fr, hand);
    this.armR.position.set(0.07, -0.12, 0.0);
    this.armR.rotation.set(-0.15, -0.25, 0);
    this.anchor.add(this.armR);
    this.armL = this.armR.clone();
    this.armL.position.set(-0.55, -0.18, -0.15);
    this.armL.rotation.set(-0.1, 0.35, 0);
    this.armL.visible = false;
    this.anchor.add(this.armL);
    this.phase = 0;
    this.swingT = -1;
    this.kick = 0;
    this.equip = 1;
    this.visible = true;
    this.reload = 0;
    this.lastItem = null;
  }

  setItem(item) {
    const type = item ? item.type : null;
    if (type === this.type) return;
    this.type = type;
    if (this.mesh) {
      this.itemGroup.remove(this.mesh);
      this.mesh = null;
    }
    this.equip = 0;
    if (!type) return;
    const def = ITEM_DEFS[type];
    this.mesh = makeItemMesh(type, true);
    this.itemGroup.add(this.mesh);
    const g = this.itemGroup;
    g.rotation.set(0, 0, 0);
    g.position.set(0, 0, 0);
    g.scale.setScalar(1);
    this.armL.visible = false;
    this.armR.visible = true;
    if (def.cat === 'gun') {
      g.rotation.set(0, Math.PI, 0);
      g.position.set(0, 0.02, -0.02);
      if (type === 'shotgun') g.position.set(0, 0.03, 0.12);
      this.armL.visible = type === 'shotgun';
    } else if (def.cat === 'melee') {
      g.rotation.set(-0.5, Math.PI / 2 + 0.2, 0.2);
      g.position.set(0, 0.1, -0.1);
    } else if (def.size === 'large') {
      g.scale.setScalar(0.8);
      g.position.set(-0.24, -0.08, -0.3);
      g.rotation.set(0.15, 0.4, 0);
      this.armL.visible = true;
    } else {
      g.rotation.set(0.2, -0.5, 0);
      g.position.set(0, 0.04, -0.05);
      g.scale.setScalar(1.3);
    }
    this.baseRot = g.rotation.clone();
    this.basePos = g.position.clone();
  }

  swing() {
    this.swingT = 0;
  }

  shoot(strength = 1) {
    this.kick = Math.min(1.4, this.kick + strength);
  }

  update(dt, st) {
    this.equip = Math.min(1, this.equip + dt * 5);
    if (st.moving) this.phase += dt * (st.sprint ? 11 : 7.5);
    const bobAmp = st.moving ? (st.sprint ? 0.02 : 0.01) : 0.003;
    const a = this.anchor;
    const rest = new THREE.Vector3(0.24, -0.24, -0.5);
    a.position.set(rest.x + Math.cos(this.phase * 0.5) * bobAmp, rest.y + Math.abs(Math.sin(this.phase * 0.5)) * bobAmp - (1 - this.equip) * 0.4, rest.z + this.kick * 0.07);
    a.rotation.set(this.kick * 0.18 + (st.sprint ? 0.25 : 0), 0, 0);
    this.kick *= Math.exp(-14 * dt);
    if (this.swingT >= 0) {
      this.swingT += dt / 0.4;
      const t = this.swingT;
      if (t >= 1) this.swingT = -1;
      else {
        const s = Math.sin(t * Math.PI);
        a.rotation.x += -s * 1.0;
        a.rotation.y += -s * 0.5 + (t > 0.4 ? (t - 0.4) * 0.3 : 0);
        a.position.x += -s * 0.25;
        a.position.y += s * 0.05;
      }
    }
    if (st.reloading) {
      a.rotation.x += 0.5;
      a.position.y -= 0.12;
    }
    this.scene.visible = this.visible;
  }

  setLighting(sun, hemi) {
    this.dir.color.copy(sun.color);
    this.dir.intensity = Math.max(0.35, sun.intensity * 0.8);
    this.dir.position.copy(sun.position).sub(sun.target.position).normalize();
    this.amb.intensity = Math.max(0.6, hemi.intensity * 1.2);
  }
}
