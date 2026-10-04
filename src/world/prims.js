// Primitive-Beschreibungen -> ein zusammengeführtes, vertexgefärbtes BufferGeometry.
// Alle Modelle (POIs, Gegenstände, Auto, Zombies) werden daraus prozedural gebaut.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

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

/**
 * Prim: {s:'box'|'cyl'|'cone'|'sph', p:[x,y,z] Mitte, z:[sx,sy,sz] (cyl/cone: Radius,Höhe,Radius), r:[rx,ry,rz], c:0xRRGGBB}
 */
export function primGeometry(prims) {
  const parts = [];
  for (const pr of prims) {
    const g = (base[pr.s] || base.box).clone();
    g.deleteAttribute('uv');
    tmpE.set(pr.r ? pr.r[0] : 0, pr.r ? pr.r[1] : 0, pr.r ? pr.r[2] : 0);
    tmpQ.setFromEuler(tmpE);
    const z = pr.z || [1, 1, 1];
    if (pr.s === 'cyl' || pr.s === 'cyl6' || pr.s === 'cone') tmpS.set(z[0], z[1], z[2] ?? z[0]);
    else tmpS.set(z[0], z[1], z[2]);
    tmpV.set(pr.p[0], pr.p[1], pr.p[2]);
    tmpM.compose(tmpV, tmpQ, tmpS);
    g.applyMatrix4(tmpM);
    tmpC.setHex(pr.c ?? 0x888888);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      // leichte Variation je Vertex-Gruppe für Low-Poly-Look
      col[i * 3] = tmpC.r;
      col[i * 3 + 1] = tmpC.g;
      col[i * 3 + 2] = tmpC.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
  }
  if (!parts.length) return new THREE.BufferGeometry();
  const merged = mergeGeometries(parts, false);
  for (const p of parts) p.dispose();
  return merged;
}

export const vcMaterial = (opts = {}) =>
  new THREE.MeshLambertMaterial({ vertexColors: true, ...opts });

/** Hilfsfunktion: Prims relativ verschieben/drehen (für zusammengesetzte Modelle). */
export function transformPrims(prims, ox, oy, oz) {
  return prims.map((p) => ({ ...p, p: [p.p[0] + ox, p.p[1] + oy, p.p[2] + oz] }));
}
