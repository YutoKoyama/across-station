// Free movement: virtual stick (bottom-left) + WASD, camera follows behind the player and is orbited by dragging.
import { THREE } from './kit.js';

export function controls(frame, cam, getSc, view) {
  const stick = document.getElementById('stick'), act = document.getElementById('act-btn');
  const move = { x: 0, y: 0 }, keys = {};
  let stickId = null, stickC = null, dragId = null, drag = null;
  // client point -> frame-local point (the frame is turned 90deg on an upright phone)
  const local = e => window.__rotated ? { x: e.clientY, y: innerWidth - e.clientX } : { x: e.clientX, y: e.clientY };
  const inStickZone = p => p.x < frame.clientWidth * 0.36 && p.y > frame.clientHeight * 0.42;
  frame.addEventListener('pointerdown', e => {
    if (e.target.closest && e.target.closest('.ui,#menu,#place,#t-set,.act')) return;
    const p = local(e); frame.setPointerCapture(e.pointerId);
    if (getSc().player && stickId === null && inStickZone(p)) { stickId = e.pointerId; stickC = p; stick.classList.add('live');
      stick.style.left = (p.x - 41) + 'px'; stick.style.top = (p.y - 41) + 'px'; stick.style.bottom = 'auto'; }
    else if (dragId === null) { dragId = e.pointerId; drag = { p, yaw: view.yaw, pitch: view.pitch }; }
  });
  frame.addEventListener('pointermove', e => {
    const p = local(e);
    if (e.pointerId === stickId) { let dx = p.x - stickC.x, dy = p.y - stickC.y; const m = Math.hypot(dx, dy), R = 34;
      if (m > R) { dx *= R / m; dy *= R / m; } move.x = dx / R; move.y = dy / R; stick.style.setProperty('--kx', dx + 'px'); stick.style.setProperty('--ky', dy + 'px'); }
    else if (e.pointerId === dragId) { view.yaw = drag.yaw - (p.x - drag.p.x) * 0.007; view.pitch = Math.min(1.2, Math.max(0.06, drag.pitch + (p.y - drag.p.y) * 0.004)); }
  });
  const end = e => { if (e.pointerId === stickId) { stickId = null; move.x = move.y = 0; stick.classList.remove('live'); stick.style.cssText = ''; }
    if (e.pointerId === dragId) dragId = null; };
  frame.addEventListener('pointerup', end); frame.addEventListener('pointercancel', end);
  addEventListener('keydown', e => keys[e.key.toLowerCase()] = true); addEventListener('keyup', e => keys[e.key.toLowerCase()] = false);

  let here = null;
  if (act) act.addEventListener('pointerdown', e => { e.stopPropagation(); if (here && here.go) here.go(); });
  const fwd = new THREE.Vector3(), right = new THREE.Vector3();
  let walkT = 0;
  return function step(dt, t) {
    const sc = getSc(), P = sc.player, W = sc.walk;
    if (!P || window.__freeze) { if (act) act.style.display = 'none'; return; }
    let mx = move.x + ((keys.d || keys.arrowright) ? 1 : 0) - ((keys.a || keys.arrowleft) ? 1 : 0);
    let my = move.y + ((keys.s || keys.arrowdown) ? 1 : 0) - ((keys.w || keys.arrowup) ? 1 : 0);
    const mag = Math.min(1, Math.hypot(mx, my));
    if (mag > 0.08) {
      fwd.set(-Math.sin(view.yaw), 0, -Math.cos(view.yaw)); right.set(Math.cos(view.yaw), 0, -Math.sin(view.yaw));
      const dir = right.multiplyScalar(mx).add(fwd.multiplyScalar(-my)).normalize(), sp = 4.2 * mag * dt;
      const nx = P.position.x + dir.x * sp, nz = P.position.z + dir.z * sp;
      // slide along blockers: try full move, then each axis
      for (const [x, z] of [[nx, nz], [nx, P.position.z], [P.position.x, nz]]) { const y = W.ground(x, z); if (y !== null) { P.position.x = x; P.position.z = z; P.userData.y = y; break; } }
      const want = Math.atan2(dir.x, dir.z); let d = want - P.rotation.y; d = Math.atan2(Math.sin(d), Math.cos(d)); P.rotation.y += d * Math.min(1, dt * 12);
      walkT += dt * 9 * mag; P.userData.seated = false;
    } else walkT = 0;
    if (P.userData.y === undefined) P.userData.y = W.ground(P.position.x, P.position.z) ?? P.position.y;
    P.position.y += ((P.userData.seated ? P.userData.seatY : P.userData.y) + Math.abs(Math.sin(walkT)) * 0.09 - P.position.y) * Math.min(1, dt * 14);
    P.rotation.z = Math.sin(walkT) * 0.06;
    // camera follows
    view.target.set(P.position.x, P.position.y + (sc.camHeight || 1.6), P.position.z);
    view.look.set(-Math.sin(view.yaw) * (sc.lookAhead ?? 3), sc.lookUp ?? 0.6, -Math.cos(view.yaw) * (sc.lookAhead ?? 3));
    // nearby action (enter a building etc.)
    here = W.interact ? W.interact(P.position.x, P.position.z) : null;
    if (act) { act.style.display = here || sc.actLabel ? '' : 'none'; act.textContent = here ? here.label : (sc.actLabel || ''); act.classList.toggle('go', !!here); }
  };
}

// helpers for colliders
export const inCircle = (x, z, cx, cz, r) => (x - cx) ** 2 + (z - cz) ** 2 < r * r;
export const inBox = (x, z, cx, cz, hw, hd, pad = 0.35) => Math.abs(x - cx) < hw + pad && Math.abs(z - cz) < hd + pad;
