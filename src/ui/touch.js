// Touch-Steuerung (virtueller Joystick + Buttons) für Tablet/Handy
export function setupTouch(input, game) {
  const root = document.getElementById('touch');
  root.classList.remove('hidden');
  root.innerHTML = '';

  const stick = document.createElement('div');
  stick.className = 'stick';
  stick.innerHTML = '<i></i>';
  root.appendChild(stick);
  const knob = stick.firstChild;
  let sid = null;
  const sc = { x: 0, y: 0 };
  const move = (t) => {
    const r = stick.getBoundingClientRect();
    let dx = (t.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (t.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const l = Math.hypot(dx, dy);
    if (l > 1) {
      dx /= l;
      dy /= l;
    }
    knob.style.transform = `translate(${dx * 40}px, ${dy * 40}px)`;
    input.moveAxis.x = Math.abs(dx) < 0.12 ? 0 : dx;
    input.moveAxis.y = Math.abs(dy) < 0.12 ? 0 : -dy;
    input.setVirtual('sprint', l > 0.95 && !game.player?.seat);
  };
  stick.addEventListener('touchstart', (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    sid = t.identifier;
    move(t);
  }, { passive: false });
  stick.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === sid) move(t);
  }, { passive: false });
  const endStick = (e) => {
    for (const t of e.changedTouches) if (t.identifier === sid) {
      sid = null;
      knob.style.transform = '';
      input.moveAxis.x = input.moveAxis.y = 0;
      input.setVirtual('sprint', false);
    }
  };
  stick.addEventListener('touchend', endStick);
  stick.addEventListener('touchcancel', endStick);

  // Blick-Fläche
  const look = document.createElement('div');
  look.className = 'look';
  root.appendChild(look);
  let lid = null;
  let lx = 0;
  let ly = 0;
  look.addEventListener('touchstart', (e) => {
    const t = e.changedTouches[0];
    lid = t.identifier;
    lx = t.clientX;
    ly = t.clientY;
  }, { passive: true });
  look.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of e.changedTouches) if (t.identifier === lid) {
      input.touchLook.x += (t.clientX - lx) * 1.6;
      input.touchLook.y += (t.clientY - ly) * 1.6;
      lx = t.clientX;
      ly = t.clientY;
    }
  }, { passive: false });
  look.addEventListener('touchend', () => { lid = null; });

  const grid = document.createElement('div');
  grid.className = 'btns';
  root.appendChild(grid);
  const button = (label, action, cell, opts = {}) => {
    const b = document.createElement('button');
    b.className = 'tb';
    b.textContent = label;
    b.style.gridColumn = String(cell[1]);
    b.style.gridRow = String(cell[0]);
    const down = (e) => {
      e.preventDefault();
      if (opts.toggle) {
        b.classList.toggle('on');
        input.setVirtual(action, b.classList.contains('on'));
      } else {
        b.classList.add('on');
        input.setVirtual(action, true);
      }
    };
    const up = (e) => {
      e.preventDefault();
      if (opts.toggle) return;
      b.classList.remove('on');
      input.setVirtual(action, false);
    };
    b.addEventListener('touchstart', down, { passive: false });
    b.addEventListener('touchend', up, { passive: false });
    b.addEventListener('touchcancel', up, { passive: false });
    grid.appendChild(b);
    return b;
  };
  // Zeile, Spalte
  button('🎒', 'inventory', [1, 1]);
  button('📷', 'camera', [1, 2]);
  button('💡', 'lights', [1, 3]);
  button('⤒', 'jump', [1, 4]);
  button('Q', 'drop', [2, 1]);
  button('G', 'throw', [2, 2]);
  button('H', 'horn', [2, 3]);
  button('R', 'engine', [2, 4]);
  button('⤓', 'crouch', [3, 1]);
  button('F', 'use', [3, 3]).classList.add('big');
  button('E', 'interact', [3, 4]).classList.add('big');
  const pause = document.createElement('button');
  pause.className = 'tb';
  pause.textContent = '❚❚';
  pause.style.right = '14px';
  pause.style.top = '78px';
  pause.style.width = pause.style.height = '40px';
  pause.addEventListener('touchstart', (e) => {
    e.preventDefault();
    input.unlock();
  }, { passive: false });
  root.appendChild(pause);
}
