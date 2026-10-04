// Nah- und Fernkampf (Brecheisen, Schraubenschlüssel, Pistole, Schrotflinte, Fäuste)
import * as THREE from 'three';
import { ITEM_DEFS } from '../items/defs.js';

const _o = new THREE.Vector3();
const _d = new THREE.Vector3();

export class Combat {
  constructor(game) {
    this.game = game;
    this.cooldown = 0;
    this.reloadT = 0;
    this.pendingHit = -1;
    this.pendingDef = null;
  }

  get reloading() {
    return this.reloadT > 0;
  }

  update(dt, held, pressed, down, reloadPressed) {
    const g = this.game;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0 && held) this.finishReload(held);
    }
    // verzögerter Nahkampftreffer
    if (this.pendingHit >= 0) {
      this.pendingHit -= dt;
      if (this.pendingHit <= 0) {
        this.pendingHit = -1;
        this.meleeHit(this.pendingDef);
      }
    }
    const def = held ? ITEM_DEFS[held.type] : null;
    if (def && def.cat === 'gun') {
      if (reloadPressed) this.startReload(held, def);
      if (pressed && this.cooldown <= 0 && this.reloadT <= 0) this.fire(held, def);
      return;
    }
    // Nahkampf: Waffe oder Faust (nur wenn nichts anderes Nutzbares in der Hand)
    const melee = def && def.cat === 'melee' ? def : !held ? { dmg: 8, reach: 1.7, speed: 0.5, fist: true } : null;
    if (melee && down && this.cooldown <= 0 && !g.player.seat && g.vitals.stamina > 4) {
      this.cooldown = melee.speed;
      g.vitals.stamina -= 5;
      g.viewmodel.swing();
      g.audio.play('swing');
      this.pendingHit = 0.16;
      this.pendingDef = melee;
    }
  }

  startReload(item, def) {
    const inv = this.game.inv;
    if (this.reloadT > 0) return;
    if ((item.state.mag || 0) >= def.mag) return;
    if (inv.count(def.ammo) <= 0) {
      this.game.hud.toast('Keine Munition');
      return;
    }
    this.reloadT = def.reload;
    this.game.audio.play('reload');
  }

  finishReload(item) {
    const def = ITEM_DEFS[item.type];
    if (!def || def.cat !== 'gun') return;
    const inv = this.game.inv;
    const need = def.mag - (item.state.mag || 0);
    const have = Math.min(need, inv.count(def.ammo));
    if (have > 0) {
      inv.consume(def.ammo, have);
      item.state.mag = (item.state.mag || 0) + have;
    }
  }

  fire(item, def) {
    const g = this.game;
    if ((item.state.mag || 0) <= 0) {
      g.audio.play('empty');
      this.cooldown = 0.25;
      if (inv_has(g.inv, def.ammo)) this.startReload(item, def);
      else g.hud.toast('Magazin leer – keine Munition');
      return;
    }
    item.state.mag--;
    this.cooldown = def.rpm;
    g.viewmodel.shoot(def.pellets > 1 ? 1.4 : 0.8);
    g.player.pitch += def.pellets > 1 ? 0.035 : 0.018;
    g.audio.play(item.type === 'shotgun' ? 'shotgun' : 'pistol');
    g.flash(1);
    g.noise(g.player.pos.x, g.player.pos.z, 110);
    g.net?.send({ t: 'fx', k: 'shot', x: g.player.pos.x, z: g.player.pos.z, w: item.type });
    g.player.eyePos(_o);
    g.cameraForward(_d);
    const hits = new Map();
    const basis = new THREE.Vector3();
    for (let i = 0; i < def.pellets; i++) {
      basis.copy(_d);
      basis.x += (Math.random() - 0.5) * def.spread * 2;
      basis.y += (Math.random() - 0.5) * def.spread * 2;
      basis.z += (Math.random() - 0.5) * def.spread * 2;
      basis.normalize();
      const blocked = g.rayBlocked(_o, basis, def.range);
      const z = g.zombieView?.raycast(_o, basis, Math.min(def.range, blocked));
      if (z) {
        const falloff = def.pellets > 1 ? Math.max(0.25, 1 - z.dist / def.range) : 1;
        const h = hits.get(z.id) || { dmg: 0, head: false, dist: z.dist, dir: basis.clone() };
        h.dmg += def.dmg * falloff * (z.head ? 2 : 1);
        h.head = h.head || z.head;
        hits.set(z.id, h);
      } else if (blocked < def.range) {
        g.impactFx(_o.x + basis.x * blocked, _o.y + basis.y * blocked, _o.z + basis.z * blocked, false);
      }
    }
    for (const [id, h] of hits) {
      g.damageZombie(id, h.dmg, false, h.dir.x, h.dir.z);
      const z = g.zombieView.views.get(id)?.data;
      if (z) g.impactFx(z.x, z.y + (h.head ? 1.65 : 1.2), z.z, true);
      g.hud.hitMarker();
    }
  }

  meleeHit(def) {
    const g = this.game;
    if (g.player.seat) return;
    g.player.eyePos(_o);
    g.cameraForward(_d);
    const z = g.zombieView?.melee(_o, _d, def.reach);
    if (z) {
      const head = z.head;
      g.damageZombie(z.id, def.dmg * (head ? 1.6 : 1), false, _d.x, _d.z);
      const zz = g.zombieView.views.get(z.id)?.data;
      if (zz) g.impactFx(zz.x, zz.y + 1.3, zz.z, true);
      g.audio.play('hit', { pos: zz ? { x: zz.x, y: zz.y + 1, z: zz.z } : null });
      g.hud.hitMarker();
    } else {
      const b = g.rayBlocked(_o, _d, def.reach);
      if (b < def.reach) g.audio.play('thud');
    }
  }
}

function inv_has(inv, type) {
  return inv.count(type) > 0;
}
