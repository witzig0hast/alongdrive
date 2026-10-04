// Deterministische Zufallshilfen (rein, ohne DOM/Three – wird auch vom Server genutzt)
export function hashString(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(a) {
  a >>>= 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash3(seed, a, b, c = 0) {
  let h = seed >>> 0;
  h = Math.imul(h ^ (a | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (b | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h ^ (c | 0), 0x27d4eb2f);
  h ^= h >>> 15;
  return h >>> 0;
}

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
export const TAU = Math.PI * 2;

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

export function pickWeighted(rng, table) {
  let total = 0;
  for (const [, w] of table) total += w;
  let r = rng() * total;
  for (const [v, w] of table) {
    r -= w;
    if (r <= 0) return v;
  }
  return table[table.length - 1][0];
}

export function randomSeedString() {
  const words = ['dune', 'ash', 'salt', 'rust', 'dust', 'mirage', 'bone', 'ember', 'sun', 'echo', 'scorch', 'viper'];
  return words[(Math.random() * words.length) | 0] + '-' + ((Math.random() * 9000 + 1000) | 0);
}
