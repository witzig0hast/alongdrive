// Interaktionslogik (E / F): Aufheben, Einbauen, Einsteigen, Tanken, Reparieren, Essen, Lagerfeuer …
// Wird als Mixin auf Game gelegt (this = Game).
import * as THREE from 'three';
import { ITEM_DEFS, isLarge } from '../items/defs.js';
import { SLOTS, BED, WHEELS } from '../vehicle/carDef.js';
import { input } from '../core/input.js';

const _eye = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _l = new THREE.Vector3();

function canAdd(inv, item) {
  const def = ITEM_DEFS[item.type];
  if (def.size === 'large') return !inv.carried;
  if (def.stack) {
    for (const arr of [inv.hotbar, inv.pockets]) for (const it of arr) if (it && it.type === item.type && (it.state.count || 1) < def.stack) return true;
  }
  return inv.hotbar.includes(null) || inv.pockets.includes(null);
}

export const InteractionMixin = {
  /** Findet nächsten Einbauplatz, auf den der Blick zeigt */
  findSlotTarget(eye, dir, held) {
    const car = this.car;
    if (!held || ITEM_DEFS[held.type].cat !== 'part') return null;
    let best = null;
    let bestD = 0.85;
    for (const [id, s] of Object.entries(SLOTS)) {
      if (car.isInstalled(id) || s.item !== held.type) continue;
      car.localToWorld(_v.set(...s.pos), _w);
      const dx = _w.x - eye.x;
      const dy = _w.y - eye.y;
      const dz = _w.z - eye.z;
      const t = dx * dir.x + dy * dir.y + dz * dir.z;
      if (t < 0.2 || t > 4.8) continue;
      const d = Math.sqrt(Math.max(0, dx * dx + dy * dy + dz * dz - t * t));
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  },

  /** Strahl trifft die Ladefläche? Gibt lokale Position zurück */
  findBedTarget(eye, dir) {
    const car = this.car;
    if (car.pos.distanceTo(eye) > 6) return null;
    for (let t = 0.6; t < 4.2; t += 0.1) {
      _w.copy(eye).addScaledVector(dir, t);
      car.worldToLocal(_w, _l);
      if (_l.x > BED.x0 - 0.1 && _l.x < BED.x1 + 0.1 && _l.z > BED.z0 - 0.1 && _l.z < BED.z1 + 0.1 && _l.y > BED.floor - 0.15 && _l.y < BED.floor + 1.6) {
        return new THREE.Vector3(
          Math.max(BED.x0 + 0.2, Math.min(BED.x1 - 0.2, _l.x)),
          Math.max(BED.floor + 0.25, _l.y),
          Math.max(BED.z0 + 0.2, Math.min(BED.z1 - 0.2, _l.z)),
        );
      }
    }
    return null;
  },

  nearestPump(pos, maxD = 2.6) {
    let best = null;
    let bd = maxD;
    for (const p of this.pumps.values()) {
      const d = Math.hypot(p.x - pos.x, p.z - pos.z);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  },

  nearCarDoor(pos) {
    const car = this.car;
    const l = car.worldToLocal(pos, _l);
    // links (+x) = Fahrer, rechts (-x) = Beifahrer
    if (Math.abs(l.z - 0.4) < 1.6 && Math.abs(l.x) > 0.8 && Math.abs(l.x) < 3.2) return l.x > 0 ? 'driver' : 'passenger';
    return null;
  },

  nearCarFiller(pos) {
    const l = this.car.worldToLocal(pos, _l);
    return Math.abs(l.x) < 3.2 && l.z > -3.8 && l.z < 3.8;
  },

  updateInteraction(dt) {
    const player = this.player;
    const inv = this.inv;
    const hud = this.hud;
    if (this.uiOpen) {
      hud.setHint('');
      hud.setProgress(null);
      return;
    }
    if (player.seat) return this.updateSeatedInteraction(dt);

    player.eyePos(_eye);
    this.cameraForward(_dir);
    const held = inv.held();
    const heldDef = held ? ITEM_DEFS[held.type] : null;
    const car = this.car;
    const hints = [];
    let progress = null;
    const ePressed = input.pressed('interact');
    const eDown = input.down('interact');

    // ---------------- E-Aktionen
    let eAct = null;
    const it = this.items.pickRay(_eye, _dir, 3.4);
    const slotId = this.findSlotTarget(_eye, _dir, held);
    car.setGhost(slotId, !!slotId, slotId ? !(SLOTS[slotId].needs && !car.isInstalled(SLOTS[slotId].needs)) : true);
    if (slotId && !it) {
      const s = SLOTS[slotId];
      if (s.needs && !car.isInstalled(s.needs)) hints.push(`${s.label}: zuerst ${SLOTS[s.needs].label} einbauen`);
      else {
        eAct = { kind: 'install', slot: slotId };
        hints.push(`[E halten] ${s.label} einbauen`);
      }
    } else if (it) {
      const def = it.def;
      if (!canAdd(inv, it)) hints.push(isLarge(it.type) ? `${def.name} – Hände sind voll` : `${def.name} – Inventar voll`);
      else {
        eAct = { kind: 'pickup', item: it };
        hints.push(`[E] ${def.name} aufheben${def.stack ? ' (' + (it.state.count || 1) + ')' : ''}`);
      }
    } else {
      const door = this.nearCarDoor(player.pos);
      const bed = held ? this.findBedTarget(_eye, _dir) : null;
      if (bed) {
        eAct = { kind: 'load', pos: bed };
        hints.push(`[E] ${heldDef.name} auf die Ladefläche legen`);
      } else if (door && !(inv.carried && heldDef && isLarge(held.type))) {
        eAct = { kind: 'enter', seat: door };
        hints.push(door === 'driver' ? '[E] Einsteigen (Fahrer)' : '[E] Einsteigen (Beifahrer)');
      } else if (door) hints.push('Hände frei haben zum Einsteigen (Q: ablegen)');
    }

    // Halten-Fortschritt (Einbau)
    if (eAct && eAct.kind === 'install') {
      const s = SLOTS[eAct.slot];
      if (eDown) {
        if (!this.holdE || this.holdE.slot !== eAct.slot) this.holdE = { slot: eAct.slot, t: 0 };
        this.holdE.t += dt;
        progress = this.holdE.t / s.time;
        this.audioAccum = (this.audioAccum || 0) + dt;
        if (this.audioAccum > 0.45) {
          this.audioAccum = 0;
          this.audio.play('wrench', { pos: this.car.pos });
        }
        if (this.holdE.t >= s.time) {
          this.doInstall(eAct.slot, held);
          this.holdE = null;
          progress = null;
        }
      } else this.holdE = null;
    } else this.holdE = null;
    if (ePressed && eAct && eAct.kind !== 'install') this.doEAction(eAct);

    // ---------------- F-Aktionen (Benutzen)
    const fDown = input.down('use') || input.mouseDown(0);
    const fPressed = input.pressed('use') || input.mouseClicked(0);
    let fAct = null;
    if (held) {
      const type = held.type;
      const cat = heldDef.cat;
      const pump = type === 'jerrycan' ? this.nearestPump(player.pos) : null;
      if (type === 'jerrycan') {
        if (pump && (held.state.fuel || 0) < heldDef.cap) {
          fAct = { kind: 'pump', pump };
          hints.push(pump.fuel > 0.1 ? `[F halten] Kanister füllen (Zapfsäule: ${Math.round(pump.fuel)} L)` : 'Zapfsäule ist leer');
        } else if (this.nearCarFiller(player.pos) && (held.state.fuel || 0) > 0.05 && car.isInstalled('tank')) {
          fAct = { kind: 'fuelCar' };
          hints.push(`[F halten] Auto betanken (Kanister ${(held.state.fuel || 0).toFixed(1)} L)`);
        }
      } else if (type === 'toolbox' && this.nearCarFiller(player.pos)) {
        fAct = { kind: 'repair', tool: held, mode: 'toolbox' };
        hints.push(`[F] Auto reparieren (Werkzeugkasten ${held.state.uses ?? heldDef.uses})`);
      } else if (type === 'repair_kit' && this.nearCarFiller(player.pos)) {
        fAct = { kind: 'repair', tool: held, mode: 'tire' };
        hints.push(`[F] Reifen flicken (${held.state.uses ?? heldDef.uses})`);
      } else if (cat === 'food' || cat === 'drink') {
        fAct = { kind: 'eat' };
        hints.push(`[F] ${cat === 'food' ? 'Essen' : 'Trinken'}: ${heldDef.name}`);
      } else if (cat === 'heal') {
        fAct = { kind: 'eat' };
        hints.push(`[F] ${heldDef.name} benutzen`);
      } else if (type === 'flashlight') {
        fAct = { kind: 'flash' };
        hints.push(`[F] Taschenlampe ${held.state.on ? 'aus' : 'an'}`);
      } else if (type === 'wood') {
        fAct = { kind: 'fire' };
        hints.push((held.state.count || 1) >= 3 ? (inv.has('lighter') ? '[F] Lagerfeuer errichten (3 Holz)' : 'Lagerfeuer: Feuerzeug fehlt') : 'Lagerfeuer: mind. 3 Holz nötig');
      }
    }
    if (fAct) {
      if (fAct.kind === 'pump' || fAct.kind === 'fuelCar') {
        if (fDown) progress = progress ?? this.doFuelTransfer(fAct, held, dt);
      } else if (fPressed || (fAct.kind === 'repair' && false)) this.doFAction(fAct, held);
    }
    // Zeitlich begrenzte Aktionen (Reparatur)
    if (this.repairing) {
      this.repairing.t += dt;
      progress = this.repairing.t / this.repairing.dur;
      if (!input.down('use') && !input.mouseDown(0)) this.repairing = null;
      else if (this.repairing.t >= this.repairing.dur) {
        const r = this.repairing;
        this.repairing = null;
        this.finishRepair(r);
      }
    }
    // Aktions-Tipp bei Waffen
    if (heldDef && heldDef.cat === 'gun') hints.push(`${held.state.mag || 0}/${heldDef.mag} · Reserve ${inv.count(heldDef.ammo)} · [R] Nachladen`);
    else if (!held && !eAct) { /* nichts */ }

    hud.setHint(hints.join('   ·   '));
    hud.setProgress(this.combat.reloading ? 1 - this.combat.reloadT / (heldDef?.reload || 1) : progress);
  },

  updateSeatedInteraction(dt) {
    const hud = this.hud;
    const car = this.car;
    const hints = [];
    if (this.player.seat === 'driver') {
      hints.push(car.engineOn ? '[R] Motor aus' : '[R] Motor starten');
      hints.push('[E] Aussteigen');
      if (!car.engineOn) {
        const miss = car.missingRequired();
        if (miss.length) hints.push('Unvollständig: ' + miss.map((m) => SLOTS[m].label).join(', '));
        else if (car.fuel < 0.1) hints.push('Tank leer!');
      }
    } else hints.push('[E] Aussteigen');
    car.setGhost(null, false);
    hud.setHint(hints.join('   ·   '));
    hud.setProgress(null);
    if (input.pressed('interact')) this.exitCar();
  },

  doEAction(a) {
    const inv = this.inv;
    switch (a.kind) {
      case 'pickup': {
        const it = a.item;
        if (!this.items.items.has(it.uid)) return;
        this.items.take(it);
        if (!inv.add(it)) {
          // Rest (Stack) bleibt liegen
          this.items.place(it, it.pos);
          this.hud.toast('Kein Platz');
        } else {
          this.audio.play('pickup', { pos: this.player.pos });
          this.hud.toast(`${it.def.name} aufgehoben`);
          this.afterInventoryChange();
        }
        break;
      }
      case 'load': {
        const held = inv.held();
        if (!held) return;
        inv.remove(held);
        this.items.loadIntoCar(held, a.pos);
        this.audio.play('drop', { pos: this.car.pos });
        this.afterInventoryChange();
        break;
      }
      case 'enter':
        this.enterCar(a.seat);
        break;
    }
  },

  doInstall(slotId, held) {
    const inv = this.inv;
    if (!held) return;
    inv.remove(held);
    this.car.install(slotId, held);
    this.car.wake();
    this.audio.play('install', { pos: this.car.pos });
    this.hud.toast(`${SLOTS[slotId].label} eingebaut`);
    this.afterInventoryChange();
    this.car.setGhost(null, false);
    this.net?.send({ t: 'carpart', slot: slotId, type: held.type, state: held.state });
    if (this.car.assembled()) {
      this.hud.toast(this.car.fuel > 0.1 ? 'Das Auto ist fahrbereit! Einsteigen und R drücken.' : 'Das Auto ist komplett – jetzt Treibstoff besorgen!');
    }
  },

  doFuelTransfer(a, held, dt) {
    const car = this.car;
    const def = ITEM_DEFS.jerrycan;
    this.fuelSoundT = (this.fuelSoundT || 0) - dt;
    if (this.fuelSoundT <= 0) {
      this.fuelSoundT = 0.5;
      this.audio.play('fuel', { pos: this.player.pos });
    }
    if (a.kind === 'pump') {
      const rate = 4.5 * dt;
      const amt = Math.min(rate, a.pump.fuel, def.cap - (held.state.fuel || 0));
      if (amt > 0) {
        a.pump.fuel -= amt;
        held.state.fuel = (held.state.fuel || 0) + amt;
        this.net?.send({ t: 'pump', id: a.pump.id, fuel: a.pump.fuel });
      }
      return (held.state.fuel || 0) / def.cap;
    }
    const cap = 60;
    const amt = Math.min(5 * dt, held.state.fuel || 0, cap - car.fuel);
    if (amt > 0) {
      held.state.fuel -= amt;
      car.fuel += amt;
    } else if (car.fuel >= cap - 0.05) this.hud.setHint('Tank ist voll');
    return car.fuel / cap;
  },

  doFAction(a, held) {
    const inv = this.inv;
    const def = ITEM_DEFS[held.type];
    const vit = this.vitals;
    switch (a.kind) {
      case 'eat': {
        if (def.cat === 'food') {
          vit.eat(def.hunger);
          if (def.thirst) vit.drink(def.thirst);
          this.audio.play('eat');
          this.hud.toast(`${def.name} gegessen`);
        } else if (def.cat === 'drink') {
          vit.drink(def.thirst);
          this.audio.play('drink');
          this.hud.toast('Du trinkst Wasser');
        } else if (def.cat === 'heal') {
          vit.heal(def.heal);
          this.audio.play('heal');
          this.hud.toast(`Gesundheit +${def.heal}`);
        }
        inv.remove(held);
        this.afterInventoryChange();
        break;
      }
      case 'flash':
        held.state.on = !held.state.on;
        this.audio.play('click');
        break;
      case 'fire': {
        if ((held.state.count || 1) < 3) return this.hud.toast('Mindestens 3 Holz nötig');
        if (!inv.has('lighter')) return this.hud.toast('Du brauchst ein Feuerzeug');
        this.placeCampfire();
        inv.consume('wood', 3);
        this.afterInventoryChange();
        break;
      }
      case 'repair': {
        if (this.repairing) return;
        const mode = a.mode;
        if (mode === 'tire') {
          this.repairing = { t: 0, dur: 2.0, tool: held, mode };
        } else this.repairing = { t: 0, dur: 2.5, tool: held, mode };
        this.audio.play('wrench', { pos: this.car.pos });
        break;
      }
    }
  },

  finishRepair(r) {
    const msg = this.car.repair(r.mode === 'tire' ? 'tire' : 'any');
    const ok = !/in Ordnung/.test(msg);
    this.hud.toast(msg);
    if (ok) {
      const held = r.tool;
      held.state.uses = (held.state.uses ?? ITEM_DEFS[held.type].uses) - 1;
      this.audio.play('install', { pos: this.car.pos });
      if (held.state.uses <= 0) {
        this.inv.remove(held);
        this.hud.toast(`${ITEM_DEFS[held.type].name} aufgebraucht`);
        this.afterInventoryChange();
      }
    }
  },

  /** Q / G */
  dropHeld(throwIt) {
    const inv = this.inv;
    const held = inv.held();
    if (!held) return;
    if (this.player.seat) return;
    inv.remove(held);
    this.player.eyePos(_eye);
    this.cameraForward(_dir);
    const pos = _eye.clone().addScaledVector(_dir, throwIt ? 0.7 : 0.9);
    pos.y -= throwIt ? 0.1 : 0.35;
    const vel = _dir.clone().multiplyScalar(throwIt ? (isLarge(held.type) ? 6 : 11) : 1.8);
    vel.y += throwIt ? 2.2 : 0.4;
    vel.add(this.player.vel.clone().multiplyScalar(0.6));
    this.items.place(held, pos, vel);
    this.audio.play(throwIt ? 'swing' : 'drop', { pos: this.player.pos });
    this.afterInventoryChange();
  },

  afterInventoryChange() {
    this.hud.updateHotbar(this.inv, true);
    this.inventoryUI?.refresh();
  },
};
