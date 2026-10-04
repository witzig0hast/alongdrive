// Überlebenswerte: Gesundheit, Hunger, Durst, Ausdauer, Körpertemperatur
import { clamp } from '../core/rng.js';

export class Vitals {
  constructor() {
    this.health = 100;
    this.hunger = 100; // 100 = satt
    this.thirst = 100;
    this.stamina = 100;
    this.temp = 37;
    this.dead = false;
    this.deathCause = '';
    this.hurtFlash = 0;
    this.exhausted = false;
  }

  damage(amount, cause = 'Verletzungen') {
    if (this.dead || amount <= 0) return;
    this.health -= amount;
    this.hurtFlash = Math.min(1, this.hurtFlash + amount / 30);
    if (this.health <= 0) {
      this.health = 0;
      this.dead = true;
      this.deathCause = cause;
    }
  }

  heal(a) {
    this.health = clamp(this.health + a, 0, 100);
  }

  eat(a) {
    this.hunger = clamp(this.hunger + a, 0, 100);
  }

  drink(a) {
    this.thirst = clamp(this.thirst + a, 0, 100);
    this.temp -= a * 0.012; // Wasser kühlt etwas
  }

  /**
   * ctx: {ambient, sprinting, moving, inCar, carHeated, fireWarmth(0..1), storm}
   */
  update(dt, ctx) {
    if (this.dead) return;
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.4);
    const hot = Math.max(0, ctx.ambient - 30);
    const exert = ctx.sprinting ? 2.2 : ctx.moving ? 1.2 : 1;
    this.hunger = clamp(this.hunger - 0.04 * exert * dt, 0, 100);
    this.thirst = clamp(this.thirst - (0.065 + hot * 0.0075) * exert * dt, 0, 100);

    // Ausdauer
    if (ctx.sprinting) this.stamina = clamp(this.stamina - 16 * dt, 0, 100);
    else this.stamina = clamp(this.stamina + (ctx.moving ? 9 : 16) * dt * (this.thirst > 15 ? 1 : 0.4), 0, 100);
    if (this.stamina <= 0.5) this.exhausted = true;
    if (this.stamina > 25) this.exhausted = false;

    // Temperatur
    let eff = ctx.ambient;
    if (ctx.inCar && ctx.carHeated) eff = eff + (22 - eff) * 0.6;
    else if (ctx.inCar) eff = eff + (22 - eff) * 0.25;
    if (ctx.fireWarmth > 0) eff = eff + (30 - eff) * ctx.fireWarmth * 0.9 + 6 * ctx.fireWarmth;
    let target = 37 + clamp((eff - 21) * (eff < 21 ? 0.12 : 0.085), -5.5, 3.4);
    target += (ctx.sun || 0) * 1.3; // direkte Sonneneinstrahlung (kein Schatten)
    if (ctx.sprinting) target += 0.5;
    this.temp += (target - this.temp) * dt * 0.02;

    // Schäden / Regeneration
    let drain = 0;
    if (this.hunger <= 0) drain += 0.5;
    if (this.thirst <= 0) drain += 0.9;
    if (this.temp > 39.6) {
      drain += (this.temp - 39.6) * 1.4;
      this.thirst = clamp(this.thirst - dt * 0.1, 0, 100);
    }
    if (this.temp < 34.5) drain += (34.5 - this.temp) * 1.1;
    if (drain > 0) {
      this.health -= drain * dt;
      if (this.health <= 0) {
        this.health = 0;
        this.dead = true;
        this.deathCause = this.thirst <= 0 ? 'Verdurstet' : this.hunger <= 0 ? 'Verhungert' : this.temp > 38 ? 'Hitzschlag' : 'Unterkühlung';
      }
    } else if (this.hunger > 40 && this.thirst > 40 && this.temp > 35.5 && this.temp < 38.8) {
      this.health = clamp(this.health + 0.35 * dt, 0, 100);
    }
  }

  toJSON() {
    return { health: this.health, hunger: this.hunger, thirst: this.thirst, stamina: this.stamina, temp: this.temp };
  }

  load(o) {
    Object.assign(this, o);
    this.dead = false;
  }
}
