// Tageszeit, Klima und Sandstürme (rein deterministisch aus Seed + Spielzeit)
import { mulberry32, hash3, hashString, smooth, clamp } from '../core/rng.js';

export const DAY_LENGTH = 1200; // Sekunden pro Tag
export const START_HOUR = 7;
const STORM_SLOT = 420;

export function hourOf(gameTime) {
  return (START_HOUR + (gameTime / DAY_LENGTH) * 24) % 24;
}

export function dayOf(gameTime) {
  return Math.floor((START_HOUR + (gameTime / DAY_LENGTH) * 24) / 24) + 1;
}

export function stormIntensity(seedStr, gameTime) {
  const seed = hashString(seedStr);
  let best = 0;
  const slot = Math.floor(gameTime / STORM_SLOT);
  for (let k = slot - 1; k <= slot; k++) {
    if (k < 1) continue;
    const r = mulberry32(hash3(seed, k, 99));
    if (r() > 0.4) continue;
    const start = k * STORM_SLOT + r() * 160;
    const dur = 70 + r() * 110;
    const t = gameTime - start;
    if (t < 0 || t > dur) continue;
    const env = smooth(0, 18, t) * (1 - smooth(dur - 25, dur, t));
    best = Math.max(best, env);
  }
  return best;
}

/** Außentemperatur in °C */
export function ambientTemp(hour, storm = 0) {
  const t = 18 + 21 * Math.cos(((hour - 14.5) / 24) * Math.PI * 2);
  return t - storm * 7;
}

export function sunElevation(hour) {
  return Math.sin(((hour - 6) / 12) * Math.PI);
}

export function sunDirection(hour, out) {
  const a = ((hour - 6) / 12) * Math.PI;
  const x = Math.cos(a);
  const y = Math.sin(a);
  const z = 0.35;
  const l = Math.hypot(x, y, z);
  out.x = x / l;
  out.y = y / l;
  out.z = z / l;
  return out;
}
