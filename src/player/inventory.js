// Taschen-Inventar (8 Plätze) + Hotbar (5) + große Gegenstände nur in der Hand
import { ITEM_DEFS } from '../items/defs.js';

export const HOTBAR = 5;
export const POCKETS = 8;

export class Inventory {
  constructor() {
    this.hotbar = new Array(HOTBAR).fill(null);
    this.pockets = new Array(POCKETS).fill(null);
    this.carried = null; // großer Gegenstand
    this.selected = 0;
  }

  /** Aktuell in der Hand: großer Gegenstand hat Vorrang */
  held() {
    return this.carried || this.hotbar[this.selected] || null;
  }

  all() {
    const out = [];
    if (this.carried) out.push(this.carried);
    for (const i of this.hotbar) if (i) out.push(i);
    for (const i of this.pockets) if (i) out.push(i);
    return out;
  }

  count(type) {
    let n = 0;
    for (const it of this.all()) if (it.type === type) n += it.state.count || 1;
    return n;
  }

  has(type) {
    return this.all().some((i) => i.type === type);
  }

  find(type) {
    return this.all().find((i) => i.type === type) || null;
  }

  /** Verbraucht n Stück eines stapelbaren Typs. */
  consume(type, n) {
    for (const arr of [this.hotbar, this.pockets]) {
      for (let i = 0; i < arr.length && n > 0; i++) {
        const it = arr[i];
        if (it && it.type === type) {
          const have = it.state.count || 1;
          const take = Math.min(have, n);
          n -= take;
          if (have - take <= 0) arr[i] = null;
          else it.state.count = have - take;
        }
      }
    }
    return n === 0;
  }

  /**
   * Fügt Gegenstand hinzu. Gibt true zurück, wenn komplett aufgenommen.
   * Stapelbare Gegenstände werden zusammengeführt.
   */
  add(item) {
    const def = ITEM_DEFS[item.type];
    if (def.size === 'large') {
      if (this.carried) return false;
      this.carried = item;
      return true;
    }
    const slots = [this.hotbar, this.pockets];
    if (def.stack) {
      let n = item.state.count || 1;
      for (const arr of slots) {
        for (const it of arr) {
          if (it && it.type === item.type && (it.state.count || 1) < def.stack && n > 0) {
            const add = Math.min(def.stack - (it.state.count || 1), n);
            it.state.count = (it.state.count || 1) + add;
            n -= add;
          }
        }
      }
      if (n <= 0) return true;
      item.state.count = n;
    }
    for (const arr of slots) {
      const i = arr.indexOf(null);
      if (i >= 0) {
        arr[i] = item;
        return true;
      }
    }
    return false;
  }

  remove(item) {
    if (this.carried === item) {
      this.carried = null;
      return true;
    }
    for (const arr of [this.hotbar, this.pockets]) {
      const i = arr.indexOf(item);
      if (i >= 0) {
        arr[i] = null;
        return true;
      }
    }
    return false;
  }

  /** Verschiebt/tauscht Inhalte zwischen zwei Slots: ref = {arr:'hotbar'|'pockets', i} */
  swap(a, b) {
    const A = this[a.arr];
    const B = this[b.arr];
    const ia = A[a.i];
    const ib = B[b.i];
    A[a.i] = ib;
    B[b.i] = ia;
  }

  toJSON() {
    const s = (i) => (i ? { uid: i.uid, type: i.type, state: i.state } : null);
    return { hotbar: this.hotbar.map(s), pockets: this.pockets.map(s), carried: s(this.carried), selected: this.selected };
  }

  load(o, makeItem) {
    this.hotbar = o.hotbar.map((i) => (i ? makeItem(i) : null));
    this.pockets = o.pockets.map((i) => (i ? makeItem(i) : null));
    while (this.hotbar.length < HOTBAR) this.hotbar.push(null);
    while (this.pockets.length < POCKETS) this.pockets.push(null);
    this.carried = o.carried ? makeItem(o.carried) : null;
    this.selected = o.selected || 0;
  }
}
