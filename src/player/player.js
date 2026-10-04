// Spieler-Controller (Ego-Perspektive): Laufen, Sprinten, Ducken, Springen, Kollision mit Terrain/Strukturen
import * as THREE from 'three';
import { clamp } from '../core/rng.js';

const RADIUS = 0.36;
const HEIGHT = 1.8;
const GRAVITY = 22;

export class Player {
  constructor() {
    this.pos = new THREE.Vector3(0, 0, 9.5); // Füße
    this.vel = new THREE.Vector3();
    this.yaw = 0; // 0 = blickt nach +Z? (siehe forward())
    this.pitch = 0;
    this.onGround = false;
    this.crouch = false;
    this.eye = 1.68;
    this.stepDist = 0;
    this.bob = 0;
    this.sprinting = false;
    this.moving = false;
    this.speed = 0;
    this.seat = null; // 'driver' | 'passenger' | null
    this.fallSpeed = 0;
  }

  /** Blickrichtung (Yaw 0 = -Z, wie Three.js-Kamera) */
  forward(out = new THREE.Vector3()) {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp);
  }

  eyePos(out = new THREE.Vector3()) {
    return out.set(this.pos.x, this.pos.y + this.eye + Math.sin(this.bob) * 0.025 * (this.onGround ? this.speed / 6 : 0), this.pos.z);
  }

  /** opts: {axes:{x,y}, sprint, jump, crouch, canSprint, speedMul} */
  update(dt, world, opts) {
    const ev = { jumped: false, landed: 0, step: false };
    // Ducken
    const wantCrouch = opts.crouch;
    if (this.crouch && !wantCrouch) {
      // Aufstehen nur, wenn Platz
      const clear = world.groundAt(this.pos.x, this.pos.z, this.pos.y + 3, 0) <= this.pos.y + 0.1 || true;
      if (clear) this.crouch = false;
    } else if (wantCrouch) this.crouch = true;
    this.eye += ((this.crouch ? 1.1 : 1.68) - this.eye) * Math.min(1, dt * 12);

    const ax = opts.axes;
    const len = Math.hypot(ax.x, ax.y);
    this.moving = len > 0.05;
    this.sprinting = !!(opts.sprint && ax.y > 0.1 && opts.canSprint && !this.crouch);
    let speed = this.crouch ? 2.0 : this.sprinting ? 7.3 : 4.4;
    speed *= opts.speedMul ?? 1;
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    // vorwärts = (-sin, -cos); rechts = (cos, -sin)
    let wx = 0;
    let wz = 0;
    if (len > 0.001) {
      const nx = ax.x / Math.max(1, len);
      const ny = ax.y / Math.max(1, len);
      wx = (cy * nx - sy * ny) * speed;
      wz = (-sy * nx - cy * ny) * speed;
    }
    const k = 1 - Math.exp(-(this.onGround ? 14 : 2.2) * dt);
    this.vel.x += (wx - this.vel.x) * k;
    this.vel.z += (wz - this.vel.z) * k;

    // Springen
    if (opts.jump && this.onGround && !this.crouch) {
      this.vel.y = 7.4;
      this.onGround = false;
      ev.jumped = true;
    }
    this.vel.y -= GRAVITY * dt;
    this.fallSpeed = this.vel.y;

    // Bewegung achsenweise mit Kollision
    const prevX = this.pos.x;
    const prevZ = this.pos.z;
    const top = () => this.pos.y + (this.crouch ? 1.2 : HEIGHT);
    this.pos.x += this.vel.x * dt;
    this._resolve(world, top, prevX, this.pos.z);
    this.pos.z += this.vel.z * dt;
    this._resolve(world, top, this.pos.x, prevZ);
    this.pos.y += this.vel.y * dt;

    const g = world.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.62);
    if (this.pos.y <= g) {
      if (this.vel.y < -3 && !this.onGround) ev.landed = -this.vel.y;
      this.pos.y = g;
      this.vel.y = 0;
      this.onGround = true;
    } else if (this.pos.y - g < 0.06 && this.vel.y <= 0 && this.onGround) {
      this.pos.y = g; // am Hang haften
    } else {
      this.onGround = false;
    }
    // Horizontal-Kollision mit Gegenständen (Wände etc.)
    world.pushOut(this.pos, RADIUS, this.pos.y, top());

    const moved = Math.hypot(this.pos.x - prevX, this.pos.z - prevZ);
    this.speed = moved / Math.max(dt, 1e-4);
    if (this.onGround) {
      this.stepDist += moved;
      this.bob += moved * 2.6;
      const stride = this.sprinting ? 2.5 : this.crouch ? 1.6 : 2.0;
      if (this.stepDist > stride) {
        this.stepDist = 0;
        ev.step = true;
      }
    }
    return ev;
  }

  _resolve(world, top, oldX, oldZ) {
    // Steile Klippen blockieren (Stufenhöhe 0.62 m)
    const g = world.groundAt(this.pos.x, this.pos.z, this.pos.y, 0.62);
    if (this.onGround && g - this.pos.y > 0.62) {
      // zurücksetzen
      this.pos.x = oldX;
      this.pos.z = oldZ;
    }
  }

  look(dx, dy, sens) {
    this.yaw -= dx * 0.0022 * sens;
    this.pitch = clamp(this.pitch - dy * 0.0022 * sens, -1.5, 1.5);
  }
}
