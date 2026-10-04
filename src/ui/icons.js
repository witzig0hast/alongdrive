// Rendert kleine 3D-Icons der Gegenstände (Inventar/Hotbar) in Data-URLs.
import * as THREE from 'three';
import { ITEM_DEFS } from '../items/defs.js';
import { itemGeometry } from '../items/models.js';
import { vcMaterial } from '../world/prims.js';

const icons = {};
let r = null;

export function itemIcon(type) {
  if (icons[type]) return icons[type];
  try {
    if (!r) {
      const canvas = document.createElement('canvas');
      r = {
        renderer: new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true }),
        scene: new THREE.Scene(),
        cam: new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 20),
        mat: vcMaterial(),
      };
      r.renderer.setSize(96, 96, false);
      r.renderer.setClearColor(0x000000, 0);
      r.scene.add(new THREE.AmbientLight(0xffffff, 1.4));
      const d = new THREE.DirectionalLight(0xffffff, 2.2);
      d.position.set(2, 4, 3);
      r.scene.add(d);
    }
    const g = itemGeometry(type);
    const mesh = new THREE.Mesh(g, r.mat);
    mesh.rotation.set(0.35, -0.7, 0);
    r.scene.add(mesh);
    mesh.updateMatrixWorld();
    const box = new THREE.Box3().setFromObject(mesh);
    const c = box.getCenter(new THREE.Vector3());
    const s = box.getSize(new THREE.Vector3());
    const ext = Math.max(s.x, s.y, s.z) * 0.62;
    r.cam.left = -ext;
    r.cam.right = ext;
    r.cam.top = ext;
    r.cam.bottom = -ext;
    r.cam.position.set(c.x, c.y, c.z + 5);
    r.cam.lookAt(c);
    r.cam.updateProjectionMatrix();
    r.renderer.render(r.scene, r.cam);
    icons[type] = r.renderer.domElement.toDataURL('image/png');
    r.scene.remove(mesh);
  } catch (e) {
    icons[type] = '';
  }
  return icons[type];
}

export function preloadIcons() {
  for (const t of Object.keys(ITEM_DEFS)) itemIcon(t);
}
