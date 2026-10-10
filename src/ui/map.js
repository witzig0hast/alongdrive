// Karte (M): entdeckte Orte, Spieler, Auto, Mitspieler, Lagerfeuer
export const POI_INFO = {
  garage: ['Garage', '#e0a23b', 'G'],
  shed: ['Schuppen', '#8fd18a', 'S'],
  gas_station: ['Tankstelle', '#f0c040', '⛽'],
  house: ['Haus', '#c9b58f', 'H'],
  wreck: ['Wrack', '#b07a5a', 'W'],
  water_tower: ['Wasserturm', '#6cb8e8', 'T'],
  radio_mast: ['Funkmast', '#e86c6c', 'F'],
  settlement: ['Siedlung', '#e8a86c', 'D'],
  military: ['Militärposten', '#8aa05a', 'M'],
};

export function drawMap(canvas, g) {
  const c = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const scale = g.mapScale; // Meter pro Pixel
  const p = g.player.pos;
  const cx = W / 2;
  const cy = H / 2;
  const tx = (x) => cx + (x - p.x) / scale;
  const ty = (z) => cy + (z - p.z) / scale;
  c.clearRect(0, 0, W, H);
  c.fillStyle = '#2a2016';
  c.fillRect(0, 0, W, H);
  // Raster alle 250 m / 1 km
  const step = scale > 8 ? 1000 : 250;
  c.strokeStyle = 'rgba(255,255,255,0.07)';
  c.lineWidth = 1;
  c.font = '11px sans-serif';
  c.fillStyle = 'rgba(255,255,255,0.35)';
  const x0 = Math.floor((p.x - (cx * scale)) / step) * step;
  for (let x = x0; x < p.x + cx * scale + step; x += step) {
    c.beginPath();
    c.moveTo(tx(x), 0);
    c.lineTo(tx(x), H);
    c.stroke();
  }
  const z0 = Math.floor((p.z - (cy * scale)) / step) * step;
  for (let z = z0; z < p.z + cy * scale + step; z += step) {
    c.beginPath();
    c.moveTo(0, ty(z));
    c.lineTo(W, ty(z));
    c.stroke();
  }
  c.fillText(`Raster ${step} m`, 10, H - 10);
  // Entdeckte Orte
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  for (const poi of g.discovered.values()) {
    const x = tx(poi.x);
    const y = ty(poi.z);
    if (x < -20 || y < -20 || x > W + 20 || y > H + 20) continue;
    const [name, col, ch] = POI_INFO[poi.type] || [poi.type, '#fff', '?'];
    c.fillStyle = 'rgba(0,0,0,0.6)';
    c.beginPath();
    c.arc(x, y, 11, 0, 7);
    c.fill();
    c.strokeStyle = col;
    c.lineWidth = 2;
    c.stroke();
    c.fillStyle = col;
    c.font = 'bold 12px sans-serif';
    c.fillText(ch, x, y + 1);
    if (scale <= 8) {
      c.font = '11px sans-serif';
      c.fillStyle = '#eee';
      c.fillText(name, x, y + 22);
    }
  }
  // Lagerfeuer
  for (const f of g.campfires) {
    c.fillStyle = '#ff9a40';
    c.beginPath();
    c.arc(tx(f.x), ty(f.z), 4, 0, 7);
    c.fill();
  }
  // Mitspieler
  if (g.net) {
    for (const r of g.net.remotes.values()) {
      c.fillStyle = '#6cf';
      c.beginPath();
      c.arc(tx(r.pos.x), ty(r.pos.z), 5, 0, 7);
      c.fill();
      c.font = '11px sans-serif';
      c.fillText(r.name, tx(r.pos.x), ty(r.pos.z) - 12);
    }
  }
  // Auto
  const car = g.car;
  c.save();
  c.translate(tx(car.pos.x), ty(car.pos.z));
  c.rotate(-car.yawNow() + Math.PI);
  c.fillStyle = '#c8443a';
  c.fillRect(-4, -7, 8, 14);
  c.restore();
  // Spieler (Pfeil in Blickrichtung)
  const yaw = g.player.seat ? car.yawNow() + Math.PI : g.player.yaw;
  c.save();
  c.translate(cx, cy);
  c.rotate(-yaw);
  c.fillStyle = '#fff';
  c.strokeStyle = '#000';
  c.lineWidth = 1.5;
  c.beginPath();
  c.moveTo(0, -10);
  c.lineTo(7, 8);
  c.lineTo(0, 4);
  c.lineTo(-7, 8);
  c.closePath();
  c.fill();
  c.stroke();
  c.restore();
  // Norden
  c.fillStyle = '#ff6a4a';
  c.font = 'bold 14px sans-serif';
  c.fillText('N', W - 20, 20);
  c.fillStyle = '#ddd';
  c.font = '12px sans-serif';
  c.textAlign = 'left';
  c.fillText(`Pos ${p.x.toFixed(0)} / ${p.z.toFixed(0)} · ${(g.discovered.size)} Orte entdeckt · ${Math.round(scale * W / 2)} m Radius`, 10, 18);
}
