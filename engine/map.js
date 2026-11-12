// ---------- map: a small 3D-looking (isometric) station map in the top band + a large map on tap ----------
// Shows the rooms in a row as seen from above at an angle, the ★ band (= 前方, the front wall) of every room,
// where you are (amber, with the direction you are looking) and where your partner is (celadon, with theirs).
// Online, the partner's looking direction arrives as 'look' messages (a few per second).
import * as THREE from '../vendor/three.module.js';

const GAP = 0.22, WALL_H = 0; // top-down (2026-11-13): seen straight from above
const LOOK_SEND_MS = 120, LOOK_SEND_DEG = 3; // the partner figure turns with these (real time)

export function installMap(G) {
  const { $, ROOMS, players, camera, fmt } = G;
  const M = G.UI.map || {};
  const NS = 'http://www.w3.org/2000/svg';
  const iso = (x, z) => [x, z]; // (name kept: map coordinates = floor x (east) and z (south))
  const P = pts => pts.map(p => p.map(n => n.toFixed(3)).join(',')).join(' ');
  const roomX = R => R.col * (1 + GAP);
  const other = () => (G.cur === 'A' ? 'B' : 'A');
  const meKey = () => G.cur;
  // view box from the corners of all rooms (+ wall height)
  const xs = [], ys = [];
  for (const R of ROOMS) for (const [x, z] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { const [X, Y] = iso(roomX(R) + x, z); xs.push(X); ys.push(Y, Y - WALL_H); }
  const pad = 0.1, vb = [Math.min(...xs) - pad, Math.min(...ys) - pad, Math.max(...xs) - Math.min(...xs) + pad * 2, Math.max(...ys) - Math.min(...ys) + pad * 2];

  // yaw of a camera quaternion -> a direction on the map
  const eu = new THREE.Euler();
  const yawOf = q => eu.setFromQuaternion(q, 'YXZ').y;
  G.myYaw = () => yawOf(G.rawQ || camera.quaternion);
  const isoDir = yaw => { const dx = -Math.sin(yaw), dz = -Math.cos(yaw); return iso(dx, dz); };

  function roomShapes(R, big) {
    const x0 = roomX(R), x1 = x0 + 1;
    const c = [iso(x0, 0), iso(x1, 0), iso(x1, 1), iso(x0, 1)]; // N-W(top), N-E(right), S-E(bottom), S-W(left)
    const up = ([X, Y]) => [X, Y - WALL_H];
    const meHere = players[meKey()].room === R.id, otherHere = players[other()].room === R.id;
    const fill = meHere ? 'rgba(242,162,58,0.22)' : otherHere ? 'rgba(127,184,168,0.18)' : 'rgba(230,221,200,0.05)';
    let s = '';
    // front (= 前方, the ★ band wall): a thick amber line along the north edge
    const band = t => [c[0][0] + (c[1][0] - c[0][0]) * t, c[0][1] + (c[1][1] - c[0][1]) * t];
    const b0 = band(0.06), b1 = band(0.94);
    // floor
    s += `<polygon points="${P(c)}" fill="${fill}" stroke="${meHere ? '#F2A23A' : 'rgba(230,221,200,0.45)'}" stroke-width="${meHere ? 0.03 : 0.015}"/>`;
    s += `<line x1="${b0[0].toFixed(3)}" y1="${(b0[1] + 0.04).toFixed(3)}" x2="${b1[0].toFixed(3)}" y2="${(b1[1] + 0.04).toFixed(3)}" stroke="#F2A23A" stroke-width="0.07"/>`;
    // room name on the floor
    const [cx, cy] = big ? iso(x0 + 0.5, 0.86) : iso(x0 + 0.5, 0.9);
    const name = R.name;
    s += `<text x="${cx.toFixed(3)}" y="${cy.toFixed(3)}" font-size="${big ? 0.15 : 0.2}" text-anchor="middle" fill="${meHere ? '#F2A23A' : 'rgba(230,221,200,0.7)'}" font-weight="700" style="letter-spacing:0.02em">${name}</text>`;
    return s;
  }
  function doorShapes(R) { // a short corridor to the room on the right
    const right = ROOMS.find(x => x.col === R.col + 1); if (!right) return '';
    const x0 = roomX(R) + 1, x1 = x0 + GAP, z0 = 0.4, z1 = 0.6;
    return `<polygon points="${P([iso(x0, z0), iso(x1, z0), iso(x1, z1), iso(x0, z1)])}" fill="rgba(230,221,200,0.18)" stroke="rgba(230,221,200,0.45)" stroke-width="0.012"/>`;
  }
  function marker(k, big) {
    const p = players[k], R = ROOMS.find(r => r.id === p.room); if (!R) return '';
    const same = players.A.room === players.B.room;
    const off = same ? (k === 'A' ? -0.2 : 0.2) : 0; // same side as the figure in the room: A left, B right
    const [X, Y] = iso(roomX(R) + 0.5 + off, 0.45);
    const mine = k === meKey(), col = mine ? '#F2A23A' : '#7FB8A8', r = big ? 0.085 : 0.12;
    const yaw = mine ? G.myYaw() : p.yaw;
    let s = `<g id="mk${k}${big ? 'B' : ''}" transform="translate(${X.toFixed(3)},${Y.toFixed(3)})">`;
    if (yaw !== undefined && yaw !== null) s += `<polygon class="cone" points="${cone(yaw, big)}" fill="${col}" opacity="0.45"/>`;
    s += `<circle r="${r}" fill="${col}" stroke="#10141F" stroke-width="0.02"/>`;
    s += `<text y="${(r * 0.36).toFixed(3)}" font-size="${(r * 1.15).toFixed(3)}" text-anchor="middle" fill="#10141F" font-weight="700">${k}</text>`;
    if (big) s += `<text y="${(-r - 0.05).toFixed(3)}" font-size="0.09" text-anchor="middle" fill="${col}" font-weight="700">${mine ? (M.you || 'あなた') : (M.partner || '相手')}</text>`;
    return s + '</g>';
  }
  function cone(yaw, big) { // a wedge pointing where that person is looking
    const L = big ? 0.34 : 0.36, w = 0.42;
    const a = isoDir(yaw - w), b = isoDir(yaw + w);
    return P([[0, 0], [a[0] * L, a[1] * L], [b[0] * L, b[1] * L]]);
  }
  function svg(big) {
    let s = `<svg xmlns="${NS}" viewBox="${vb.map(n => n.toFixed(3)).join(' ')}" width="100%" height="100%" font-family="inherit">`;
    for (const R of ROOMS) s += roomShapes(R, big) + doorShapes(R);
    s += marker(other(), big) + marker(meKey(), big);
    return s + '</svg>';
  }
  function drawMap() {
    const m = $('map'); if (!m) return;
    m.innerHTML = svg(false);
    if ($('mapBig') && $('mapBig').style.display === 'flex') $('mapBigSvg').innerHTML = svg(true);
  }
  // the looking cones turn every frame-ish (only the cone, not the whole map)
  let lastTick = 0, lastSent = 0, lastSentYaw = null, lastSentPitch = 0;
  function tickMap() {
    const now = performance.now(); if (now - lastTick < 60) return; lastTick = now;
    const yaw = G.myYaw(), pitch = eu.x; players[meKey()].yaw = yaw; players[meKey()].pitch = pitch;
    for (const id of ['mk' + meKey(), 'mk' + meKey() + 'B']) { const g = $(id); const c = g && g.querySelector('.cone'); if (c) c.setAttribute('points', cone(yaw, id.endsWith('B'))); }
    if (G.NET && G.NET.on && G.NET.started && now - lastSent > LOOK_SEND_MS) {
      const d = lastSentYaw === null ? 999 : Math.abs(THREE.MathUtils.radToDeg(Math.atan2(Math.sin(yaw - lastSentYaw), Math.cos(yaw - lastSentYaw))));
      const dp = Math.abs(THREE.MathUtils.radToDeg(pitch - lastSentPitch));
      if (d >= LOOK_SEND_DEG || dp >= LOOK_SEND_DEG) { lastSent = now; lastSentYaw = yaw; lastSentPitch = pitch; G.netSend({ t: 'look', who: meKey(), yaw: +yaw.toFixed(3), pitch: +pitch.toFixed(3) }); }
    }
  }
  G.onPartnerLook = () => { const o = other(); for (const id of ['mk' + o, 'mk' + o + 'B']) { const g = $(id); if (!g) { drawMap(); return; } const c = g.querySelector('.cone'); if (c) c.setAttribute('points', cone(players[o].yaw, id.endsWith('B'))); else drawMap(); } };

  // large map (tap the small one)
  const big = document.createElement('div'); big.id = 'mapBig';
  big.innerHTML = `<div id="mapBigTitle">${M.title || 'ステーションの地図'}</div><div id="mapBigSvg"></div>
    <div id="mapLegend"><span class="lg me"></span>${M.you || 'あなた'}　<span class="lg pa"></span>${M.partner || '相手'}　<span class="lg fr"></span>${M.front || '★の帯の壁＝前方'}</div>
    <div id="mapNote">${M.note || '扇形は、その人が見ている方向です。'}</div><button id="mapBigClose">${M.close || '閉じる'}</button>`;
  if (document.body.appendChild) document.body.appendChild(big);
  $('map').onclick = () => { big.style.display = 'flex'; $('mapBigSvg').innerHTML = svg(true); };
  if ($('mapBigClose')) $('mapBigClose').onclick = () => { big.style.display = 'none'; };
  Object.assign(G, { drawMap, tickMap });
  drawMap();
}
