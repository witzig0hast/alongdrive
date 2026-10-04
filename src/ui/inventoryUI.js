// Inventar-Panel: Hände, Hotbar, Taschen (Klick-zum-Tauschen, Rechtsklick benutzen)
import * as THREE from 'three';
import { slotHTML } from './hud.js';
import { ITEM_DEFS } from '../items/defs.js';
import { HOTBAR, POCKETS } from '../player/inventory.js';

export class InventoryUI {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('inventory');
    this.hands = document.getElementById('inv-hands');
    this.hotbar = document.getElementById('inv-hotbar');
    this.pockets = document.getElementById('inv-pockets');
    this.info = document.getElementById('inv-info');
    this.pick = null;
    document.getElementById('inv-close').onclick = () => game.toggleInventory(false);
    document.getElementById('inv-use').onclick = () => this.useSelected();
    document.getElementById('inv-drop').onclick = () => this.dropSelected();
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('contextmenu', (e) => {
      const s = e.target.closest('[data-ref]');
      if (s) {
        e.preventDefault();
        this.pick = this.parse(s.dataset.ref);
        this.useSelected();
      }
    });
  }

  parse(ref) {
    const [arr, i] = ref.split(':');
    return { arr, i: +i };
  }

  itemAt(r) {
    if (!r) return null;
    if (r.arr === 'hands') return this.game.inv.carried;
    return this.game.inv[r.arr][r.i];
  }

  show() {
    this.el.classList.remove('hidden');
    this.pick = null;
    this.refresh();
  }

  hide() {
    this.el.classList.add('hidden');
  }

  refresh() {
    if (this.el.classList.contains('hidden')) return;
    const inv = this.game.inv;
    const mk = (arr, name, n, selIdx) => {
      let h = '';
      for (let i = 0; i < n; i++) {
        const picked = this.pick && this.pick.arr === name && this.pick.i === i;
        h += slotHTML(arr[i], name === 'hotbar' ? i + 1 : '', `${picked ? 'pick' : ''} ${name === 'hotbar' && i === inv.selected && !inv.carried ? 'sel' : ''}`).replace('<div class="slot', `<div data-ref="${name}:${i}" class="slot`);
      }
      return h;
    };
    this.hands.innerHTML = slotHTML(inv.carried, '', this.pick && this.pick.arr === 'hands' ? 'pick' : '').replace('<div class="slot', '<div data-ref="hands:0" class="slot');
    this.hotbar.innerHTML = mk(inv.hotbar, 'hotbar', HOTBAR);
    this.pockets.innerHTML = mk(inv.pockets, 'pockets', POCKETS);
    const it = this.itemAt(this.pick);
    if (it) {
      const d = ITEM_DEFS[it.type];
      const st = it.state;
      let extra = '';
      if (it.type === 'jerrycan') extra = ` · Inhalt ${(st.fuel || 0).toFixed(1)} / ${d.cap} L`;
      if (d.cat === 'part' && st.cond !== undefined) extra = ` · Zustand ${Math.round(st.cond * 100)} %`;
      if (it.type === 'battery') extra += ` · Ladung ${Math.round((st.charge ?? 0) * 100)} %`;
      if (d.cat === 'gun') extra = ` · Magazin ${st.mag || 0}/${d.mag}`;
      if (d.stack) extra = ` · Anzahl ${st.count || 1}`;
      this.info.innerHTML = `<b>${d.name}</b>${extra}<br>${d.desc || ''}`;
    } else this.info.textContent = 'Klicke einen Gegenstand, dann einen anderen Platz zum Verschieben. Rechtsklick: benutzen. Große Teile passen nur in die Hände.';
  }

  onClick(e) {
    const s = e.target.closest('[data-ref]');
    if (!s) return;
    const ref = this.parse(s.dataset.ref);
    const inv = this.game.inv;
    if (this.pick && ref.arr !== 'hands' && this.pick.arr !== 'hands') {
      if (!(this.pick.arr === ref.arr && this.pick.i === ref.i)) {
        inv.swap(this.pick, ref);
        this.game.audio.play('click');
        this.pick = null;
        this.game.afterInventoryChange();
        return;
      }
    }
    this.pick = ref;
    if (ref.arr === 'hotbar') {
      inv.selected = ref.i;
    }
    this.game.audio.play('click');
    this.refresh();
    this.game.hud.updateHotbar(inv, true);
  }

  useSelected() {
    const it = this.itemAt(this.pick);
    const g = this.game;
    if (!it) return;
    const d = ITEM_DEFS[it.type];
    if (d.cat === 'food' || d.cat === 'drink' || d.cat === 'heal') {
      g.doFAction({ kind: 'eat' }, it);
    } else if (this.pick.arr === 'pockets') {
      // in die Hotbar verschieben
      const i = g.inv.hotbar.indexOf(null);
      if (i >= 0) {
        g.inv.hotbar[i] = it;
        g.inv.pockets[this.pick.i] = null;
        g.inv.selected = i;
        this.pick = { arr: 'hotbar', i };
      }
    } else if (this.pick.arr === 'hotbar') g.inv.selected = this.pick.i;
    g.afterInventoryChange();
  }

  dropSelected() {
    const it = this.itemAt(this.pick);
    const g = this.game;
    if (!it) return;
    g.inv.remove(it);
    const p = g.player;
    const pos = p.pos.clone();
    pos.y += 1.0;
    pos.x -= Math.sin(p.yaw) * 0.8;
    pos.z -= Math.cos(p.yaw) * 0.8;
    g.items.place(it, pos, new THREE.Vector3(0, 1, 0));
    this.pick = null;
    g.afterInventoryChange();
  }
}
