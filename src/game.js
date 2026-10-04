// Spiel-Kern: Renderer, Welt, Spieler, Auto, Gegenstände, Zombies, Überleben, Speichern, Mehrspieler-Hooks
import * as THREE from 'three';
import { settings, qualityProfile } from './core/settings.js';
import { input } from './core/input.js';
import { clamp, smooth, lerp, mulberry32, hashString } from './core/rng.js';
import { World } from './world/world.js';
import { CHUNK } from './world/heightfield.js';
import { SPAWN_POINT, CAR_START } from './world/worldgen.js';
import { Sky } from './world/sky.js';
import { PostFX } from './world/postfx.js';
import { ParticleSystem } from './world/particles.js';
import { hourOf, dayOf, DAY_LENGTH, ambientTemp } from './world/weather.js';
import { primGeometry, vcMaterial } from './world/prims.js';
import { Player } from './player/player.js';
import { Vitals } from './player/vitals.js';
import { Inventory } from './player/inventory.js';
import { ViewModel } from './player/viewmodel.js';
import { Combat } from './player/combat.js';
import { InteractionMixin } from './player/interaction.js';
import { ItemManager, ItemEntity } from './items/itemManager.js';
import { ITEM_DEFS } from './items/defs.js';
import { Car } from './vehicle/car.js';
import { SLOTS, REQUIRED, SEATS } from './vehicle/carDef.js';
import { ZombieSim, ZS } from './ai/zombieSim.js';
import { ZombieView } from './ai/zombieView.js';
import { AudioEngine } from './audio/audio.js';
import { HUD } from './ui/hud.js';
import { preloadIcons } from './ui/icons.js';

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q1 = new THREE.Quaternion();
const _e1 = new THREE.Euler(0, 0, 0, 'YXZ');
const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

export class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.hud = new HUD();
    this.audio = new AudioEngine();
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.running = false;
    this.paused = false;
    this.uiOpen = null; // 'inventory' | 'chat' | null
    this.dead = false;
    this.debugOn = false;
    this.onDeath = null;
    this.onPauseRequest = null;
    this.net = null;
    this.fps = 60;
    this._frames = 0;
    this._fpsT = 0;
    this.lastTime = 0;
    window.addEventListener('resize', () => this.resize());
  }

  // ------------------------------------------------------------------ Start
  async start(cfg, onProgress = () => {}) {
    this.stop();
    this.cfg = cfg;
    this.seed = cfg.seed;
    this.quality = qualityProfile();
    const q = this.quality;
    onProgress(0.02, 'Renderer…');
    const r = this.renderer;
    r.setPixelRatio(q.pixelRatio);
    r.shadowMap.enabled = q.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.08, 800);
    this.viewDistM = (settings.viewDistance + 0.4) * CHUNK;
    this.camera.far = this.viewDistM * 1.15 + 80;
    this.camera.updateProjectionMatrix();
    this.postfx = new PostFX(r, q);
    this.resize();

    onProgress(0.08, 'Himmel…');
    this.sky = new Sky(this.scene, this.camera, q);
    this.sky.setViewDistance(this.viewDistM);
    this.world = new World(this.scene, this.seed, q);
    this.world.radius = settings.viewDistance;
    this.viewmodel = new ViewModel(this.camera);
    this.player = new Player();
    this.vitals = new Vitals();
    this.inv = new Inventory();
    this.combat = new Combat(this);
    this.items = new ItemManager(this.scene, this.world);
    this.pumps = new Map();
    this.campfires = [];
    this.lightSources = new Map(); // chunkKey -> lights
    this.stats = { kills: 0 };
    this.time = 0;
    this.camMode = 'fp';
    this.camHeading = 0;
    this.hornT = 0;
    this.noiseTimer = 0;
    this.saveTimer = 0;
    this.lastSaveToast = 0;

    // Beleuchtung: feste Anzahl, damit keine Shader neu kompiliert werden
    this.lightPool = [];
    const poolN = settings.quality === 'low' ? 1 : settings.quality === 'high' ? 3 : 2;
    for (let i = 0; i < poolN; i++) {
      const l = new THREE.PointLight(0xffe2b0, 0, 20, 2);
      this.scene.add(l);
      this.lightPool.push({ l, cur: 0, target: 0, src: null });
    }
    this.spotL = new THREE.SpotLight(0xfff2d0, 0, 90, 0.5, 0.55, 1.2);
    this.spotR = new THREE.SpotLight(0xfff2d0, 0, 90, 0.5, 0.55, 1.2);
    this.scene.add(this.spotL, this.spotL.target, this.spotR, this.spotR.target);
    this.muzzle = 0;

    this.particles = {
      dust: new ParticleSystem(this.scene, Math.floor(260 * q.particles), {}),
      smoke: new ParticleSystem(this.scene, Math.floor(120 * q.particles), {}),
      fire: new ParticleSystem(this.scene, Math.floor(160 * q.particles), { additive: true }),
      blood: new ParticleSystem(this.scene, 120, { gravity: -9 }),
      storm: new ParticleSystem(this.scene, Math.floor(260 * q.particles), {}),
    };

    onProgress(0.15, 'Terrain wird erzeugt…');
    this.car = new Car(this.scene, this.world);
    this.items.car = this.car;
    this.items.clientId = (Math.random() * 1e6 | 0).toString(36);
    this.world.onChunkLoaded = (ch) => this.onChunkLoaded(ch);
    this.world.onChunkUnloaded = (ch) => this.lightSources.delete(ch.key);

    const spawnX = cfg.save ? cfg.save.player.pos[0] : 3.2;
    const spawnZ = cfg.save ? cfg.save.player.pos[2] : 3.4;
    // Startchunks laden (mit Fortschritt)
    const pre = 2;
    const pcx = Math.floor(spawnX / CHUNK);
    const pcz = Math.floor(spawnZ / CHUNK);
    let done = 0;
    const total = (pre * 2 + 1) ** 2;
    for (let dz = -pre; dz <= pre; dz++) {
      for (let dx = -pre; dx <= pre; dx++) {
        this.world.update((pcx + dx + 0.5) * CHUNK, (pcz + dz + 0.5) * CHUNK, 1);
        done++;
        if (done % 3 === 0) {
          onProgress(0.15 + 0.6 * (done / total), 'Welt wird erzeugt…');
          await nextFrame();
        }
      }
    }
    this.world.preload(spawnX, spawnZ, 2);

    // Zombies
    const world = this.world;
    this.zsim = new ZombieSim({
      terrain: world.terrain,
      queryColliders: (x, z, r, cb) => world.queryColliders(x, z, r, cb),
      spawnPoints: (x, z, r) => this.spawnPointsNear(x, z, r),
    });
    this.zombieView = new ZombieView(this.scene);

    onProgress(0.82, 'Gegenstände…');
    preloadIcons();
    await nextFrame();

    // Neu oder geladen
    if (cfg.save) this.applySave(cfg.save);
    else this.newGameSetup();

    this.audio.setVolume(settings.volume);
    this.hud.show(true);
    this.hud.updateHotbar(this.inv, true);
    onProgress(1, 'Los!');
    this.running = true;
    this.paused = false;
    this.dead = false;
    this.lastTime = performance.now();
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
    this.hud.toast(cfg.save ? 'Spielstand geladen' : 'Du wachst in einer verlassenen Garage auf …');
    if (!cfg.save) setTimeout(() => this.running && this.hud.toast('Sammle Teile, baue das Auto zusammen und fahr los.'), 3500);
  }

  newGameSetup() {
    const p = this.player;
    p.pos.set(3.2, 0.05, 3.4);
    p.yaw = 0.7;
    p.pitch = -0.1;
    this.car.placeAt(CAR_START.x, CAR_START.z, CAR_START.ry);
    this.time = 0;
    this.car.fuel = 0;
    this.car.temp = 24;
    this.world.update(p.pos.x, p.pos.z, 4);
  }

  spawnPointsNear(x, z, r) {
    const out = [];
    for (const ch of this.world.chunks.values()) {
      if (Math.abs(ch.centerX - x) > r + CHUNK || Math.abs(ch.centerZ - z) > r + CHUNK) continue;
      for (const s of ch.content.zspawns) out.push(s);
    }
    return out;
  }

  onChunkLoaded(ch) {
    this.items.onChunkLoaded(ch);
    for (const p of ch.content.pumps) {
      const id = ch.key + ':' + p.id;
      if (!this.pumps.has(id)) {
        const saved = this.savedPumps?.[id];
        this.pumps.set(id, { id, x: p.x, y: p.y, z: p.z, fuel: saved ?? p.fuel });
      }
    }
    if (ch.content.lights.length) this.lightSources.set(ch.key, ch.content.lights);
    this.net?.onChunkLoaded?.(ch);
  }

  stop() {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.audio.hornStop();
    this.net?.disconnect?.();
    this.net = null;
    if (this.scene) {
      this.world?.dispose();
      this.car?.dispose();
      this.zombieView?.dispose();
      for (const c of this.campfires || []) c.group.removeFromParent();
      this.scene.traverse((o) => {
        if (o.geometry) o.geometry.dispose?.();
      });
      this.scene = null;
    }
    this.hud.show(false);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    if (this.camera) {
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    this.postfx?.setSize(w, h);
    for (const k in this.particles || {}) this.particles[k].setScale(h * this.renderer.getPixelRatio());
  }

  // ------------------------------------------------------------------ Hilfsfunktionen
  cameraForward(out) {
    return out.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  get gameHour() {
    return hourOf(this.time);
  }

  /** Gibt die Distanz bis zum ersten Hindernis (Gelände/Struktur) entlang des Strahls zurück */
  rayBlocked(o, d, maxDist) {
    const T = this.world.terrain;
    const step = 1.0;
    for (let t = 0.5; t < maxDist; t += step) {
      const x = o.x + d.x * t;
      const y = o.y + d.y * t;
      const z = o.z + d.z * t;
      if (y < T.heightAt(x, z)) return t;
      let hit = false;
      this.world.queryColliders(x, z, 0.05, (c) => {
        if (hit || c.bed) return;
        if (y > c.y0 && y < c.y1) {
          const dx = x - c.x;
          const dz = z - c.z;
          if (c.t === 'cyl' ? dx * dx + dz * dz < c.r * c.r : (() => {
            const cs = Math.cos(c.ry);
            const sn = Math.sin(c.ry);
            return Math.abs(dx * cs - dz * sn) < c.hx && Math.abs(dx * sn + dz * cs) < c.hz;
          })()) hit = true;
        }
      });
      if (hit) return t;
    }
    return maxDist;
  }

  impactFx(x, y, z, blood) {
    const P = blood ? this.particles.blood : this.particles.dust;
    for (let i = 0; i < (blood ? 7 : 4); i++) {
      P.emit(x, y, z, (Math.random() - 0.5) * 3, Math.random() * 2.5, (Math.random() - 0.5) * 3, blood ? 0.6 : 0.8, blood ? 0.12 : 0.2, blood ? 0.2 : 0.7, blood ? 0.5 : 0.75, blood ? 0.04 : 0.62, blood ? 0.04 : 0.45, blood ? 0.9 : 0.5);
    }
  }

  flash(strength) {
    this.muzzle = strength;
    const v = this.camera.position;
    const f = _v1.set(0, 0, -1).applyQuaternion(this.camera.quaternion);
    this.particles.fire.emit(v.x + f.x * 0.8, v.y + f.y * 0.8 - 0.1, v.z + f.z * 0.8, 0, 0, 0, 0.07, 0.5, 0.9, 1, 0.8, 0.4, 0.9);
  }

  noise(x, z, loud) {
    this.zsim?.noise(x, z, loud);
    this.net?.send({ t: 'noise', x, z, r: loud });
  }

  damageZombie(id, dmg, head, dx, dz) {
    if (this.net) this.net.send({ t: 'zhit', id, dmg, head, dx, dz });
    else this.zsim.damage(id, dmg, head, dx, dz, 'me');
  }

  playerDamage(amount, cause) {
    if (this.dead) return;
    this.vitals.damage(amount, cause);
    this.audio.play('hurt');
    this.player.pitch += (Math.random() - 0.5) * 0.04;
  }

  // ------------------------------------------------------------------ Auto
  enterCar(seat) {
    const car = this.car;
    if (this.net && seat === 'driver' && car.remote) return this.hud.toast('Jemand anderes fährt');
    if (seat === 'driver' && car.driver) seat = 'passenger';
    if (seat === 'passenger' && car.passenger) return this.hud.toast('Sitz besetzt');
    this.player.seat = seat;
    this.player.vel.set(0, 0, 0);
    this.player.yaw = 0;
    this.player.pitch = 0;
    if (seat === 'driver') {
      car.driver = 'local';
      car.wake();
    } else car.passenger = 'local';
    this.viewmodel.visible = false;
    this.audio.play('door', { pos: car.pos });
    this.camMode = 'fp';
    this.net?.send({ t: 'seat', seat, on: true });
  }

  exitCar() {
    const car = this.car;
    if (Math.abs(car.speed) > 4.5) return this.hud.toast('Erst anhalten!');
    const seat = this.player.seat;
    if (!seat) return;
    car.exitPos(seat, _v1);
    this.player.pos.copy(_v1);
    this.player.vel.set(0, 0, 0);
    this.player.yaw = car.yawNow() + (seat === 'driver' ? Math.PI / 2 : -Math.PI / 2);
    this.player.yaw += 0; // blickt vom Auto weg
    this.player.pitch = 0;
    if (seat === 'driver') {
      car.driver = null;
      car.setInput({ throttle: 0, brake: 0, steer: 0, handbrake: false });
      car.input.handbrake = true;
      this.audio.hornStop();
      this.net?.send({ t: 'car', ...car.snapshot(), parked: true });
    } else car.passenger = null;
    this.player.seat = null;
    this.viewmodel.visible = true;
    this.audio.play('door', { pos: car.pos });
    this.net?.send({ t: 'seat', seat, on: false });
  }

  // ------------------------------------------------------------------ Lagerfeuer
  placeCampfire() {
    const p = this.player;
    p.eyePos(_v1);
    this.cameraForward(_v2);
    let x = p.pos.x + _v2.x * 1.8;
    let z = p.pos.z + _v2.z * 1.8;
    const y = this.world.groundAt(x, z, p.pos.y + 0.6, 0.6);
    this.addCampfire(x, y, z, 240);
    this.audio.play('flame', { pos: { x, y, z } });
    this.hud.toast('Lagerfeuer entzündet (wärmt, lockt aber Zombies an)');
    this.net?.send({ t: 'fire', x, y, z });
  }

  addCampfire(x, y, z, t) {
    const g = new THREE.Group();
    const logs = [];
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI;
      logs.push({ s: 'cyl6', p: [0, 0.1, 0], z: [0.07, 0.8, 0.07], r: [Math.PI / 2 - 0.25, a + 0.3, 0], c: 0x5c3d24 });
    }
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      logs.push({ s: 'sph', p: [Math.cos(a) * 0.5, 0.05, Math.sin(a) * 0.5], z: [0.13, 0.1, 0.13], c: 0x77736b });
    }
    const m = new THREE.Mesh(primGeometry(logs), vcMaterial());
    m.castShadow = true;
    g.add(m);
    g.position.set(x, y, z);
    this.scene.add(g);
    this.campfires.push({ x, y, z, t, group: g, emit: 0 });
  }

  // ------------------------------------------------------------------ Hauptschleife
  loop(now) {
    if (!this.running) return;
    this.raf = requestAnimationFrame(this.loop);
    let dt = (now - this.lastTime) / 1000;
    this.lastTime = now;
    if (dt > 0.1) dt = 0.1;
    this._frames++;
    this._fpsT += dt;
    if (this._fpsT >= 0.5) {
      this.fps = this._frames / this._fpsT;
      this._frames = 0;
      this._fpsT = 0;
    }
    try {
      if (!this.paused) this.update(dt);
      this.render(dt);
    } catch (e) {
      console.error(e);
      this.errorCount = (this.errorCount || 0) + 1;
      if (this.errorCount > 30) {
        this.running = false;
      }
    }
    input.endFrame();
  }

  update(dt) {
    const player = this.player;
    const vit = this.vitals;
    const car = this.car;
    this.time += dt;
    this.netTick?.(dt);

    // --- Eingaben (Menüs)
    if (input.locked && !this.dead) {
      if (!this.uiOpen) {
        if (input.pressed('inventory') || input.codePressed('KeyI')) this.toggleInventory(true);
        if (input.pressed('chat') && this.net) this.openChat();
        if (input.codePressed('F3')) {
          this.debugOn = this.hud.toggleDebug();
        }
        for (let i = 0; i < 5; i++) if (input.codePressed('Digit' + (i + 1))) this.selectSlot(i);
      } else if (this.uiOpen === 'inventory' && (input.pressed('inventory') || input.codePressed('KeyI'))) this.toggleInventory(false);
    }
    if (this.wheelDelta) {
      if (!this.uiOpen && !player.seat) this.selectSlot((this.inv.selected + (this.wheelDelta > 0 ? 1 : 4)) % 5);
      this.wheelDelta = 0;
    }

    const controls = input.locked && !this.uiOpen && !this.dead;

    // --- Spieler / Auto steuern
    const look = input.consumeLook();
    if (controls) {
      if (player.seat) this.driveControls(dt, look);
      else this.walkControls(dt, look);
    } else if (!player.seat && !this.dead) {
      // Physik läuft auch im Inventar weiter
      player.update(dt, this.world, { axes: { x: 0, y: 0 }, sprint: false, jump: false, crouch: false, canSprint: false });
    }
    if (this.dead) {
      player.update(dt, this.world, { axes: { x: 0, y: 0 }, sprint: false, jump: false, crouch: false, canSprint: false });
    }
    if (player.seat) {
      car.seatWorld(player.seat, player.pos);
      player.vel.set(0, 0, 0);
    }

    // Auto-Simulation
    if (car.driver !== 'local' || !controls) {
      if (car.driver === 'local') car.setInput({ throttle: 0, brake: 0.4, steer: 0, handbrake: false });
    }
    const amb = this.sky.state.temp;
    car.update(dt, { ambient: amb });
    if (car.driver === 'local') {
      car.steer += 0; // Lenkung wird in driveControls geglättet
    }
    this.items.syncCarItems();
    if (car.impact > 3) {
      this.audio.play('crash', { pos: car.pos, vol: car.impact * 0.1 });
      if (player.seat) this.camShake = Math.min(1, car.impact * 0.08);
    }
    this.carEffects(dt);

    // --- Gegenstände, Welt
    const focus = player.pos;
    this.items.update(dt, focus, Math.abs(car.speed) > 1);
    const pending = this.world.update(focus.x, focus.z, 1);
    this.updateCarZombieCollisions(dt);

    // --- Zombies
    this.updateZombies(dt);

    // --- Überleben
    this.updateSurvival(dt);

    // --- Interaktion & Kampf
    if (!this.dead) {
      if (controls) {
        this.updateInteraction(dt);
        const held = this.inv.held();
        if (!player.seat) {
          this.combat.update(dt, held, input.pressed('use') || input.mouseClicked(0), input.down('use') || input.mouseDown(0), input.pressed('engine'));
        }
      } else if (this.uiOpen) this.hud.setProgress(null);
      // Drop / Throw
      if (controls && !player.seat) {
        if (input.pressed('drop')) this.dropHeld(false);
        if (input.pressed('throw')) this.dropHeld(true);
      }
    }
    this.updateEffects(dt);
    this.updateLights(dt);
    this.updateCampfires(dt);

    // --- Autosave
    this.saveTimer += dt;
    if (this.saveTimer >= 60 && !this.net) {
      this.saveTimer = 0;
      this.onAutosave?.();
    }
    // --- Tod
    if (vit.dead && !this.dead) this.die();
  }

  walkControls(dt, look) {
    const p = this.player;
    const vit = this.vitals;
    p.look(look.x, look.y, settings.sensitivity);
    const ax = input.axes();
    const held = this.inv.held();
    const heavy = held && ITEM_DEFS[held.type].size === 'large';
    const sprintWanted = input.down('sprint');
    const ev = p.update(dt, this.world, {
      axes: ax,
      sprint: sprintWanted,
      jump: input.down('jump'),
      crouch: input.down('crouch'),
      canSprint: !vit.exhausted && vit.stamina > 0.5,
      speedMul: (heavy ? 0.78 : 1) * (vit.thirst < 8 || vit.hunger < 5 ? 0.85 : 1),
    });
    if (ev.jumped) {
      vit.stamina = Math.max(0, vit.stamina - 7);
      this.audio.play('jump');
    }
    if (ev.landed > 0) {
      this.audio.play('land');
      if (ev.landed > 13) this.playerDamage((ev.landed - 13) * 6, 'Sturz');
    }
    if (ev.step) {
      const surf = this.world.surfaceAt(p.pos.x, p.pos.z);
      this.audio.play('step', { surf, vol: p.sprinting ? 1.2 : p.crouch ? 0.4 : 0.8 });
      if (surf === 0) {
        const d = this.particles.dust;
        d.emit(p.pos.x + (Math.random() - 0.5) * 0.3, p.pos.y + 0.05, p.pos.z + (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.4, 0.4, (Math.random() - 0.5) * 0.4, 0.8, 0.15, 0.5, 0.78, 0.65, 0.45, 0.35);
      }
    }
  }

  driveControls(dt, look) {
    const car = this.car;
    const p = this.player;
    // Kopf bewegen
    p.yaw = clamp(p.yaw - look.x * 0.0022 * settings.sensitivity, -2.4, 2.4);
    p.pitch = clamp(p.pitch - look.y * 0.0022 * settings.sensitivity, -1.2, 1.2);
    if (this.camMode === 'tp') {
      p.yaw = ((p.yaw + Math.PI) % (Math.PI * 2)) - Math.PI;
    }
    if (p.seat !== 'driver') return;
    const ax = input.axes();
    const left = input.down('left') || ax.x < -0.2 ? 1 : 0;
    const right = input.down('right') || ax.x > 0.2 ? 1 : 0;
    let steerT = left - right;
    if (Math.abs(ax.x) > 0.2 && !input.down('left') && !input.down('right')) steerT = -ax.x;
    const maxSteer = 0.55 / (1 + Math.abs(car.speed) * 0.055);
    car.steer += (steerT * maxSteer - car.steer) * Math.min(1, dt * (steerT === 0 ? 7 : 4.5));
    const thr = input.down('forward') || ax.y > 0.3 ? Math.max(1 * (input.down('forward') ? 1 : 0), ax.y > 0 ? ax.y : 0) : 0;
    const brk = input.down('back') || ax.y < -0.3 ? Math.max(input.down('back') ? 1 : 0, ax.y < 0 ? -ax.y : 0) : 0;
    car.setInput({ throttle: thr, brake: brk, steer: steerT, handbrake: input.down('jump') });
    if (input.pressed('engine')) {
      if (car.engineOn) {
        car.stopEngine();
        this.audio.play('stall', { pos: car.pos, vol: 0.5 });
      } else {
        const msg = car.tryStart();
        if (msg) {
          this.hud.toast(msg);
          this.audio.play('empty');
        } else this.audio.play('crank', { pos: car.pos });
      }
    }
    if (input.pressed('lights')) {
      car.lightsOn = !car.lightsOn && !!car.battery() && car.battery().charge > 0.02;
      this.audio.play('click');
    }
    if (input.pressed('camera')) {
      this.camMode = this.camMode === 'fp' ? 'tp' : 'fp';
      this.camHeading = car.yawNow();
      p.yaw = 0;
    }
    if (input.down('horn')) {
      this.audio.hornStart();
      this.hornT -= dt;
      if (this.hornT <= 0) {
        this.hornT = 1.0;
        this.noise(car.pos.x, car.pos.z, 140);
      }
    } else this.audio.hornStop();
  }

  carEffects(dt) {
    const car = this.car;
    car.onStall = (m) => {
      this.hud.toast(m);
      this.audio.play('stall', { pos: car.pos });
    };
    car.onStartResult = (ok) => {
      if (ok) {
        this.audio.play('start', { pos: car.pos });
        this.hud.toast('Motor läuft');
      } else {
        this.hud.toast('Der Motor stottert … nochmal versuchen (R)');
        this.audio.play('stall', { pos: car.pos, vol: 0.4 });
      }
    };
    // Staub von den Reifen, Rauch
    const sp = Math.abs(car.speed);
    const d = this.particles.dust;
    if (sp > 3 && car.surf !== 1) {
      this.dustAcc = (this.dustAcc || 0) + dt * Math.min(40, sp * 1.8) * (0.5 + car.skid) * this.quality.particles;
      while (this.dustAcc > 1) {
        this.dustAcc -= 1;
        const i = 2 + ((Math.random() * 2) | 0);
        _v1.set(i % 2 ? -0.98 : 0.98, -0.8, -1.6).applyQuaternion(car.quat).add(car.pos);
        if (car.contacts[i]) {
          const col = car.surf === 2 ? [0.9, 0.9, 0.88] : [0.78, 0.65, 0.45];
          d.emit(_v1.x, _v1.y + 0.1, _v1.z, (Math.random() - 0.5) * 1.5, 0.8 + Math.random(), (Math.random() - 0.5) * 1.5, 1.4, 0.4, 1.8 + sp * 0.04, col[0], col[1], col[2], 0.38);
        }
      }
    }
    const heavyHeat = car.temp > 105 || car.hull < 30;
    if (heavyHeat && (car.engineOn || car.temp > 110)) {
      this.smokeAcc = (this.smokeAcc || 0) + dt * (car.temp > 118 ? 30 : 12);
      while (this.smokeAcc > 1) {
        this.smokeAcc -= 1;
        car.mesh.smokeAnchor.getWorldPosition(_v1);
        const dark = car.hull < 30 ? 0.15 : 0.9;
        this.particles.smoke.emit(_v1.x, _v1.y, _v1.z, (Math.random() - 0.5) * 0.5, 1.5 + Math.random(), (Math.random() - 0.5) * 0.5, 1.8, 0.25, 1.4, dark, dark, dark, 0.45);
      }
    }
  }

  updateCarZombieCollisions(dt) {
    const car = this.car;
    const sp = Math.abs(car.speed);
    if (sp < 3 || this.net) {
      if (this.net && sp >= 3) this.netCarHits?.();
      return;
    }
    for (const z of this.zsim.zombies.values()) {
      if (z.state === ZS.DEAD) continue;
      if (Math.abs(z.x - car.pos.x) > 5 || Math.abs(z.z - car.pos.z) > 5) continue;
      car.worldToLocal(_v1.set(z.x, z.y + 0.9, z.z), _v2);
      if (Math.abs(_v2.x) < 1.35 && _v2.z > -3.0 && _v2.z < 3.3 && _v2.y > -1.0 && _v2.y < 1.8) {
        if ((z.carHitT || 0) > this.time) continue;
        z.carHitT = this.time + 0.6;
        const dir = _v3.copy(car.vel).normalize();
        this.zsim.damage(z.id, 20 + sp * 7, false, dir.x * (1 + sp * 0.2), dir.z * (1 + sp * 0.2), 'me');
        car.damage(0.4 + sp * 0.12, 'front');
        car.vel.multiplyScalar(0.97);
        this.audio.play('hit', { pos: { x: z.x, y: z.y + 1, z: z.z }, vol: 1.2 });
        this.impactFx(z.x, z.y + 1, z.z, true);
        if (this.player.seat) this.camShake = 0.25;
      }
    }
  }

  updateZombies(dt) {
    const p = this.player;
    const car = this.car;
    const flashlight = this.flashlightOn();
    const sky = this.sky.state;
    if (!this.net) {
      const inCar = !!p.seat;
      let noise = 4;
      if (inCar) noise = car.engineOn ? 55 + Math.abs(car.speed) * 2.2 : 3;
      else if (p.sprinting) noise = 24;
      else if (p.crouch) noise = 2.5;
      else if (p.moving) noise = 9;
      if (!inCar && car.engineOn) noise = Math.max(noise, 50);
      const players = [{
        id: 'me', x: p.pos.x, y: p.pos.y, z: p.pos.z, inCar, carSpeed: Math.abs(car.speed), sprint: p.sprinting, crouch: p.crouch && !inCar,
        light: flashlight || (inCar && car.lightsOn), noise,
      }];
      if (!this.dead) this.zsim.update(dt, players, { night: sky.night, storm: sky.storm });
      // Parkender Motor lockt auch aus der Ferne
      for (const e of this.zsim.drainEvents()) this.handleZombieEvent(e);
    }
    const list = this.net ? this.net.zombieList() : this.zsim.zombies.values();
    this.zombieView.sync(list, dt, !!this.net);
  }

  handleZombieEvent(e) {
    const p = this.player;
    switch (e.type) {
      case 'attackPlayer':
        if (e.pid === 'me' || e.pid === this.net?.id) {
          this.playerDamage(e.dmg, 'Zombie-Angriff');
          this.camShake = 0.3;
        }
        break;
      case 'attackCar':
        this.car.damage(e.dmg);
        this.audio.play('thud', { pos: this.car.pos });
        break;
      case 'groan': {
        const d = Math.hypot(e.x - p.pos.x, e.z - p.pos.z);
        if (d < 70) this.audio.play('groan', { pos: { x: e.x, y: e.y + 1.5, z: e.z }, aggro: e.aggro, vol: 1 });
        break;
      }
      case 'died': {
        this.stats.kills = this.zsim.kills;
        const z = this.zsim.zombies.get(e.id);
        if (z) this.audio.play('zdie', { pos: { x: z.x, y: z.y + 1, z: z.z } });
        break;
      }
      case 'swing': {
        break;
      }
    }
  }

  flashlightOn() {
    const h = this.inv.held();
    return !!(h && h.type === 'flashlight' && h.state.on && !this.player.seat);
  }

  updateSurvival(dt) {
    const p = this.player;
    const car = this.car;
    const sky = this.sky.state;
    let fire = 0;
    for (const c of this.campfires) {
      const d = Math.hypot(c.x - p.pos.x, c.z - p.pos.z);
      fire = Math.max(fire, smooth(8, 1.2, d));
    }
    // In Gebäuden etwas gemäßigter
    const indoors = Math.abs(p.pos.x) < 6.8 && Math.abs(p.pos.z) < 5.8 && p.pos.y < 3;
    let ambient = sky.temp;
    if (indoors) ambient = ambient + (20 - ambient) * 0.35;
    this.ambientNow = ambient;
    this.vitals.update(dt, {
      ambient,
      sprinting: p.sprinting && !p.seat,
      moving: p.moving,
      inCar: !!p.seat,
      carHeated: car.engineOn,
      fireWarmth: fire,
      storm: sky.storm,
    });
    if (this.vitals.hurtFlash > 0 && this.vitals.health < 25 && Math.random() < dt * 0.4) this.audio.play('step', { vol: 0.6 });
    this.fireNow = fire;
  }

  die() {
    this.dead = true;
    this.audio.hornStop();
    const days = Math.floor(this.time / DAY_LENGTH) + (this.gameHour >= 7 ? 0 : 0);
    const info = {
      cause: this.vitals.deathCause,
      km: this.car.odometer / 1000,
      days: Math.max(0, Math.floor((this.time / DAY_LENGTH) * 10) / 10),
      kills: this.zsim.kills,
      seed: this.seed,
    };
    input.unlock();
    this.onDeath?.(info);
  }

  // ------------------------------------------------------------------ Inventar / UI
  selectSlot(i) {
    this.inv.selected = i;
    this.audio.play('click');
    this.hud.updateHotbar(this.inv, true);
  }

  toggleInventory(open) {
    if (open) {
      this.uiOpen = 'inventory';
      input.unlock();
      this.inventoryUI?.show();
    } else {
      this.uiOpen = null;
      this.inventoryUI?.hide();
      input.lock();
    }
  }

  openChat() {
    this.uiOpen = 'chat';
    input.unlock();
    this.hud.chatInput.classList.remove('hidden');
    this.hud.chatInput.value = '';
    setTimeout(() => this.hud.chatInput.focus(), 10);
  }

  closeChat(send) {
    const ci = this.hud.chatInput;
    const text = ci.value.trim();
    ci.classList.add('hidden');
    ci.blur();
    this.uiOpen = null;
    if (send && text && this.net) this.net.send({ t: 'chat', text });
    input.lock();
  }

  // ------------------------------------------------------------------ Effekte, Licht
  updateEffects(dt) {
    const p = this.player;
    this.muzzle = Math.max(0, this.muzzle - dt * 18);
    for (const k in this.particles) this.particles[k].update(dt);
    // Sandsturm-Partikel
    const storm = this.sky.state.storm;
    if (storm > 0.05) {
      const n = Math.floor(storm * 280 * dt * this.quality.particles);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = 3 + Math.random() * 28;
        const x = this.camera.position.x + Math.cos(a) * r;
        const z = this.camera.position.z + Math.sin(a) * r;
        this.particles.storm.emit(x, this.camera.position.y + (Math.random() - 0.3) * 8, z, -22 - Math.random() * 6, 0.5, -6, 0.9, 0.12, 0.2, 0.8, 0.62, 0.42, 0.42 * storm);
      }
    }
  }

  updateLights(dt) {
    const cam = this.camera.position;
    // Quellen sammeln (alle paar Frames)
    this.lightScan = (this.lightScan || 0) - dt;
    if (this.lightScan <= 0) {
      this.lightScan = 0.3;
      const cands = [];
      for (const arr of this.lightSources.values()) {
        for (const l of arr) {
          const d = Math.hypot(l.x - cam.x, l.z - cam.z);
          if (d < 55 && l.intensity > 0) cands.push({ x: l.x, y: l.y, z: l.z, color: l.color, i: l.intensity * 30, dist: l.dist, d });
        }
      }
      for (const c of this.campfires) {
        const d = Math.hypot(c.x - cam.x, c.z - cam.z);
        if (d < 60) cands.push({ x: c.x, y: c.y + 0.8, z: c.z, color: 0xff9a40, i: 22, dist: 18, d, fire: c });
      }
      cands.sort((a, b) => a.d - b.d);
      this.lightPool.forEach((slot, i) => {
        const c = cands[i];
        slot.src = c || null;
        slot.target = c ? c.i : 0;
        if (c) {
          slot.l.position.set(c.x, c.y, c.z);
          slot.l.color.setHex(c.color);
          slot.l.distance = c.dist;
        }
      });
    }
    this.lightPool.forEach((slot, i) => {
      slot.cur += (slot.target - slot.cur) * Math.min(1, dt * 6);
      let v = slot.cur;
      if (slot.src && slot.src.fire) v *= 0.85 + Math.sin(this.time * 17 + i) * 0.1 + Math.random() * 0.08;
      if (i === 0 && this.muzzle > 0) {
        slot.l.position.copy(cam);
        slot.l.color.setHex(0xffc070);
        slot.l.distance = 18;
        v = Math.max(v, this.muzzle * 90);
      }
      slot.l.intensity = v;
    });
    // Scheinwerfer / Taschenlampe
    const car = this.car;
    const bat = car.battery();
    const carOn = car.lightsOn && bat && bat.charge > 0.01;
    if (carOn) {
      for (const [spot, x] of [[this.spotL, 0.65], [this.spotR, -0.65]]) {
        car.localToWorld(_v1.set(x, 0.15, 2.9), spot.position);
        car.localToWorld(_v2.set(x * 0.6, -0.2, 18), spot.target.position);
        spot.intensity = 260;
      }
    } else if (this.flashlightOn()) {
      this.spotL.position.copy(cam);
      this.cameraForward(_v1);
      this.spotL.target.position.copy(cam).addScaledVector(_v1, 10);
      this.spotL.intensity = 320;
      this.spotL.angle = 0.42;
      this.spotR.intensity = 0;
    } else {
      this.spotL.intensity = 0;
      this.spotR.intensity = 0;
    }
    if (carOn) this.spotL.angle = 0.5;
    this.spotL.target.updateMatrixWorld();
    this.spotR.target.updateMatrixWorld();
  }

  updateCampfires(dt) {
    const f = this.particles.fire;
    const s = this.particles.smoke;
    for (let i = this.campfires.length - 1; i >= 0; i--) {
      const c = this.campfires[i];
      c.t -= dt;
      if (c.t <= 0) {
        c.group.removeFromParent();
        this.campfires.splice(i, 1);
        continue;
      }
      const d = Math.hypot(c.x - this.camera.position.x, c.z - this.camera.position.z);
      if (d > 70) continue;
      c.emit += dt * 28 * this.quality.particles;
      while (c.emit > 1) {
        c.emit -= 1;
        f.emit(c.x + (Math.random() - 0.5) * 0.35, c.y + 0.15, c.z + (Math.random() - 0.5) * 0.35, (Math.random() - 0.5) * 0.3, 1.1 + Math.random() * 0.8, (Math.random() - 0.5) * 0.3, 0.7, 0.5, 0.1, 1, 0.55 + Math.random() * 0.3, 0.15, 0.85);
        if (Math.random() < 0.25) s.emit(c.x, c.y + 0.9, c.z, (Math.random() - 0.5) * 0.4, 1.4, (Math.random() - 0.5) * 0.4, 2.2, 0.3, 1.2, 0.35, 0.33, 0.3, 0.25);
      }
      // Feuer lockt Zombies leise an
      if (!this.net && Math.random() < dt * 0.05) this.zsim.noise(c.x, c.z, 28);
    }
  }

  // ------------------------------------------------------------------ Rendering
  render(dt) {
    const p = this.player;
    const car = this.car;
    const cam = this.camera;
    cam.fov = settings.fov;
    // Kameraposition
    if (p.seat) {
      if (this.camMode === 'fp') {
        car.eyeWorld(p.seat, cam.position);
        _e1.set(p.pitch, p.yaw, 0, 'YXZ');
        _q1.setFromEuler(_e1);
        cam.quaternion.copy(car.quat).multiply(_q1);
      } else {
        const hd = car.yawNow();
        let dh = hd - this.camHeading;
        while (dh > Math.PI) dh -= Math.PI * 2;
        while (dh < -Math.PI) dh += Math.PI * 2;
        this.camHeading += dh * Math.min(1, dt * 3.2);
        const orbit = this.camHeading + p.yaw;
        const dist = 8.2;
        cam.position.set(car.pos.x - Math.sin(orbit) * dist, car.pos.y + 3.2 + p.pitch * 4, car.pos.z - Math.cos(orbit) * dist);
        const gy = this.world.terrain.heightAt(cam.position.x, cam.position.z) + 1.0;
        if (cam.position.y < gy) cam.position.y = gy;
        cam.lookAt(car.pos.x, car.pos.y + 0.9, car.pos.z);
      }
      this.viewmodel.visible = false;
    } else {
      p.eyePos(cam.position);
      _e1.set(p.pitch, p.yaw, 0, 'YXZ');
      cam.quaternion.setFromEuler(_e1);
      this.viewmodel.visible = true;
    }
    if (this.camShake > 0) {
      this.camShake = Math.max(0, this.camShake - dt * 2.5);
      cam.position.x += (Math.random() - 0.5) * this.camShake * 0.1;
      cam.position.y += (Math.random() - 0.5) * this.camShake * 0.1;
    }
    cam.updateMatrixWorld(true);

    const sky = this.sky;
    sky.update(this.time, this.seed, p.pos);
    this.viewmodel.setLighting(sky.sun, sky.hemi);
    const held = this.inv.held();
    this.viewmodel.setItem(!p.seat ? held : null);
    this.viewmodel.update(dt, { moving: p.moving && p.onGround, sprint: p.sprinting, reloading: this.combat.reloading });

    // HUD
    this.updateHud(dt);

    // Post-Parameter
    const s = sky.state;
    const heat = smooth(27, 40, s.temp) * (1 - s.storm) * (s.elevation > 0 ? 1 : 0);
    const horizonY = 0.5 - Math.tan(p.seat && this.camMode === 'fp' ? p.pitch : p.pitch) / (2 * Math.tan((cam.fov * Math.PI) / 360));
    const fx = {
      time: this.time,
      heat,
      horizonY: clamp(horizonY, -1, 2),
      glare: s.glare * (p.seat && this.camMode === 'fp' ? 0.9 : 1),
      sun: s.sunScreen,
      dust: s.storm,
      damage: this.vitals.hurtFlash + (this.vitals.health < 20 ? (0.15 + Math.sin(this.time * 4) * 0.08) : 0),
      cold: smooth(36, 33, this.vitals.temp),
      night: s.night,
      dustColor: sky.scene.fog.color,
    };
    this.postfx.render(this.scene, cam, this.viewmodel.visible ? this.viewmodel.scene : null, fx);
  }

  objectiveHTML() {
    const car = this.car;
    if (car.assembled() && car.fuel > 0.5) return '';
    const done = (b, t) => `<div class="${b ? 'ok' : ''}">${b ? '✓' : '•'} ${t}</div>`;
    let h = '<b>Ziel: Auto reparieren</b>';
    h += done(car.isInstalled('engine'), 'Motor');
    h += done(car.isInstalled('battery'), 'Batterie');
    h += done(car.isInstalled('plugs'), 'Zündkerzen');
    h += done(car.isInstalled('tank'), 'Tank');
    const w = ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR'].filter((i) => car.isInstalled(i)).length;
    h += done(w === 4, `Räder (${w}/4)`);
    h += done(car.fuel > 0.5, `Treibstoff (${car.fuel.toFixed(0)} L)`);
    if (!car.assembled()) h += '<div style="opacity:.7;margin-top:4px">Teile liegen in der Garage, im Schuppen (West) und an der Tankstelle (Südost).</div>';
    return h;
  }

  updateHud(dt) {
    const hud = this.hud;
    const p = this.player;
    const s = this.sky.state;
    hud.updateVitals(this.vitals, this.ambientNow ?? s.temp);
    hud.updateClock(dayOf(this.time), s.hour, this.car.odometer / 1000, this.ambientNow ?? s.temp, s.storm);
    this.hudT = (this.hudT || 0) - dt;
    if (this.hudT <= 0) {
      this.hudT = 0.25;
      hud.setObjective(this.objectiveHTML());
      hud.updateHotbar(this.inv);
    }
    const yaw = p.seat && this.camMode === 'fp' ? this.car.yawNow() + p.yaw : p.seat ? this.camHeading + p.yaw : p.yaw;
    const marks = [];
    if (!this.car.assembled() || this.car.fuel < 1) {
      marks.push({ dx: -62 - p.pos.x, dz: 40 - p.pos.z, color: '#8fd18a' });
      marks.push({ dx: 95 - p.pos.x, dz: -66 - p.pos.z, color: '#e0a23b' });
    }
    if (this.net) for (const r of this.net.remotes.values()) marks.push({ dx: r.pos.x - p.pos.x, dz: r.pos.z - p.pos.z, color: '#6cf' });
    hud.drawCompass(yaw, marks);
    hud.drawCar(this.car, !!p.seat);
    if (this.debugOn) {
      const ch = this.world.chunks.size;
      hud.setDebug(
        `FPS ${this.fps.toFixed(0)}  Draw ${this.renderer.info.render.calls}  Tris ${(this.renderer.info.render.triangles / 1000).toFixed(0)}k\n` +
          `Pos ${p.pos.x.toFixed(1)} ${p.pos.y.toFixed(1)} ${p.pos.z.toFixed(1)}\n` +
          `Chunk ${Math.floor(p.pos.x / CHUNK)},${Math.floor(p.pos.z / CHUNK)}  geladen ${ch}  Seed "${this.seed}"\n` +
          `Zombies ${this.zsim.zombies.size}  Items ${this.items.items.size}  Zeit ${s.hour.toFixed(2)}h  Sturm ${s.storm.toFixed(2)}\n` +
          `Auto ${this.car.speedKmh.toFixed(0)} km/h  rpm ${this.car.rpm.toFixed(0)}  Gang ${this.car.reverse ? 'R' : this.car.gear + 1}  Temp ${this.car.temp.toFixed(0)}°C  Boden ${['Sand', 'Fels', 'Salz'][this.car.surf]}` +
          (this.net ? `\nNetz ${this.net.stats()}` : ''),
      );
      this.renderChunkBounds();
    } else if (this.chunkLines) this.chunkLines.visible = false;
    // Audio
    const car = this.car;
    const camPos = this.camera.position;
    this.audio.update(dt, {
      pos: camPos,
      fwd: this.cameraForward(_v1),
      storm: s.storm,
      inCar: !!p.seat,
      carSpeed: Math.abs(car.speed),
      fire: this.fireNow || 0,
      car: {
        on: car.engineOn,
        rpm: car.rpm,
        load: car.load,
        skid: car.skid,
        speedAbs: Math.abs(car.speed),
        dist: car.pos.distanceTo(camPos),
        pan: (() => {
          const rel = _v2.copy(car.pos).sub(camPos);
          const right = _v3.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
          return rel.length() > 0.1 ? rel.normalize().dot(right) : 0;
        })(),
      },
    });
    if (this.net) {
      const tags = [];
      for (const r of this.net.remotes.values()) {
        _v1.set(r.pos.x, r.pos.y + 2.15, r.pos.z).project(this.camera);
        tags.push({ id: r.id, name: r.name, x: (_v1.x * 0.5 + 0.5) * window.innerWidth, y: (-_v1.y * 0.5 + 0.5) * window.innerHeight, visible: _v1.z < 1 && _v1.z > 0 && r.pos.distanceTo(camPos) < 80 });
      }
      hud.updateNametags(tags);
    }
  }

  renderChunkBounds() {
    if (!this.chunkLines) {
      const pts = [];
      for (let i = -3; i <= 3; i++) {
        pts.push(i * CHUNK, 0, -3 * CHUNK, i * CHUNK, 0, 3 * CHUNK, -3 * CHUNK, 0, i * CHUNK, 3 * CHUNK, 0, i * CHUNK);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.chunkLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xffee55, fog: false }));
      this.chunkLines.frustumCulled = false;
      this.scene.add(this.chunkLines);
    }
    const p = this.player.pos;
    this.chunkLines.visible = true;
    this.chunkLines.position.set(Math.floor(p.x / CHUNK) * CHUNK, p.y + 1.5, Math.floor(p.z / CHUNK) * CHUNK);
  }

  // ------------------------------------------------------------------ Speichern / Laden
  serialize() {
    const p = this.player;
    const pumps = {};
    for (const [id, pu] of this.pumps) pumps[id] = pu.fuel;
    return {
      v: 1,
      seed: this.seed,
      name: this.cfg.name,
      time: this.time,
      player: { pos: p.pos.toArray(), yaw: p.yaw, pitch: p.pitch, vitals: this.vitals.toJSON(), inv: this.inv.toJSON(), seat: p.seat },
      car: this.car.toJSON(),
      world: this.items.serialize(),
      campfires: this.campfires.map((c) => ({ x: c.x, y: c.y, z: c.z, t: c.t })),
      pumps: { ...(this.savedPumps || {}), ...pumps },
      stats: { kills: this.zsim.kills },
    };
  }

  applySave(s) {
    const p = this.player;
    this.time = s.time || 0;
    this.savedPumps = s.pumps || {};
    for (const [id, f] of Object.entries(this.savedPumps)) {
      const pu = this.pumps.get(id);
      if (pu) pu.fuel = f;
    }
    p.pos.fromArray(s.player.pos);
    p.yaw = s.player.yaw;
    p.pitch = s.player.pitch;
    this.vitals.load(s.player.vitals);
    this.car.load(s.car);
    // Gegenstände wiederherstellen (Inventar zuerst mit Entities, die nicht in der Welt liegen)
    this.items.restore(s.world);
    this.inv.load(s.player.inv, (o) => {
      const e = new ItemEntity(o.uid, o.type, o.state);
      e.mode = 'inv';
      return e;
    });
    this.zsim.kills = s.stats?.kills || 0;
    for (const c of s.campfires || []) this.addCampfire(c.x, c.y, c.z, c.t);
    this.world.update(p.pos.x, p.pos.z, 6);
    p.pos.y = this.world.groundAt(p.pos.x, p.pos.z, p.pos.y + 0.8, 0.8);
    if (s.player.seat === 'driver') {
      /* Spieler steht neben dem Auto */
    }
  }
}

Object.assign(Game.prototype, InteractionMixin);
