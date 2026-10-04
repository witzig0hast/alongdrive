// Seed-basiertes Terrain: Dünen, Felsplateaus, Canyons, Salzebenen.
// Reines JS – wird von Client (Meshes, Physik) und Server (Zombie-KI) genutzt.
import { createNoise2D } from 'simplex-noise';
import { mulberry32, hashString, lerp, smooth, clamp } from '../core/rng.js';

export const CHUNK = 128;
export const SPAWN_FLAT = 130; // Radius um die Garage, in dem das Terrain flach ist

export const SURF = { SAND: 0, ROCK: 1, SALT: 2 };
export const GRIP = [0.78, 1.0, 0.88];

export class Terrain {
  constructor(seed) {
    this.seed = hashString(seed);
    const rng = mulberry32(this.seed);
    this.n = [];
    for (let i = 0; i < 8; i++) this.n.push(createNoise2D(rng));
    this._s = { h: 0, salt: 0, plat: 0, canyon: 0 };
  }

  /** Füllt out mit Höhe + Biomgewichten. */
  sample(x, z, out = this._s) {
    const n = this.n;
    const d = Math.hypot(x, z);
    const flat = smooth(SPAWN_FLAT, SPAWN_FLAT + 140, d); // 0 nahe Spawn, 1 weit weg

    const c = n[0](x * 0.0006, z * 0.0006);
    const salt = smooth(0.38, 0.52, c) * flat;
    const plat = smooth(-0.2, 0.08, n[1](x * 0.0010 + 50, z * 0.0010)) * (1 - salt) * flat;

    // Dünen: lang gezogene Kämme + große Wellen
    const warp = n[2](x * 0.004, z * 0.004) * 30;
    const ridge = 1 - Math.abs(n[3]((x + warp) * 0.011, z * 0.018));
    let dune = ridge * ridge * 6.5 + n[4](x * 0.05, z * 0.05) * 0.5 + n[2](x * 0.0022 + 7, z * 0.0022) * 9 + n[5](x * 0.0075, z * 0.0075) * 3.5;

    // Plateaus: Terrassen mit flachen Tafelbergen
    const t = n[5](x * 0.0032 + 20, z * 0.0032) * 0.5 + 0.5 + n[4](x * 0.011, z * 0.011) * 0.035;
    const s = clamp(t, 0, 0.999) * 4;
    const f = Math.floor(s);
    const fr = s - f;
    const plateau = (f + smooth(0.5, 1, fr)) * 11 + n[6](x * 0.03, z * 0.03) * 0.35;

    // Canyons: schmale Linien in Ridge-Noise
    const r = Math.abs(n[3](x * 0.0017 + 9, z * 0.0017 - 4));
    const canyonMask = 1 - smooth(0.0, 0.06, r);
    const canyon = canyonMask * flat;

    let h = lerp(dune, plateau, plat);
    h -= canyon * (plat * 34 + (1 - plat) * 5);
    // Salzebene: fast flach
    h = lerp(h, -1.2 + n[6](x * 0.02, z * 0.02) * 0.12, salt);
    h *= flat;

    out.h = h;
    out.salt = salt;
    out.plat = plat;
    out.canyon = canyon;
    return out;
  }

  heightAt(x, z) {
    return this.sample(x, z, this._s).h;
  }

  /** Oberflächentyp (Grip) */
  surfaceAt(x, z) {
    const s = this.sample(x, z, this._s);
    if (s.salt > 0.5) return SURF.SALT;
    if (s.plat > 0.55) return SURF.ROCK;
    return SURF.SAND;
  }

  normalAt(x, z, out) {
    const e = 0.6;
    const hl = this.heightAt(x - e, z);
    const hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e);
    const hu = this.heightAt(x, z + e);
    let nx = hl - hr;
    let nz = hd - hu;
    const ny = 2 * e;
    const len = Math.hypot(nx, ny, nz);
    out.x = nx / len;
    out.y = ny / len;
    out.z = nz / len;
    return out;
  }
}
