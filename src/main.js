// Einstiegspunkt: verbindet Menüs, Spiel, Speicherstände und Mehrspieler
import { Game } from './game.js';
import { Menus, defaultMpUrl } from './ui/menus.js';
import { InventoryUI } from './ui/inventoryUI.js';
import { SaveStore } from './save/save.js';
import { input } from './core/input.js';
import { settings } from './core/settings.js';
import { setupTouch } from './ui/touch.js';
import { DAY_LENGTH } from './world/weather.js';
import { NetClient } from './net/client.js';

const canvas = document.getElementById('c');
input.init(canvas);
const game = new Game(canvas);
window.__game = game; // Debug / automatisierte Tests

const params = new URLSearchParams(location.search);
const touchMode = params.has('touch') || (window.matchMedia && matchMedia('(pointer: coarse)').matches && 'ontouchstart' in window);
input.touchMode = touchMode;
if (touchMode) setupTouch(input, game);

const app = {
  slot: null, // aktueller Spielstand {id,name}
  lastSeed: '',
  async startNew(seed, name) {
    this.slot = { id: SaveStore.newId(), name, created: Date.now() };
    this.lastSeed = seed;
    await this.launch({ seed, name });
  },
  async startSave(id) {
    const rec = await SaveStore.get(id);
    if (!rec) return;
    this.slot = { id: rec.id, name: rec.name, created: rec.created };
    this.lastSeed = rec.seed;
    await this.launch({ seed: rec.seed, name: rec.name, save: rec.data });
  },
  async launch(cfg) {
    game.audio.init();
    menus.showLoading(0, 'Starte …');
    try {
      await game.start(cfg, (p, t) => menus.showLoading(p, t));
    } catch (e) {
      console.error(e);
      menus.hideLoading();
      menus.show('menu-main');
      alert('Fehler beim Start: ' + e.message);
      return;
    }
    game.inventoryUI = inventoryUI;
    game.onDeath = (info) => this.onDeath(info);
    game.onAutosave = () => this.saveNow(true);
    setTimeout(() => menus.hideLoading(), 250);
    menus.hideAll();
    document.getElementById('loading').classList.add('hidden');
    input.lock();
    this.ensureLock();
  },
  ensureLock() {
    setTimeout(() => {
      if (game.running && !input.locked && !game.uiOpen && !game.dead && !menus.current) {
        document.getElementById('click-to-play').classList.remove('hidden');
        game.paused = true;
      }
    }, 600);
  },
  async mpRespawn() {
    const o = this.lastMp;
    if (!o) return this.quit();
    const code = game.net?.code || o.code;
    game.stop();
    await this.startMp({ ...o, mode: 'join', code }).catch((e) => {
      alert('Respawn fehlgeschlagen: ' + e.message);
      this.quit();
    });
  },
  async startMp(opts) {
    this.lastMp = opts;
    game.audio.init();
    const net = new NetClient(opts.url, opts.name);
    await net.connect();
    const info = await net.enter(opts.mode, opts);
    this.slot = null;
    this.lastSeed = info.seed;
    menus.showLoading(0, `Lobby ${info.code} – Welt wird erzeugt …`);
    await game.start({ seed: info.seed, name: opts.name, mp: info }, (p, t) => menus.showLoading(p, t));
    game.attachNet(net, info);
    game.inventoryUI = inventoryUI;
    game.onDeath = (i) => this.onDeath(i);
    game.onAutosave = null;
    menus.hideAll();
    document.getElementById('loading').classList.add('hidden');
    game.hud.toast(`Lobby-Code: ${info.code} – T: Chat`);
    input.lock();
    this.ensureLock();
  },
  resume() {
    game.audio.init();
    menus.hideAll();
    document.getElementById('click-to-play').classList.add('hidden');
    game.paused = false;
    input.lock();
    this.ensureLock();
  },
  async saveNow(silent) {
    if (!game.running || game.net || game.dead || !this.slot) return;
    const data = game.serialize();
    const rec = {
      id: this.slot.id,
      name: this.slot.name,
      created: this.slot.created,
      seed: game.seed,
      summary: { days: game.time / DAY_LENGTH, km: game.car.odometer / 1000 },
      data,
    };
    try {
      await SaveStore.put(rec);
      if (!silent) game.hud.toast('Spiel gespeichert');
      else game.hud.toast('Autosave …');
    } catch (e) {
      console.error(e);
      game.hud.toast('Speichern fehlgeschlagen');
    }
  },
  async exportCurrent() {
    if (game.net) return;
    await this.saveNow(true);
    const rec = await SaveStore.get(this.slot.id);
    if (rec) SaveStore.exportJSON(rec);
  },
  async onDeath(info) {
    if (this.slot) {
      try {
        await SaveStore.remove(this.slot.id);
      } catch {
        /* ignore */
      }
    }
    menus.showDeath(info, !!game.net);
  },
  quit() {
    game.stop();
    input.unlock();
    menus.refreshContinue();
    menus.show('menu-main');
  },
  settingsChanged() {
    game.audio.setVolume(settings.volume);
    if (game.running && game.world) {
      game.world.radius = settings.viewDistance;
      game.viewDistM = (settings.viewDistance + 0.4) * 128;
      game.camera.far = game.viewDistM * 1.15 + 80;
      game.camera.updateProjectionMatrix();
      game.sky.setViewDistance(game.viewDistM);
    }
  },
};

const menus = new Menus(app);
const inventoryUI = new InventoryUI(game);

// Pause, wenn Pointer Lock verloren geht
input.onLockChange = (locked) => {
  const ctp = document.getElementById('click-to-play');
  if (locked) {
    ctp.classList.add('hidden');
    if (game.running) game.paused = false;
    return;
  }
  if (!game.running || game.dead) return;
  if (game.uiOpen) return; // Inventar/Chat haben die Maus bewusst freigegeben
  game.paused = !game.net; // im Mehrspieler läuft die Welt weiter
  if (menus.current === 'menu-settings' || menus.current === 'menu-pause') return;
  menus.showPause();
};

// Mausrad = Hotbar
canvas.addEventListener('wheel', (e) => {
  if (input.locked) game.wheelDelta = Math.sign(e.deltaY);
}, { passive: true });

// Chat-Eingabe
document.getElementById('chatinput').addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') game.closeChat(true);
  else if (e.key === 'Escape') game.closeChat(false);
});

// Esc im Inventar
window.addEventListener('keydown', (e) => {
  if (game.uiOpen === 'inventory' && !e.repeat && (e.code === 'Escape' || e.code === 'KeyI' || e.code === settings.bindings.inventory)) {
    e.preventDefault();
    input.pressedCodes.clear();
    game.toggleInventory(false);
  }
});

// Test-/Debug-Hilfen
window.__app = app;
if (params.has('autostart')) {
  app.startNew(params.get('seed') || 'test-1', 'Test');
}
