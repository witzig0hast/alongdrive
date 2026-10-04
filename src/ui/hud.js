// HUD: Statusbalken, Hotbar, Interaktionshinweise, Kompass, Armaturenbrett, Chat, Debug
import { itemIcon } from './icons.js';
import { ITEM_DEFS } from '../items/defs.js';
import { HOTBAR } from '../player/inventory.js';
import { clamp } from '../core/rng.js';

const $ = (s) => document.querySelector(s);

export function slotHTML(item, key, extra = '') {
  if (!item) return `<div class="slot ${extra}">${key ? `<span class="k">${key}</span>` : ''}</div>`;
  const def = ITEM_DEFS[item.type];
  let n = '';
  const st = item.state || {};
  if (def.stack) n = `<span class="n">${st.count || 1}</span>`;
  else if (item.type === 'jerrycan') n = `<span class="n">${Math.round(st.fuel || 0)}L</span>`;
  else if (def.cat === 'gun') n = `<span class="n">${st.mag || 0}</span>`;
  let dur = '';
  if (def.uses) dur = `<div class="dur"><i style="width:${((st.uses ?? def.uses) / def.uses) * 100}%"></i></div>`;
  else if (st.cond !== undefined && def.cat === 'part') dur = `<div class="dur"><i style="width:${st.cond * 100}%"></i></div>`;
  return `<div class="slot ${extra}" title="${def.name}">${key ? `<span class="k">${key}</span>` : ''}<img src="${itemIcon(item.type)}" alt="">${n}${dur}</div>`;
}

export class HUD {
  constructor() {
    this.root = $('#hud');
    this.bars = {
      health: $('.bar.health'), hunger: $('.bar.hunger'), thirst: $('.bar.thirst'), stamina: $('.bar.stamina'), temp: $('.bar.temp'),
    };
    this.tempLabel = $('#temp-label');
    this.hint = $('#hint');
    this.progress = $('#progress');
    this.progressBar = $('#progress i');
    this.msgs = $('#msgs');
    this.hotbar = $('#hotbar');
    this.clock = $('#clock');
    this.odo = $('#odo');
    this.ambient = $('#ambient');
    this.objective = $('#objective');
    this.compass = $('#compass canvas').getContext('2d');
    this.carCanvas = $('#carhud');
    this.car = this.carCanvas.getContext('2d');
    this.debug = $('#debug');
    this.crosshair = $('#crosshair');
    this.chatLog = $('#chatlog');
    this.chatInput = $('#chatinput');
    this.stormNote = $('#storm-note');
    this.nametags = $('#nametags');
    this._hotKey = '';
    this._lastHint = '';
    this._lastObj = '';
    this.tagEls = new Map();
  }

  show(v) {
    this.root.classList.toggle('hidden', !v);
  }

  toast(msg) {
    const d = document.createElement('div');
    d.textContent = msg;
    this.msgs.appendChild(d);
    while (this.msgs.children.length > 5) this.msgs.firstChild.remove();
    setTimeout(() => d.remove(), 5200);
  }

  setHint(t) {
    if (t === this._lastHint) return;
    this._lastHint = t;
    this.hint.textContent = t || '';
  }

  setProgress(p) {
    if (p == null) this.progress.style.display = 'none';
    else {
      this.progress.style.display = 'block';
      this.progressBar.style.width = Math.round(clamp(p, 0, 1) * 100) + '%';
    }
  }

  setObjective(html) {
    if (html === this._lastObj) return;
    this._lastObj = html;
    this.objective.innerHTML = html;
  }

  updateVitals(v, ambient) {
    const set = (el, val) => {
      el.querySelector('i').style.width = clamp(val, 0, 100) + '%';
      el.classList.toggle('low', val < 20);
    };
    set(this.bars.health, v.health);
    set(this.bars.hunger, v.hunger);
    set(this.bars.thirst, v.thirst);
    set(this.bars.stamina, v.stamina);
    // Temperatur: Marker in 30..42 °C
    const p = clamp(((v.temp - 31) / (42 - 31)) * 100, 0, 100);
    const i = this.bars.temp.querySelector('i');
    i.style.left = `calc(${p}% - 3px)`;
    i.style.width = '6px';
    i.style.background = '#fff';
    this.bars.temp.style.background = 'linear-gradient(90deg,#3d78d6,#5cb86c 50%,#d8483a)';
    this.tempLabel.textContent = `${v.temp.toFixed(1)} °C  (außen ${Math.round(ambient)}°)`;
  }

  updateClock(day, hour, km, ambient, storm) {
    const h = Math.floor(hour);
    const m = Math.floor((hour - h) * 60);
    this.clock.textContent = `Tag ${day} · ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    this.odo.textContent = km.toFixed(2) + ' km';
    this.ambient.textContent = Math.round(ambient) + ' °C';
    this.stormNote.classList.toggle('hidden', storm < 0.3);
  }

  updateHotbar(inv, force = false) {
    let key = inv.selected + ':';
    for (const it of inv.hotbar) key += it ? it.uid + (it.state.count || '') + (it.state.fuel | 0) + (it.state.mag ?? '') + (it.state.uses ?? '') + '|' : '-|';
    key += inv.carried ? inv.carried.uid : '';
    if (key === this._hotKey && !force) return;
    this._hotKey = key;
    let html = '';
    if (inv.carried) html += slotHTML(inv.carried, 'Hände', 'sel');
    for (let i = 0; i < HOTBAR; i++) html += slotHTML(inv.hotbar[i], i + 1, !inv.carried && i === inv.selected ? 'sel' : '');
    this.hotbar.innerHTML = html;
  }

  drawCompass(yaw, marks = []) {
    const c = this.compass;
    const W = 520;
    const H = 36;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(0, 0, W, H);
    // Yaw 0 = Norden = -Z. deg wächst im Uhrzeigersinn (Ost = +X)
    const deg = ((-yaw * 180) / Math.PI + 360) % 360;
    const ppd = 3.4; // Pixel pro Grad
    c.font = '14px sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    for (let d = -80; d <= 80; d += 5) {
      const a = Math.round((deg + d) / 5) * 5;
      const off = a - deg;
      const x = W / 2 + off * ppd;
      if (x < 0 || x > W) continue;
      const aa = ((a % 360) + 360) % 360;
      const major = aa % 45 === 0;
      c.strokeStyle = 'rgba(255,255,255,0.7)';
      c.beginPath();
      c.moveTo(x, H);
      c.lineTo(x, H - (major ? 12 : aa % 15 === 0 ? 8 : 4));
      c.stroke();
      if (major) {
        const lbl = { 0: 'N', 45: 'NO', 90: 'O', 135: 'SO', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' }[aa];
        c.fillStyle = aa === 0 ? '#ff6a4a' : '#fff';
        c.fillText(lbl, x, 12);
      }
    }
    for (const m of marks) {
      const bearing = (Math.atan2(m.dx, -m.dz) * 180) / Math.PI;
      let off = bearing - deg;
      while (off > 180) off -= 360;
      while (off < -180) off += 360;
      const x = W / 2 + off * ppd;
      if (x < 8 || x > W - 8) continue;
      c.fillStyle = m.color || '#e0a23b';
      c.beginPath();
      c.moveTo(x, 20);
      c.lineTo(x - 5, 30);
      c.lineTo(x + 5, 30);
      c.fill();
    }
    c.fillStyle = '#e0a23b';
    c.beginPath();
    c.moveTo(W / 2, 22);
    c.lineTo(W / 2 - 5, 33);
    c.lineTo(W / 2 + 5, 33);
    c.fill();
  }

  /** Armaturenbrett */
  drawCar(car, visible) {
    this.carCanvas.classList.toggle('hidden', !visible);
    if (!visible) return;
    const c = this.car;
    const W = 520;
    const H = 190;
    c.clearRect(0, 0, W, H);
    // Hintergrund
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(24,20,16,0.78)');
    g.addColorStop(1, 'rgba(10,8,6,0.9)');
    c.fillStyle = g;
    c.beginPath();
    c.roundRect(0, 0, W, H, 16);
    c.fill();
    c.strokeStyle = 'rgba(224,162,59,0.4)';
    c.lineWidth = 2;
    c.stroke();

    const dial = (cx, cy, r, v, max, label, unit, ticks, red = 0.85, major = 20) => {
      c.save();
      c.translate(cx, cy);
      c.fillStyle = 'rgba(0,0,0,0.5)';
      c.beginPath();
      c.arc(0, 0, r, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = 'rgba(255,255,255,0.35)';
      c.lineWidth = 2;
      c.stroke();
      const a0 = Math.PI * 0.75;
      const a1 = Math.PI * 2.25;
      for (let i = 0; i <= ticks; i++) {
        const t = i / ticks;
        const a = a0 + (a1 - a0) * t;
        const isMajor = i % (major / (max / ticks)) === 0 || i % 5 === 0;
        c.strokeStyle = t > red ? '#ff5a4a' : '#ddd';
        c.lineWidth = isMajor ? 2 : 1;
        c.beginPath();
        c.moveTo(Math.cos(a) * (r - 4), Math.sin(a) * (r - 4));
        c.lineTo(Math.cos(a) * (r - (isMajor ? 13 : 8)), Math.sin(a) * (r - (isMajor ? 13 : 8)));
        c.stroke();
        if (isMajor && label === 'km/h') {
          c.fillStyle = '#ccc';
          c.font = '10px sans-serif';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText(String(Math.round(t * max)), Math.cos(a) * (r - 24), Math.sin(a) * (r - 24));
        }
      }
      const t = clamp(v / max, 0, 1);
      const a = a0 + (a1 - a0) * t;
      c.strokeStyle = '#ff9a3a';
      c.lineWidth = 3;
      c.beginPath();
      c.moveTo(0, 0);
      c.lineTo(Math.cos(a) * (r - 10), Math.sin(a) * (r - 10));
      c.stroke();
      c.fillStyle = '#ff9a3a';
      c.beginPath();
      c.arc(0, 0, 4, 0, 7);
      c.fill();
      c.fillStyle = '#fff';
      c.font = 'bold 15px sans-serif';
      c.textAlign = 'center';
      c.fillText(Math.round(v), 0, r * 0.45);
      c.font = '10px sans-serif';
      c.fillStyle = '#aaa';
      c.fillText(unit, 0, r * 0.45 + 13);
      c.restore();
    };
    dial(100, 96, 80, Math.abs(car.speedKmh), 200, 'km/h', 'km/h', 20, 0.95, 20);
    dial(250, 128, 52, car.rpm / 1000, 7, 'rpm', '×1000 U/min', 7, 0.88, 1);

    const bar = (x, y, w, h, v, col, label, warn) => {
      c.fillStyle = 'rgba(255,255,255,0.12)';
      c.fillRect(x, y, w, h);
      c.fillStyle = warn ? '#ff4a3a' : col;
      c.fillRect(x, y, w * clamp(v, 0, 1), h);
      c.fillStyle = '#ddd';
      c.font = '11px sans-serif';
      c.textAlign = 'left';
      c.textBaseline = 'alphabetic';
      c.fillText(label, x, y - 3);
    };
    const bat = car.battery();
    bar(325, 34, 170, 10, car.fuel / 60, '#d8a53a', `Tank ${car.fuel.toFixed(1)} L`, car.fuel < 6);
    bar(325, 64, 170, 10, (car.temp - 40) / 100, '#4aa0d8', `Kühlwasser ${Math.round(car.temp)} °C`, car.temp > 108);
    bar(325, 94, 170, 10, bat ? bat.charge : 0, '#7ac36a', `Batterie ${bat ? Math.round(bat.charge * 100) : 0} %`, !bat || bat.charge < 0.15);
    bar(325, 124, 170, 10, car.hull / 100, '#c0c0c0', `Karosserie ${Math.round(car.hull)} %`, car.hull < 30);
    // Reifen
    c.font = '11px sans-serif';
    c.fillStyle = '#ddd';
    c.fillText('Reifen', 325, 148);
    ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'].forEach((id, i) => {
      const st = car.slotState(id);
      const x = 372 + (i % 2) * 42 + (i < 2 ? 0 : 0);
      const y = 138 + 0;
      c.fillStyle = !st ? '#444' : st.cond < 0.15 ? '#ff4a3a' : st.cond < 0.4 ? '#e0a23b' : '#7ac36a';
      c.fillRect(372 + i * 28, 138, 22, 12);
    });
    // Anzeigen
    const lamp = (x, label, on, col) => {
      c.fillStyle = on ? col : 'rgba(255,255,255,0.12)';
      c.beginPath();
      c.arc(x, 170, 6, 0, 7);
      c.fill();
      c.fillStyle = '#bbb';
      c.font = '10px sans-serif';
      c.textAlign = 'left';
      c.fillText(label, x + 10, 174);
    };
    lamp(30, 'Motor', car.engineOn, '#7ac36a');
    lamp(100, 'Licht', car.lightsOn, '#f0e07a');
    lamp(165, 'Handbr.', car.input.handbrake, '#ff5a4a');
    lamp(240, 'Heiß', car.temp > 105, '#ff5a4a');
    lamp(300, 'Gang ' + (car.reverse ? 'R' : car.gear + 1), true, '#8ab4ff');
    c.fillStyle = '#fff';
    c.font = 'bold 14px monospace';
    c.textAlign = 'right';
    c.fillText((car.odometer / 1000).toFixed(2) + ' km', 500, 174);
  }

  setDebug(t) {
    this.debug.textContent = t;
  }
  toggleDebug() {
    this.debug.classList.toggle('hidden');
    return !this.debug.classList.contains('hidden');
  }

  addChat(name, text, sys = false) {
    const d = document.createElement('div');
    d.innerHTML = sys ? `<i>${esc(text)}</i>` : `<b>${esc(name)}:</b> ${esc(text)}`;
    this.chatLog.appendChild(d);
    while (this.chatLog.children.length > 8) this.chatLog.firstChild.remove();
    setTimeout(() => d.remove(), 12500);
  }

  /** Namensschilder über Mitspielern: [{id,name,x,y,visible}] */
  updateNametags(tags) {
    const seen = new Set();
    for (const t of tags) {
      seen.add(t.id);
      let el = this.tagEls.get(t.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'tag';
        el.textContent = t.name;
        this.nametags.appendChild(el);
        this.tagEls.set(t.id, el);
      }
      el.style.display = t.visible ? 'block' : 'none';
      el.style.left = t.x + 'px';
      el.style.top = t.y + 'px';
    }
    for (const [id, el] of this.tagEls) {
      if (!seen.has(id)) {
        el.remove();
        this.tagEls.delete(id);
      }
    }
  }

  hitMarker() {
    this.crosshair.classList.add('hit');
    setTimeout(() => this.crosshair.classList.remove('hit'), 120);
  }
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
