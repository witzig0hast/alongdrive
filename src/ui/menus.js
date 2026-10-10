// Menüs: Hauptmenü, Neues Spiel, Spielstände, Mehrspieler, Einstellungen, Pause, Tod
import { settings, saveSettings, DEFAULT_BINDINGS, BINDING_LABELS } from '../core/settings.js';
import { randomSeedString } from '../core/rng.js';
import { input } from '../core/input.js';
import { SaveStore } from '../save/save.js';

const $ = (id) => document.getElementById(id);
const SCREENS = ['menu-scores', 'menu-main', 'menu-new', 'menu-saves', 'menu-mp', 'menu-settings', 'menu-help', 'menu-pause', 'menu-death', 'loading'];

export class Menus {
  constructor(app) {
    this.app = app; // {startNew(seed,name), startSave(id), startMp(...), resume(), saveNow(), quit(), exportCurrent()}
    this.current = 'menu-main';
    this.returnTo = 'menu-main';
    this.bindButtons();
    this.buildSettings();
    this.refreshContinue();
  }

  show(id) {
    for (const s of SCREENS) $(s).classList.toggle('hidden', s !== id);
    this.current = id;
    $('click-to-play').classList.add('hidden');
  }

  hideAll() {
    for (const s of SCREENS) $(s).classList.add('hidden');
    this.current = null;
  }

  async refreshContinue() {
    const list = await SaveStore.list();
    $('btn-continue').disabled = list.length === 0;
    this.latest = list[0] || null;
  }

  bindButtons() {
    document.querySelectorAll('.back').forEach((b) => {
      b.addEventListener('click', () => this.show(b.dataset.back || this.returnTo));
    });
    $('btn-continue').onclick = () => this.latest && this.app.startSave(this.latest.id);
    $('btn-new').onclick = () => {
      $('new-seed').value = '';
      $('new-name').value = '';
      this.show('menu-new');
    };
    $('new-start').onclick = () => {
      const seed = $('new-seed').value.trim() || randomSeedString();
      const name = $('new-name').value.trim() || 'Wanderer';
      this.app.startNew(seed, name);
    };
    $('btn-saves').onclick = () => this.showSaves();
    $('btn-scores').onclick = () => this.showScores();
    $('btn-logout').onclick = async () => {
      await fetch('/auth/logout', { method: 'POST' }).catch(() => {});
      location.href = '/login';
    };
    $('btn-mp').onclick = () => this.showMp();
    $('btn-settings').onclick = () => {
      this.returnTo = 'menu-main';
      this.syncSettings();
      this.show('menu-settings');
    };
    $('btn-help').onclick = () => {
      this.returnTo = 'menu-main';
      this.show('menu-help');
    };
    $('set-back').onclick = () => {
      saveSettings();
      this.app.settingsChanged();
      this.show(this.returnTo);
    };
    // Pause
    $('pause-resume').onclick = () => this.app.resume();
    $('pause-save').onclick = async () => {
      await this.app.saveNow();
      $('pause-info').textContent = 'Gespeichert um ' + new Date().toLocaleTimeString();
    };
    $('pause-export').onclick = () => this.app.exportCurrent();
    $('pause-settings').onclick = () => {
      this.returnTo = 'menu-pause';
      this.syncSettings();
      this.show('menu-settings');
    };
    $('pause-quit').onclick = () => this.app.quit();
    // Tod
    $('death-same').onclick = () => this.app.startNew(this.app.lastSeed, 'Wanderer');
    $('death-newworld').onclick = () => this.app.startNew(randomSeedString(), 'Wanderer');
    $('death-menu').onclick = () => this.app.quit();
    $('death-respawn').onclick = () => this.app.mpRespawn();
    // Import
    $('save-import').onclick = () => $('import-file').click();
    $('import-file').onchange = async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      try {
        await SaveStore.importFile(f);
        await this.showSaves();
      } catch (err) {
        alert('Import fehlgeschlagen: ' + err.message);
      }
      e.target.value = '';
    };
    $('click-to-play').onclick = () => this.app.resume();
  }

  setUser(user) {
    $('userbar').classList.remove('hidden');
    $('user-name').textContent = '👤 ' + user.username + (user.role === 'admin' ? ' (Admin)' : '');
    $('admin-link').classList.toggle('hidden', user.role !== 'admin');
    $('mp-name-label').classList.add('hidden');
  }

  async showScores() {
    const top = $('scores-top');
    const mine = $('scores-mine');
    top.innerHTML = mine.innerHTML = '<p class="tiny">Lade …</p>';
    this.show('menu-scores');
    try {
      const j = await (await fetch('/api/scores')).json();
      const row = (s, i, me) => `<div class="item ${me ? 'me' : ''}">${i != null ? `<span class="rank">${i + 1}.</span>` : ''}<div class="meta"><b>${esc(s.name)}</b> · ${s.km.toFixed(1)} km<br>${s.days} Tage · ${s.kills} Kills · ${esc(s.cause || '')} · ${new Date(s.at).toLocaleDateString()}${s.mp ? ' · Koop' : ''}</div></div>`;
      top.innerHTML = j.top.length ? j.top.map((s, i) => row(s, i, this.app.user && s.name === this.app.user.username)).join('') : '<p class="tiny">Noch keine Einträge.</p>';
      mine.innerHTML = j.mine.length ? j.mine.map((s) => row(s, null, false)).join('') : '<p class="tiny">Noch keine Läufe.</p>';
    } catch {
      top.innerHTML = mine.innerHTML = '<p class="tiny">Bestenliste nur im Server-Betrieb verfügbar.</p>';
    }
  }

  async showSaves() {
    const list = await SaveStore.list();
    const el = $('save-list');
    el.innerHTML = '';
    if (!list.length) el.innerHTML = '<p class="tiny">Keine Spielstände vorhanden.</p>';
    for (const s of list) {
      const d = document.createElement('div');
      d.className = 'item';
      const days = (s.summary?.days ?? 0).toFixed(1);
      d.innerHTML = `<div class="meta"><b>${esc(s.name)}</b><br>Seed ${esc(s.seed)} · ${days} Tage · ${(s.summary?.km ?? 0).toFixed(1)} km · ${new Date(s.updated).toLocaleString()}</div>`;
      const mk = (label, fn) => {
        const b = document.createElement('button');
        b.textContent = label;
        b.onclick = fn;
        d.appendChild(b);
      };
      mk('Laden', () => this.app.startSave(s.id));
      mk('Export', async () => SaveStore.exportJSON(await SaveStore.get(s.id)));
      mk('Löschen', async () => {
        if (confirm('Spielstand wirklich löschen?')) {
          await SaveStore.remove(s.id);
          this.showSaves();
          this.refreshContinue();
        }
      });
      el.appendChild(d);
    }
    this.show('menu-saves');
  }

  showMp() {
    $('mp-url').value = settings.mpUrl || defaultMpUrl();
    $('mp-name').value = settings.playerName || 'Wanderer';
    $('mp-status').textContent = '';
    this.show('menu-mp');
    $('mp-create').onclick = () => this.mpStart('create');
    $('mp-join').onclick = () => this.mpStart('join');
  }

  async mpStart(mode) {
    settings.mpUrl = $('mp-url').value.trim();
    settings.playerName = $('mp-name').value.trim() || 'Wanderer';
    saveSettings();
    const status = $('mp-status');
    status.textContent = 'Verbinde …';
    try {
      await this.app.startMp({
        url: settings.mpUrl,
        name: settings.playerName,
        mode,
        seed: $('mp-seed').value.trim() || randomSeedString(),
        code: $('mp-code').value.trim().toUpperCase(),
      });
    } catch (e) {
      status.textContent = 'Fehler: ' + (e.message || e);
      this.show('menu-mp');
    }
  }

  showPause(extra = '') {
    $('pause-info').textContent = extra;
    this.show('menu-pause');
  }

  showDeath(info, mp = false) {
    $('death-same').classList.toggle('hidden', mp);
    $('death-newworld').classList.toggle('hidden', mp);
    $('death-respawn').classList.toggle('hidden', !mp);
    $('death-cause').textContent = info.cause || 'Das Ödland hat dich geholt.';
    $('death-stats').innerHTML = `<div><b>${info.km.toFixed(2)} km</b>gefahren</div><div><b>${info.days.toFixed(1)}</b>Tage überlebt</div><div><b>${info.kills}</b>Zombies getötet</div><div><b>${esc(info.seed)}</b>Seed</div>`;
    $('death-same').textContent = 'Gleicher Seed (' + info.seed + ')';
    this.show('menu-death');
  }

  showLoading(p, text) {
    $('loading').classList.remove('hidden');
    $('loading-text').textContent = text;
    document.querySelector('.loadbar i').style.width = Math.round(p * 100) + '%';
    for (const s of SCREENS) if (s !== 'loading') $(s).classList.add('hidden');
  }

  hideLoading() {
    $('loading').classList.add('hidden');
  }

  // ------------------------------------------------------------ Einstellungen
  syncSettings() {
    $('set-quality').value = settings.quality;
    $('set-view').value = settings.viewDistance;
    $('set-sens').value = settings.sensitivity;
    $('set-fov').value = settings.fov;
    $('set-vol').value = settings.volume;
    this.updateLabels();
    this.renderBindings();
  }

  updateLabels() {
    $('v-view').textContent = Math.round(settings.viewDistance * 128) + ' m';
    $('v-sens').textContent = settings.sensitivity.toFixed(2);
    $('v-fov').textContent = settings.fov + '°';
    $('v-vol').textContent = Math.round(settings.volume * 100) + '%';
  }

  buildSettings() {
    const on = (id, key, num = true, live = true) => {
      $(id).addEventListener('input', () => {
        settings[key] = num ? parseFloat($(id).value) : $(id).value;
        this.updateLabels();
        saveSettings();
        if (live) this.app.settingsChanged();
      });
    };
    on('set-quality', 'quality', false, false);
    on('set-view', 'viewDistance');
    on('set-sens', 'sensitivity');
    on('set-fov', 'fov');
    on('set-vol', 'volume');
    $('set-reset').onclick = () => {
      settings.bindings = { ...DEFAULT_BINDINGS };
      saveSettings();
      this.renderBindings();
    };
    this.syncSettings();
  }

  renderBindings() {
    const el = $('bindings');
    el.innerHTML = '';
    for (const [action, label] of Object.entries(BINDING_LABELS)) {
      const d = document.createElement('div');
      d.innerHTML = `${label}<br>`;
      const b = document.createElement('button');
      b.textContent = prettyKey(settings.bindings[action]);
      b.onclick = () => {
        b.textContent = '… Taste drücken';
        input.rawHandler = (e) => {
          e.preventDefault();
          if (e.code !== 'Escape') settings.bindings[action] = e.code;
          input.rawHandler = null;
          saveSettings();
          this.renderBindings();
          return true;
        };
      };
      d.appendChild(b);
      el.appendChild(d);
    }
  }
}

export function defaultMpUrl() {
  const loc = window.location;
  const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
  if (loc.port === '5173' || loc.port === '4173') return `${proto}//${loc.hostname}:8080`;
  return `${proto}//${loc.host}`;
}

function prettyKey(code) {
  return String(code || '–').replace(/^Key/, '').replace(/^Digit/, '').replace('Left', ' L').replace('Right', ' R').replace('Space', 'Leertaste').replace('Control', 'Strg');
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
