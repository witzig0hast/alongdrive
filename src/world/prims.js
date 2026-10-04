// Primitive-Beschreibungen -> ein zusammengeführtes, vertexgefärbtes BufferGeometry.
// Alle Modelle (POIs, Gegenstände, Auto, Zombies) werden daraus prozedural gebaut.
import * as THREE from 'three';

const base = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 10),
  cyl6: new THREE.CylinderGeometry(1, 1, 1, 6),
  cone: new THREE.ConeGeometry(1, 1, 8),
  sph: new THREE.SphereGeometry(1, 8, 6),
};
const tmpM = new THREE.Matrix4();
const tmpQ = new THREE.Quaternion();
const tmpE = new THREE.Euler();
const tmpV = new THREE.Vector3();
const tmpS = new THREE.Vector3();
const tmpC = new THREE.Color();

const baseData = {};
function getBase(shape) {
  let d = baseData[shape];
  if (!d) {
    const g = base[shape] || base.box;
    d = baseData[shape] = { pos: g.attributes.position.array, nor: g.attributes.normal.array, idx: g.index ? g.index.array : null, n: g.attributes.position.count };
  }
  return d;
}
const _nm = new THREE.Matrix3();

/**
 * Prim: {s:'box'|'cyl'|'cone'|'sph', p:[x,y,z] Mitte, z:[sx,sy,sz] (cyl/cone: Radius,Höhe,Radius), r:[rx,ry,rz], c:0xRRGGBB}
 * Schnell: schreibt transformierte Vertices direkt in gemeinsame Typed Arrays (ohne Zwischen-Geometrien).
 */
export function primGeometry(prims) {
  if (!prims.length) return new THREE.BufferGeometry();
  let nv = 0;
  let ni = 0;
  for (const pr of prims) {
    const d = getBase(pr.s);
    nv += d.n;
    ni += d.idx ? d.idx.length : d.n;
  }
  const pos = new Float32Array(nv * 3);
  const nor = new Float32Array(nv * 3);
  const col = new Float32Array(nv * 3);
  const idx = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0;
  let io = 0;
  for (const pr of prims) {
    const d = getBase(pr.s);
    tmpE.set(pr.r ? pr.r[0] : 0, pr.r ? pr.r[1] : 0, pr.r ? pr.r[2] : 0);
    tmpQ.setFromEuler(tmpE);
    const z = pr.z || [1, 1, 1];
    tmpS.set(z[0], z[1], z[2] ?? z[0]);
    tmpV.set(pr.p[0], pr.p[1], pr.p[2]);
    tmpM.compose(tmpV, tmpQ, tmpS);
    _nm.getNormalMatrix(tmpM);
    const e = tmpM.elements;
    const ne = _nm.elements;
    tmpC.setHex(pr.c ?? 0x888888);
    for (let i = 0; i < d.n; i++) {
      const x = d.pos[i * 3];
      const y = d.pos[i * 3 + 1];
      const zz = d.pos[i * 3 + 2];
      const o = (vo + i) * 3;
      pos[o] = e[0] * x + e[4] * y + e[8] * zz + e[12];
      pos[o + 1] = e[1] * x + e[5] * y + e[9] * zz + e[13];
      pos[o + 2] = e[2] * x + e[6] * y + e[10] * zz + e[14];
      const nx = d.nor[i * 3];
      const ny = d.nor[i * 3 + 1];
      const nz = d.nor[i * 3 + 2];
      let ax = ne[0] * nx + ne[3] * ny + ne[6] * nz;
      let ay = ne[1] * nx + ne[4] * ny + ne[7] * nz;
      let az = ne[2] * nx + ne[5] * ny + ne[8] * nz;
      const l = Math.hypot(ax, ay, az) || 1;
      nor[o] = ax / l;
      nor[o + 1] = ay / l;
      nor[o + 2] = az / l;
      col[o] = tmpC.r;
      col[o + 1] = tmpC.g;
      col[o + 2] = tmpC.b;
    }
    if (d.idx) for (let i = 0; i < d.idx.length; i++) idx[io++] = d.idx[i] + vo;
    else for (let i = 0; i < d.n; i++) idx[io++] = vo + i;
    vo += d.n;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  g.computeBoundingBox();
  return g;
}

export const vcMaterial = (opts = {}) =>
  new THREE.MeshLambertMaterial({ vertexColors: true, ...opts });

/** Hilfsfunktion: Prims relativ verschieben/drehen (für zusammengesetzte Modelle). */
export function transformPrims(prims, ox, oy, oz) {
  return prims.map((p) => ({ ...p, p: [p.p[0] + ox, p.p[1] + oy, p.p[2] + oz] }));
}
