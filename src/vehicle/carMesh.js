// Prozedurales Low-Poly-Pickup mit Einbau-Slots, Rädern, Lichtern
import * as THREE from 'three';
import { primGeometry, vcMaterial } from '../world/prims.js';
import { ITEM_DEFS } from '../items/defs.js';
import { SLOTS, WHEELS } from './carDef.js';

const BODY = 0x8a3b2b;
const DARK = 0x2a2a2d;
const CHROME = 0xa9afb4;
const SEAT = 0x4a3a2c;

const B = (x, y, z, sx, sy, sz, c, r) => ({ s: 'box', p: [x, y, z], z: [sx, sy, sz], c, r });

export function buildCarMesh() {
  const root = new THREE.Group();
  const mat = vcMaterial();
  const mk = (prims, castShadow = true) => {
    const m = new THREE.Mesh(primGeometry(prims), mat);
    m.castShadow = castShadow;
    m.receiveShadow = true;
    return m;
  };

  // Rahmen, Boden, Ladefläche
  const frame = [
    B(0.55, -0.38, 0, 0.14, 0.2, 5.5, DARK), B(-0.55, -0.38, 0, 0.14, 0.2, 5.5, DARK),
    B(0, -0.38, 0.5, 1.2, 0.08, 0.1, DARK), B(0, -0.38, -0.9, 1.2, 0.08, 0.1, DARK), B(0, -0.38, 2.3, 1.2, 0.08, 0.1, DARK),
    // Kabinenboden
    B(0, -0.24, 0.45, 1.9, 0.07, 1.95, 0x35302a),
    // Ladeflächenboden + Seiten
    B(0, -0.25, -1.62, 1.84, 0.08, 2.2, 0x4a4540),
    B(0.9, 0.12, -1.62, 0.08, 0.62, 2.2, BODY), B(-0.9, 0.12, -1.62, 0.08, 0.62, 2.2, BODY),
    B(0, 0.1, -2.74, 1.84, 0.58, 0.07, BODY),
    B(0, 0.12, -0.58, 1.84, 0.62, 0.07, BODY),
    // Radkästen Ladefläche
    B(0.78, -0.03, -1.6, 0.2, 0.2, 0.9, 0x6e2f22), B(-0.78, -0.03, -1.6, 0.2, 0.2, 0.9, 0x6e2f22),
    // Stoßstangen
    B(0, -0.2, 2.82, 1.9, 0.24, 0.16, CHROME), B(0, -0.2, -2.82, 1.9, 0.22, 0.14, CHROME),
    // Frontpartie: Seitenteile + Kühlergrill-Rahmen
    B(0.94, 0.1, 2.05, 0.07, 0.5, 1.5, BODY), B(-0.94, 0.1, 2.05, 0.07, 0.5, 1.5, BODY),
    B(0, 0.05, 2.78, 1.85, 0.35, 0.06, DARK),
    // Kabine: Säulen, Dach, Rückwand
    B(0.92, 0.55, 1.28, 0.1, 1.0, 0.1, BODY, [0.0, 0, 0]), B(-0.92, 0.55, 1.28, 0.1, 1.0, 0.1, BODY),
    B(0.92, 0.55, -0.5, 0.1, 1.1, 0.12, BODY), B(-0.92, 0.55, -0.5, 0.1, 1.1, 0.12, BODY),
    B(0, 1.08, 0.4, 1.98, 0.08, 2.0, BODY),
    B(0, 0.4, -0.55, 1.8, 0.95, 0.08, BODY),
    // Armaturenbrett
    B(0, 0.12, 1.2, 1.75, 0.3, 0.42, 0x2c2a28), B(0, 0.3, 1.1, 1.7, 0.06, 0.3, 0x1f1d1c),
    // Sitze
    B(0.45, -0.12, 0.2, 0.55, 0.14, 0.55, SEAT), B(0.45, 0.22, -0.02, 0.55, 0.62, 0.12, SEAT),
    B(-0.45, -0.12, 0.2, 0.55, 0.14, 0.55, SEAT), B(-0.45, 0.22, -0.02, 0.55, 0.62, 0.12, SEAT),
    // Schweller
    B(0.97, -0.22, 0.45, 0.06, 0.14, 1.9, DARK), B(-0.97, -0.22, 0.45, 0.06, 0.14, 1.9, DARK),
    // Lenksäule
    B(0.45, 0.25, 0.95, 0.06, 0.06, 0.4, DARK, [0.4, 0, 0]),
  ];
  root.add(mk(frame));

  // Glas
  const glassMat = new THREE.MeshLambertMaterial({ color: 0x7fa6b5, transparent: true, opacity: 0.35, side: THREE.DoubleSide });
  const glass = new THREE.Mesh(
    primGeometry([
      B(0, 0.72, 1.32, 1.75, 0.7, 0.04, 0xffffff, [-0.5, 0, 0]),
      B(0, 0.68, -0.52, 1.7, 0.45, 0.03, 0xffffff),
    ]),
    new THREE.MeshLambertMaterial({ vertexColors: true, color: 0x9fc4d4, transparent: true, opacity: 0.32 }),
  );
  root.add(glass);

  // Scheinwerfer / Rücklichter
  const hlMat = new THREE.MeshBasicMaterial({ color: 0x555a5e });
  const tlMat = new THREE.MeshBasicMaterial({ color: 0x501010 });
  const hl = new THREE.Group();
  for (const x of [0.65, -0.65]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.16, 0.06), hlMat);
    m.position.set(x, 0.12, 2.8);
    hl.add(m);
  }
  const tl = new THREE.Group();
  for (const x of [0.78, -0.78]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.14, 0.05), tlMat);
    m.position.set(x, 0.16, -2.78);
    tl.add(m);
  }
  root.add(hl, tl);

  // Lenkrad
  const steer = new THREE.Group();
  steer.position.set(0.45, 0.36, 0.78);
  steer.rotation.x = -0.9;
  const wheelMesh = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.02, 6, 14), new THREE.MeshLambertMaterial({ color: 0x1c1c1c }));
  steer.add(wheelMesh);
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.02, 0.02), new THREE.MeshLambertMaterial({ color: 0x1c1c1c }));
  steer.add(spoke);
  root.add(steer);

  // Einbauteile: nutzen die Gegenstandsmodelle
  const parts = {};
  const itemGeoCache = {};
  for (const [id, s] of Object.entries(SLOTS)) {
    if (id.startsWith('wheel')) continue;
    const t = s.item;
    itemGeoCache[t] ||= primGeometry(ITEM_DEFS[t].prims);
    const m = new THREE.Mesh(itemGeoCache[t], mat);
    m.castShadow = true;
    m.position.set(...s.pos);
    if (id === 'doorR') m.scale.x = -1;
    if (id === 'tank') m.position.y += 0.1;
    if (id === 'radiator') m.rotation.y = 0;
    if (id === 'plugs') m.position.y = 0.4;
    m.visible = false;
    root.add(m);
    parts[id] = m;
  }

  // Räder
  const wheels = {};
  const wheelGeo = primGeometry(ITEM_DEFS.wheel.prims);
  for (const w of WHEELS) {
    const pivot = new THREE.Group();
    pivot.position.set(w.pos[0], w.pos[1] - 0.4, w.pos[2]);
    const spin = new THREE.Group();
    const mesh = new THREE.Mesh(wheelGeo, mat);
    mesh.castShadow = true;
    if (w.pos[0] < 0) mesh.rotation.y = Math.PI;
    spin.add(mesh);
    pivot.add(spin);
    pivot.visible = false;
    root.add(pivot);
    wheels[w.id] = { pivot, spin, base: new THREE.Vector3(...w.pos) };
  }

  // Bockstützen (bis alle Räder drauf sind)
  const stands = new THREE.Group();
  for (const [x, z] of [[0.85, 1.7], [-0.85, 1.7], [0.85, -1.6], [-0.85, -1.6]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.46, 0.4), new THREE.MeshLambertMaterial({ color: 0x7c7c76 }));
    m.position.set(x, -0.62, z);
    stands.add(m);
  }
  root.add(stands);

  // Geister-Markierungen der Einbaupunkte
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x6cf0b0, transparent: true, opacity: 0.28, depthWrite: false });
  const ghostMatBad = new THREE.MeshBasicMaterial({ color: 0xf0b06c, transparent: true, opacity: 0.2, depthWrite: false });
  const ghosts = {};
  for (const [id, s] of Object.entries(SLOTS)) {
    const g = new THREE.Mesh(new THREE.BoxGeometry(...s.ghost), ghostMat);
    g.position.set(...s.pos);
    g.visible = false;
    g.renderOrder = 5;
    root.add(g);
    ghosts[id] = g;
  }

  // Motor-/Rauchposition
  const smokeAnchor = new THREE.Object3D();
  smokeAnchor.position.set(0, 0.4, 2.2);
  root.add(smokeAnchor);

  return { root, parts, wheels, stands, ghosts, ghostMat, ghostMatBad, steer, hlMat, tlMat, smokeAnchor };
}
