// Geometrie-Cache + Materialien für Gegenstände (geteilt => wenige Draw-Calls/Speicher)
import * as THREE from 'three';
import { ITEM_DEFS } from './defs.js';
import { primGeometry, vcMaterial } from '../world/prims.js';

const cache = new Map();
export const itemMaterial = vcMaterial();
export const itemMaterialVM = vcMaterial(); // Viewmodel (eigene Szene, kein Nebel)
itemMaterialVM.fog = false;

export function itemGeometry(type) {
  let g = cache.get(type);
  if (!g) {
    g = primGeometry(ITEM_DEFS[type].prims);
    g.computeBoundingSphere();
    cache.set(type, g);
  }
  return g;
}

export function makeItemMesh(type, vm = false) {
  const m = new THREE.Mesh(itemGeometry(type), vm ? itemMaterialVM : itemMaterial);
  m.castShadow = !vm;
  m.receiveShadow = !vm;
  return m;
}
