// Endloses Chunk-System (Client): lädt/entlädt Chunks um den Spieler, baut Terrain-Meshes mit LOD,
// Instancing für Felsen und Pflanzen, verwaltet Collider-Abfragen.
import * as THREE from 'three';
import { Terrain, CHUNK, SURF } from './heightfield.js';
import { genChunk, chunkKey } from './worldgen.js';
import { primGeometry, vcMaterial } from './prims.js';
import { circleVs, colliderBounds, pointInside } from './collision.js';
import { smooth, lerp, mulberry32 } from '../core/rng.js';

const SAND = [0.82, 0.68, 0.47];
const SAND_DARK = [0.7, 0.55, 0.38];
const ROCKS = [[0.66, 0.44, 0.31], [0.74, 0.52, 0.36], [0.57, 0.4, 0.3], [0.8, 0.6, 0.42]];
const SALT = [0.93, 0.92, 0.88];

function makeDetailTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const img = g.createImageData(128, 128);
  const r = mulberry32(1234);
  for (let i = 0; i < 128 * 128; i++) {
    const v = 200 + r() * 55;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  t.anisotropy = 4;
  return t;
}

function rockGeometry(seed) {
  const g = new THREE.IcosahedronGeometry(1, 1);
  const r = mulberry32(seed);
  const pos = g.attributes.position;
  const map = new Map();
  for (let i = 0; i < pos.count; i++) {
    const k = pos.getX(i).toFixed(3) + pos.getY(i).toFixed(3) + pos.getZ(i).toFixed(3);
    if (!map.has(k)) map.set(k, 0.75 + r() * 0.5);
    const s = map.get(k);
    pos.setXYZ(i, pos.getX(i) * s, pos.getY(i) * s * 0.9, pos.getZ(i) * s);
  }
  g.computeVertexNormals();
  return g;
}

function plantGeometries() {
  const bush = primGeometry([
    { s: 'sph', p: [0, 0.3, 0], z: [0.45, 0.3, 0.45], c: 0x6b5a34 },
    { s: 'cone', p: [0.2, 0.35, 0.1], z: [0.12, 0.8, 0.12], r: [0.3, 0, -0.5], c: 0x5a4a2b },
    { s: 'cone', p: [-0.2, 0.35, -0.1], z: [0.1, 0.7, 0.1], r: [-0.3, 0, 0.5], c: 0x5a4a2b },
  ]);
  const cactus = primGeometry([
    { s: 'cyl', p: [0, 0.9, 0], z: [0.18, 1.8, 0.18], c: 0x5d7a3e },
    { s: 'cyl', p: [0.4, 1.1, 0], z: [0.1, 0.8, 0.1], c: 0x5d7a3e },
    { s: 'box', p: [0.22, 0.75, 0], z: [0.4, 0.14, 0.14], c: 0x5d7a3e },
    { s: 'cyl', p: [-0.38, 1.3, 0], z: [0.09, 0.7, 0.09], c: 0x5d7a3e },
    { s: 'box', p: [-0.2, 1.0, 0], z: [0.38, 0.13, 0.13], c: 0x5d7a3e },
  ]);
  const deadtree = primGeometry([
    { s: 'cyl6', p: [0, 1.4, 0], z: [0.14, 2.8, 0.14], c: 0x4a3c2d },
    { s: 'cyl6', p: [0.5, 2.3, 0], z: [0.07, 1.4, 0.07], r: [0, 0, -0.9], c: 0x4a3c2d },
    { s: 'cyl6', p: [-0.4, 2.0, 0.2], z: [0.06, 1.2, 0.06], r: [0.3, 0, 0.8], c: 0x4a3c2d },
    { s: 'cyl6', p: [0.1, 2.9, -0.3], z: [0.05, 1.0, 0.05], r: [0.6, 0, 0.2], c: 0x4a3c2d },
  ]);
  return { bush, cactus, deadtree };
}

class Chunk {
  constructor(world, cx, cz) {
    this.world = world;
    this.cx = cx;
    this.cz = cz;
    this.key = chunkKey(cx, cz);
    this.group = new THREE.Group();
    this.group.position.set(cx * CHUNK, 0, cz * CHUNK);
    this.terrainMesh = null;
    this.lod = -1;
    this.content = null;
    this.disposables = [];
    this.centerX = cx * CHUNK + CHUNK / 2;
    this.centerZ = cz * CHUNK + CHUNK / 2;
  }

  buildContent() {
    const w = this.world;
    const c = (this.content = genChunk(w.terrain, w.terrain.seed, this.cx, this.cz));
    for (const col of c.colliders) col.bb = colliderBounds(col);
    // statische Prims in einem Mesh (Koordinaten chunk-lokal)
    if (c.prims.length) {
      const local = c.prims.map((p) => ({ ...p, p: [p.p[0] - c.x0, p.p[1], p.p[2] - c.z0] }));
      const mesh = new THREE.Mesh(primGeometry(local), w.structMat);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.group.add(mesh);
      this.disposables.push(mesh.geometry);
    }
    // Felsen
    if (c.rocks.length) {
      const byVar = [[], [], []];
      for (const r of c.rocks) byVar[r.v].push(r);
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      const col = new THREE.Color();
      for (let v = 0; v < 3; v++) {
        const arr = byVar[v];
        if (!arr.length) continue;
        const im = new THREE.InstancedMesh(w.rockGeos[v], w.rockMat, arr.length);
        arr.forEach((r, i) => {
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r.ry);
          m.compose(new THREE.Vector3(r.x - c.x0, r.y + r.sy * 0.5, r.z - c.z0), q, new THREE.Vector3(r.sx, r.sy, r.sz));
          im.setMatrixAt(i, m);
          const base = ROCKS[(i + v) % ROCKS.length];
          const sh = r.shade;
          col.setRGB(lerp(0.7, base[0], r.plat) * sh, lerp(0.58, base[1], r.plat) * sh, lerp(0.45, base[2], r.plat) * sh);
          im.setColorAt(i, col);
        });
        im.castShadow = true;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        this.group.add(im);
        this.disposables.push(im);
      }
    }
    // Pflanzen
    if (c.plants.length) {
      for (const type of ['bush', 'cactus', 'deadtree']) {
        const arr = c.plants.filter((p) => p.type === type);
        if (!arr.length) continue;
        const im = new THREE.InstancedMesh(w.plantGeos[type], w.structMat, arr.length);
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        arr.forEach((p, i) => {
          q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.ry);
          m.compose(new THREE.Vector3(p.x - c.x0, p.y - 0.05, p.z - c.z0), q, new THREE.Vector3(p.s, p.s, p.s));
          im.setMatrixAt(i, m);
        });
        im.castShadow = type !== 'bush';
        im.computeBoundingSphere();
        this.group.add(im);
        this.disposables.push(im);
      }
    }
  }

  buildTerrain(segs) {
    const w = this.world;
    const T = w.terrain;
    const step = CHUNK / segs;
    const n1 = segs + 1;
    const x0 = this.cx * CHUNK;
    const z0 = this.cz * CHUNK;
    // Höhengitter mit 1 Zelle Rand für Normalen
    const pn = segs + 3;
    const H = new Float32Array(pn * pn);
    const PL = new Float32Array(pn * pn);
    const SA = new Float32Array(pn * pn);
    const CA = new Float32Array(pn * pn);
    const S = {};
    const posN = n1 * n1;
    const skirts = 4 * segs;
    const total = posN + skirts * 2 + 4 * 2;
    const pos = new Float32Array(total * 3);
    const nor = new Float32Array(total * 3);
    const col = new Float32Array(total * 3);
    const uv = new Float32Array(total * 2);
    for (let j = 0; j < pn; j++) {
      for (let i = 0; i < pn; i++) {
        T.sample(x0 + (i - 1) * step, z0 + (j - 1) * step, S);
        const k = j * pn + i;
        H[k] = S.h;
        PL[k] = S.plat;
        SA[k] = S.salt;
        CA[k] = S.canyon;
      }
    }
    const tmp = [0, 0, 0];
    for (let j = 0; j < n1; j++) {
      for (let i = 0; i < n1; i++) {
        const idx = j * n1 + i;
        const wx = x0 + i * step;
        const wz = z0 + j * step;
        const h = H[(j + 1) * pn + (i + 1)];
        const hl = H[(j + 1) * pn + i];
        const hr = H[(j + 1) * pn + i + 2];
        const hd = H[j * pn + i + 1];
        const hu = H[(j + 2) * pn + i + 1];
        let nx = hl - hr;
        let nz = hd - hu;
        let ny = 2 * step;
        const len = Math.hypot(nx, ny, nz);
        nx /= len;
        ny /= len;
        nz /= len;
        pos[idx * 3] = i * step;
        pos[idx * 3 + 1] = h;
        pos[idx * 3 + 2] = j * step;
        nor[idx * 3] = nx;
        nor[idx * 3 + 1] = ny;
        nor[idx * 3 + 2] = nz;
        uv[idx * 2] = wx / 9;
        uv[idx * 2 + 1] = wz / 9;
        const k = (j + 1) * pn + (i + 1);
        S.plat = PL[k];
        S.salt = SA[k];
        S.canyon = CA[k];
        terrainColor(T, wx, wz, h, ny, S, tmp);
        col[idx * 3] = tmp[0];
        col[idx * 3 + 1] = tmp[1];
        col[idx * 3 + 2] = tmp[2];
      }
    }
    // Skirts (verdecken LOD-Nähte)
    const idxArr = [];
    for (let j = 0; j < segs; j++) {
      for (let i = 0; i < segs; i++) {
        const a = j * n1 + i;
        const b = a + 1;
        const c = a + n1;
        const d = c + 1;
        idxArr.push(a, c, b, b, c, d);
      }
    }
    let sv = posN;
    const edge = [];
    for (let i = 0; i < n1; i++) edge.push([i, 0, 0]); // vorne z=0
    const addSkirt = (list) => {
      const base = sv;
      for (const vi of list) {
        const o = vi * 3;
        pos[sv * 3] = pos[o];
        pos[sv * 3 + 1] = pos[o + 1] - 3.5;
        pos[sv * 3 + 2] = pos[o + 2];
        nor[sv * 3] = nor[o];
        nor[sv * 3 + 1] = nor[o + 1];
        nor[sv * 3 + 2] = nor[o + 2];
        col[sv * 3] = col[o];
        col[sv * 3 + 1] = col[o + 1];
        col[sv * 3 + 2] = col[o + 2];
        uv[sv * 2] = uv[vi * 2];
        uv[sv * 2 + 1] = uv[vi * 2 + 1];
        sv++;
      }
      for (let k = 0; k < list.length - 1; k++) {
        const a = list[k];
        const b = list[k + 1];
        idxArr.push(a, base + k, b, b, base + k, base + k + 1);
        idxArr.push(b, base + k, a, base + k + 1, base + k, b); // doppelseitig
      }
    };
    const rowTop = [];
    const rowBot = [];
    const colL = [];
    const colR = [];
    for (let i = 0; i < n1; i++) {
      rowTop.push(i);
      rowBot.push(segs * n1 + i);
      colL.push(i * n1);
      colR.push(i * n1 + segs);
    }
    addSkirt(rowTop);
    addSkirt(rowBot);
    addSkirt(colL);
    addSkirt(colR);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, sv * 3), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor.subarray(0, sv * 3), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col.subarray(0, sv * 3), 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv.subarray(0, sv * 2), 2));
    geo.setIndex(idxArr);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(CHUNK / 2, 20, CHUNK / 2), CHUNK * 0.9 + 60);
    geo.boundingBox = new THREE.Box3(new THREE.Vector3(0, -80, 0), new THREE.Vector3(CHUNK, 120, CHUNK));
    if (this.terrainMesh) {
      this.group.remove(this.terrainMesh);
      this.terrainMesh.geometry.dispose();
    }
    this.terrainMesh = new THREE.Mesh(geo, this.world.terrainMat);
    this.terrainMesh.receiveShadow = true;
    this.group.add(this.terrainMesh);
    this.lod = segs;
  }

  dispose() {
    if (this.terrainMesh) this.terrainMesh.geometry.dispose();
    for (const d of this.disposables) d.dispose?.();
    this.group.removeFromParent();
  }
}

const hash2 = (x, y) => {
  const s = Math.sin(Math.floor(x) * 12.9898 + Math.floor(y) * 78.233) * 43758.5453;
  return s - Math.floor(s);
};
function terrainColor(T, x, z, h, ny, S, out) {
  const nv = T.n[4](x * 0.09, z * 0.09) * 0.5 + 0.5;
  const nv2 = hash2(x * 0.6, z * 0.6);
  let r = lerp(SAND_DARK[0], SAND[0], nv);
  let g = lerp(SAND_DARK[1], SAND[1], nv);
  let b = lerp(SAND_DARK[2], SAND[2], nv);
  const slope = 1 - ny;
  // Felsschichten
  const strata = Math.floor(h * 0.55 + T.n[6](x * 0.01, z * 0.01) * 2) & 3;
  const rock = ROCKS[strata];
  const rockMix = Math.min(1, S.plat * 0.9 + smooth(0.18, 0.5, slope) * 0.85 + S.canyon * 0.6);
  r = lerp(r, rock[0], rockMix);
  g = lerp(g, rock[1], rockMix);
  b = lerp(b, rock[2], rockMix);
  r = lerp(r, SALT[0], S.salt);
  g = lerp(g, SALT[1], S.salt);
  b = lerp(b, SALT[2], S.salt);
  const v = 0.93 + nv2 * 0.12;
  out[0] = r * v;
  out[1] = g * v;
  out[2] = b * v;
}

export class World {
  constructor(scene, seed, quality) {
    this.scene = scene;
    this.seedStr = seed;
    this.terrain = new Terrain(seed);
    this.chunks = new Map();
    this.radius = 5;
    this.quality = quality;
    this.root = new THREE.Group();
    scene.add(this.root);
    this.terrainMat = new THREE.MeshLambertMaterial({ vertexColors: true, map: makeDetailTexture() });
    this.structMat = vcMaterial();
    this.rockMat = new THREE.MeshLambertMaterial({ flatShading: true });
    this.rockGeos = [rockGeometry(11), rockGeometry(22), rockGeometry(33)];
    this.plantGeos = plantGeometries();
    this.dynamic = []; // dynamische Collider (Auto, Lagerfeuer …)
    this.onChunkLoaded = null;
    this.onChunkUnloaded = null;
    this._queue = [];
    this.stats = { chunks: 0 };
  }

  lodFor(d) {
    const l = this.quality.lod;
    if (d <= 1) return l ? 32 : 48;
    if (d <= 2) return l ? 16 : 32;
    if (d <= 4) return l ? 12 : 16;
    return l ? 8 : 12;
  }

  heightAt(x, z) {
    return this.terrain.heightAt(x, z);
  }

  getChunk(cx, cz) {
    return this.chunks.get(chunkKey(cx, cz));
  }

  /**
   * Lädt/entlädt Chunks um (px,pz). Pro Aufruf werden höchstens `budget` "schwere" Schritte ausgeführt
   * (Terrain-Mesh eines neuen Chunks > Inhalt eines neuen Chunks > LOD-Wechsel), damit keine Ruckler entstehen.
   * Gibt die Anzahl offener Arbeiten zurück.
   */
  update(px, pz, budget = 1) {
    const pcx = Math.floor(px / CHUNK);
    const pcz = Math.floor(pz / CHUNK);
    const R = this.radius;
    for (const [key, ch] of this.chunks) {
      const d = Math.max(Math.abs(ch.cx - pcx), Math.abs(ch.cz - pcz));
      if (d > R + 1) {
        this.onChunkUnloaded?.(ch);
        ch.dispose();
        this.chunks.delete(key);
      }
    }
    const t0 = performance.now();
    let ops = 0;
    let pending = 0;
    // 1) Terrain-Meshes für neu erzeugte Chunks
    let needTerrain = [];
    for (const ch of this.chunks.values()) if (ch.lod < 0) needTerrain.push(ch);
    needTerrain.sort((a, b) => (a.cx - pcx) ** 2 + (a.cz - pcz) ** 2 - ((b.cx - pcx) ** 2 + (b.cz - pcz) ** 2));
    for (const ch of needTerrain) {
      if (ops >= budget) {
        pending++;
        continue;
      }
      const tt = performance.now();
      ch.buildTerrain(this.lodFor(Math.max(Math.abs(ch.cx - pcx), Math.abs(ch.cz - pcz))));
      this.stats.maxTerrain = Math.max(this.stats.maxTerrain || 0, performance.now() - tt);
      ops++;
    }
    // 2) fehlende Chunks (nahe zuerst)
    const missing = [];
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dz * dz > (R + 0.5) * (R + 0.5)) continue;
        const cx = pcx + dx;
        const cz = pcz + dz;
        if (!this.chunks.has(chunkKey(cx, cz))) missing.push([cx, cz, dx * dx + dz * dz]);
      }
    }
    missing.sort((a, b) => a[2] - b[2]);
    for (const [cx, cz] of missing) {
      if (ops >= budget) {
        pending++;
        continue;
      }
      const ch = new Chunk(this, cx, cz);
      const tc = performance.now();
      ch.buildContent();
      this.stats.maxContent = Math.max(this.stats.maxContent || 0, performance.now() - tc);
      this.root.add(ch.group);
      this.chunks.set(ch.key, ch);
      this.onChunkLoaded?.(ch);
      ops++;
      pending++; // Terrain-Mesh folgt im nächsten Schritt
    }
    // 3) LOD-Wechsel
    if (ops < budget) {
      for (const ch of this.chunks.values()) {
        if (ch.lod < 0) continue;
        const want = this.lodFor(Math.max(Math.abs(ch.cx - pcx), Math.abs(ch.cz - pcz)));
        if (want !== ch.lod) {
          if (ops >= budget) {
            pending++;
            break;
          }
          ch.buildTerrain(want);
          ops++;
        }
      }
    }
    const ms = performance.now() - t0;
    this.stats.lastMs = ms;
    if (ops) this.stats.maxMs = Math.max(this.stats.maxMs || 0, ms);
    this.stats.chunks = this.chunks.size;
    this.stats.pending = pending;
    return pending;
  }

  /** Lädt synchron alles im Radius (Ladebildschirm) */
  preload(px, pz, radius = 2) {
    const old = this.radius;
    this.radius = radius;
    let guard = 0;
    while (this.update(px, pz, 6) > 0 && guard++ < 400);
    this.radius = old;
  }

  /** Iteriert Collider im Umkreis (x,z,r) inkl. dynamischer Collider. */
  queryColliders(x, z, r, cb) {
    const cx = Math.floor(x / CHUNK);
    const cz = Math.floor(z / CHUNK);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const ch = this.chunks.get(chunkKey(cx + dx, cz + dz));
        if (!ch) continue;
        for (const c of ch.content.colliders) {
          const bb = c.bb;
          if (x + r < bb[0] || x - r > bb[2] || z + r < bb[1] || z - r > bb[3]) continue;
          cb(c);
        }
      }
    }
    for (const c of this.dynamic) {
      if (!c.bb) c.bb = colliderBounds(c);
      cb(c);
    }
  }

  /** Höchster tragender Untergrund an (x,z) unter yRef+step (Terrain oder Collider-Oberseite). */
  groundAt(x, z, yRef = 1e9, step = 0.6, skipDynamic = false) {
    let g = this.terrain.heightAt(x, z);
    this.queryColliders(x, z, 0.01, (c) => {
      if (skipDynamic && c.dyn) return;
      if (c.y1 <= yRef + step && c.y1 > g && pointInside(c, x, z)) g = c.y1;
    });
    return g;
  }

  surfaceAt(x, z) {
    return this.terrain.surfaceAt(x, z);
  }

  /** Bewegt einen Kreis aus Collidern heraus. Gibt true bei Kollision. */
  pushOut(pos, r, yFeet, yTop, skip) {
    let hit = false;
    for (let iter = 0; iter < 2; iter++) {
      this.queryColliders(pos.x, pos.z, r + 0.1, (c) => {
        if (c === skip) return;
        if (yFeet >= c.y1 - 0.55 || yTop <= c.y0) return; // darüber (Stufe) / darunter
        const o = circleVs(c, pos.x, pos.z, r);
        if (o) {
          pos.x += o.nx * o.pen;
          pos.z += o.nz * o.pen;
          hit = true;
        }
      });
    }
    return hit;
  }

  dispose() {
    for (const ch of this.chunks.values()) ch.dispose();
    this.chunks.clear();
    this.scene.remove(this.root);
    this.terrainMat.map?.dispose();
    this.terrainMat.dispose();
    this.structMat.dispose();
    this.rockMat.dispose();
    for (const g of this.rockGeos) g.dispose();
    for (const k in this.plantGeos) this.plantGeos[k].dispose();
  }
}
