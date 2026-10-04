// Kollisionsprimitive (rein 2D-Footprint + Höhenbereich), auch vom Server genutzt.
// Collider: {t:'obb', x,z,hx,hz,ry,y0,y1} | {t:'cyl', x,z,r,y0,y1}

const out = { nx: 0, nz: 0, pen: 0 };

/** Prüft Kreis (px,pz,r) gegen Collider. Liefert out {nx,nz,pen} oder null. */
export function circleVs(c, px, pz, r) {
  if (c.t === 'cyl') {
    const dx = px - c.x;
    const dz = pz - c.z;
    const d = Math.hypot(dx, dz);
    const pen = c.r + r - d;
    if (pen <= 0) return null;
    if (d < 1e-5) {
      out.nx = 1;
      out.nz = 0;
    } else {
      out.nx = dx / d;
      out.nz = dz / d;
    }
    out.pen = pen;
    return out;
  }
  // OBB
  const cos = Math.cos(c.ry);
  const sin = Math.sin(c.ry);
  const dx = px - c.x;
  const dz = pz - c.z;
  // in lokale Koordinaten drehen (Rotation um -ry)
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  const cx = Math.max(-c.hx, Math.min(c.hx, lx));
  const cz = Math.max(-c.hz, Math.min(c.hz, lz));
  let ox = lx - cx;
  let oz = lz - cz;
  let d2 = ox * ox + oz * oz;
  let nlx;
  let nlz;
  let pen;
  if (d2 > 1e-10) {
    const d = Math.sqrt(d2);
    pen = r - d;
    if (pen <= 0) return null;
    nlx = ox / d;
    nlz = oz / d;
  } else {
    // Zentrum im Inneren: kleinste Eindringtiefe
    const px1 = c.hx - Math.abs(lx);
    const pz1 = c.hz - Math.abs(lz);
    if (px1 < pz1) {
      nlx = lx >= 0 ? 1 : -1;
      nlz = 0;
      pen = px1 + r;
    } else {
      nlx = 0;
      nlz = lz >= 0 ? 1 : -1;
      pen = pz1 + r;
    }
  }
  // zurück in Weltkoordinaten (Rotation um +ry)
  out.nx = nlx * cos + nlz * sin;
  out.nz = -nlx * sin + nlz * cos;
  out.pen = pen;
  return out;
}

/** Liegt (px,pz) im Footprint? */
export function pointInside(c, px, pz) {
  if (c.t === 'cyl') return (px - c.x) ** 2 + (pz - c.z) ** 2 <= c.r * c.r;
  const cos = Math.cos(c.ry);
  const sin = Math.sin(c.ry);
  const dx = px - c.x;
  const dz = pz - c.z;
  const lx = dx * cos - dz * sin;
  const lz = dx * sin + dz * cos;
  return Math.abs(lx) <= c.hx && Math.abs(lz) <= c.hz;
}

export function colliderBounds(c) {
  if (c.t === 'cyl') return [c.x - c.r, c.z - c.r, c.x + c.r, c.z + c.r];
  const ex = Math.abs(Math.cos(c.ry)) * c.hx + Math.abs(Math.sin(c.ry)) * c.hz;
  const ez = Math.abs(Math.sin(c.ry)) * c.hx + Math.abs(Math.cos(c.ry)) * c.hz;
  return [c.x - ex, c.z - ez, c.x + ex, c.z + ez];
}
