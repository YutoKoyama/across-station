// ---------- partner figure: your partner, drawn where they are, turning where they look (real time online) ----------
// A plain silhouette in the map's partner colour (celadon), so it reads like the map marker standing in the room:
// body + head + a visor on the face + a translucent cone from the head = the direction they are looking (left/right and up/down).
// Same room: they stand 1.4 m to the side (A on the left, B on the right). Another room: they are drawn where that room is
// (rooms side by side, 1 m apart), seen through the walls, a little fainter. Online, 'look' messages bring their direction;
// the figure turns smoothly toward it. On one phone (A⇄B switch) the other crew member keeps their last direction.
import * as THREE from '../vendor/three.module.js';
import { HW, FLOOR } from './world.js?v=202611121444';

const COL = 0x7fb8a8, ROOM_PITCH = HW * 2 + 1, SIDE = 1.4, TURN_RATE = 10, MOVE_RATE = 6;

export function installPartner(G) {
  const { scene, players, roomById } = G;
  const other = () => (G.cur === 'A' ? 'B' : 'A');
  const mat = (opacity) => new THREE.MeshBasicMaterial({ color: COL, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false });
  const body = mat(0.5), head = mat(0.6), visor = new THREE.MeshBasicMaterial({ color: 0x10141f, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, fog: false });
  const coneMat = mat(0.22), ringMat = mat(0.45);
  const fig = new THREE.Group(); fig.renderOrder = 50; scene.add(fig);
  const parts = [];
  const add = (m, parent = fig) => { m.renderOrder = 50; parent.add(m); parts.push(m); return m; };
  // body (shoulders to feet), relative to the eye height (y = 0 is the eye, FLOOR = feet)
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.17, -FLOOR - 0.35, 14), body)).position.y = (FLOOR - 0.35) / 2;
  add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), body)).position.y = -0.38; // shoulders
  add(new THREE.Mesh(new THREE.RingGeometry(0.32, 0.4, 28), ringMat)).rotation.x = -Math.PI / 2; parts[parts.length - 1].position.y = FLOOR + 0.02; // floor ring
  const headG = new THREE.Group(); headG.position.y = -0.05; fig.add(headG);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), head), headG);
  const v = add(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.07, 0.06), visor), headG); v.position.set(0, 0.02, -0.15);
  // looking cone: from the head toward -z (the way a camera looks), 2.2 m long
  const coneGeo = new THREE.ConeGeometry(0.55, 2.2, 20, 1, true); coneGeo.translate(0, -1.1, 0); coneGeo.rotateX(Math.PI / 2); // tip at the head, opening toward -z
  add(new THREE.Mesh(coneGeo, coneMat), headG);
  // name tag above the head
  const tagC = document.createElement('canvas'); tagC.width = 256; tagC.height = 96;
  const tagT = tagC.getContext ? new THREE.CanvasTexture(tagC) : null;
  let tagFor = null;
  function drawTag(k) {
    if (!tagT || tagFor === k) return; tagFor = k;
    const g = tagC.getContext('2d'); g.clearRect(0, 0, 256, 96);
    g.fillStyle = 'rgba(16,20,31,0.85)'; g.fillRect(28, 14, 200, 68); g.strokeStyle = '#7FB8A8'; g.lineWidth = 3; g.strokeRect(28, 14, 200, 68);
    g.fillStyle = '#bfe3d8'; g.font = '700 40px "Noto Sans JP", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(`${k}（${(G.UI.map && G.UI.map.partner) || '相手'}）`, 128, 50); tagT.needsUpdate = true;
  }
  if (tagT) { tagT.colorSpace = THREE.SRGBColorSpace; const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagT, depthTest: false, depthWrite: false, transparent: true, fog: false }));
    sp.scale.set(0.75, 0.28, 1); sp.position.y = 0.42; sp.renderOrder = 51; fig.add(sp); parts.push(sp); G.partnerTag = sp; }

  const target = new THREE.Vector3(); let yawNow = 0, pitchNow = 0, placed = false;
  function where(out) { // the partner's spot, in the coordinates of the room I am in (my eye = origin)
    const me = players[G.cur], o = other(), p = players[o];
    const dc = roomById[p.room].col - roomById[me.room].col;
    return out.set(dc * ROOM_PITCH + (dc === 0 ? (o === 'A' ? -SIDE : SIDE) : 0), 0, 0);
  }
  function tickPartner(dt) {
    const o = other(), p = players[o];
    if (!p || !G.puzzle) { fig.visible = false; return; }
    fig.visible = true; drawTag(o);
    where(target);
    if (!placed || G.partnerJump) { fig.position.copy(target); placed = true; G.partnerJump = false; }
    else fig.position.lerp(target, Math.min(1, dt * MOVE_RATE));
    const yaw = p.yaw ?? 0, pitch = p.pitch ?? 0;
    const dy = Math.atan2(Math.sin(yaw - yawNow), Math.cos(yaw - yawNow));
    yawNow += dy * Math.min(1, dt * TURN_RATE); pitchNow += (pitch - pitchNow) * Math.min(1, dt * TURN_RATE);
    fig.rotation.y = yawNow; headG.rotation.x = pitchNow;
    // through a wall (another room) the figure is fainter
    const far = roomById[p.room].col !== roomById[players[G.cur].room].col;
    if (G.partnerTag) { const k = Math.max(1, fig.position.length() / 4); G.partnerTag.scale.set(0.75 * k, 0.28 * k, 1); G.partnerTag.position.y = 0.3 + 0.12 * k; } // readable from the next room too
    body.opacity = far ? 0.32 : 0.5; head.opacity = far ? 0.4 : 0.6; coneMat.opacity = far ? 0.14 : 0.22;
  }
  G.onPartnerMoved = () => {}; // position follows players[o].room every frame (smoothly)
  G.partnerFigure = fig;
  Object.assign(G, { tickPartner });
}
