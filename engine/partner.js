// ---------- partner figure: your partner, drawn where they are, turning where they look (real time online) ----------
// A light hologram bust in the map's partner colour (celadon): head with an outline, visor, shoulders, a short cone = where they look.
// Same room: they stand 2.4 m to the side (A on the left, B on the right) and fade while you look straight at them. Another room: the figure is NOT drawn (review 1, M1:
// seen through the walls it stood in front of clues and memos); where they are is shown on the map. Online, 'look' messages bring their direction;
// the figure turns smoothly toward it. On one phone (A⇄B switch) the other crew member keeps their last direction.
import * as THREE from '../vendor/three.module.js';
import { HW, FLOOR } from './world.js?v=202611130500';

const COL = 0x7fb8a8, /* celadon = the map's partner colour (amber is "you" / "operate") */ ROOM_PITCH = HW * 2 + 1, SIDE = 2.4, TURN_RATE = 10, MOVE_RATE = 6;
// review 2 S1: a light "hologram bust" instead of a solid snowman, 2.4 m to the side, and it fades when it is right in front of you
const FADE_IN_DEG = 8, FADE_OUT_DEG = 28, FADE_MIN = 0.3;

export function installPartner(G) {
  const { scene, players, roomById, camera } = G;
  const other = () => (G.cur === 'A' ? 'B' : 'A');
  const fades = []; // [material, base opacity]
  const mat = (opacity, extra = {}) => { const m = new THREE.MeshBasicMaterial({ color: COL, transparent: true, opacity, depthTest: false, depthWrite: false, fog: false, ...extra }); fades.push([m, opacity]); return m; };
  const body = mat(0.22), head = mat(0.3), rimMat = mat(0.75, { color: 0xbfe3d8, side: THREE.DoubleSide }), coneMat = mat(0.5), ringMat = mat(0.3);
  const visor = mat(0.8, { color: 0x10141f });
  const fig = new THREE.Group(); fig.renderOrder = 50; scene.add(fig);
  const parts = [];
  const add = (m, parent = fig) => { m.renderOrder = 50; parent.add(m); parts.push(m); return m; };
  // a bust (y = 0 is the eye height): shoulders and a torso that ends at the waist, no legs (no pillar down to the floor)
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.11, 0.7, 16, 1, true), body)).position.y = -0.73;
  add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), body)).position.y = -0.38; // shoulders
  add(new THREE.Mesh(new THREE.RingGeometry(0.28, 0.33, 32), ringMat)).rotation.x = -Math.PI / 2; parts[parts.length - 1].position.y = FLOOR + 0.02; // where they stand
  const headG = new THREE.Group(); headG.position.y = -0.05; fig.add(headG);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.16, 20, 14), head), headG);
  const rim = add(new THREE.Mesh(new THREE.RingGeometry(0.155, 0.175, 40), rimMat)); rim.position.y = -0.05; // outline of the head, turned to face you every frame
  const v = add(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.06, 0.05), visor), headG); v.position.set(0, 0.02, -0.14);
  // where they look: a small cone in front of the face (0.3 m), not a big beam
  const coneGeo = new THREE.ConeGeometry(0.07, 0.3, 12, 1, true); coneGeo.translate(0, -0.15, 0); coneGeo.rotateX(Math.PI / 2); coneGeo.translate(0, 0, -0.17);
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
  if (tagT) { tagT.colorSpace = THREE.SRGBColorSpace; const sm = new THREE.SpriteMaterial({ map: tagT, depthTest: false, depthWrite: false, transparent: true, fog: false }); fades.push([sm, 1]); const sp = new THREE.Sprite(sm);
    sp.scale.set(0.7, 0.26, 1); sp.position.y = 0.4; sp.renderOrder = 51; fig.add(sp); parts.push(sp); G.partnerTag = sp; G.partnerTagMat = sm; }

  const target = new THREE.Vector3(), fwd = new THREE.Vector3(), toFig = new THREE.Vector3(); let yawNow = 0, pitchNow = 0, placed = false;
  function where(out) { // the partner's spot, in the coordinates of the room I am in (my eye = origin)
    const me = players[G.cur], o = other(), p = players[o];
    const dc = roomById[p.room].col - roomById[me.room].col, dr = (roomById[p.room].row || 0) - (roomById[me.room].row || 0);
    return out.set(dc * ROOM_PITCH + (dc === 0 && dr === 0 ? (o === 'A' ? -SIDE : SIDE) : 0), 0, dr * ROOM_PITCH);
  }
  function tickPartner(dt) {
    const o = other(), p = players[o];
    if (!p || !G.puzzle || !roomById[p.room] || !players[G.cur] || !roomById[players[G.cur].room]) { fig.visible = false; return; }
    // in another room: not drawn at all (the map shows where they are); jump into place when they walk in
    if (p.room !== players[G.cur].room) { fig.visible = false; placed = false; return; }
    fig.visible = true; drawTag(o);
    where(target);
    if (!placed || G.partnerJump) { fig.position.copy(target); placed = true; G.partnerJump = false; }
    else fig.position.lerp(target, Math.min(1, dt * MOVE_RATE));
    const yaw = p.yaw ?? 0, pitch = p.pitch ?? 0;
    const dy = Math.atan2(Math.sin(yaw - yawNow), Math.cos(yaw - yawNow));
    yawNow += dy * Math.min(1, dt * TURN_RATE); pitchNow += (pitch - pitchNow) * Math.min(1, dt * TURN_RATE);
    fig.rotation.y = yawNow; headG.rotation.x = pitchNow;
    // fade while the figure is right where you are looking (it must never cover a panel, the window or a locker)
    camera.getWorldDirection(fwd); toFig.copy(fig.position).sub(camera.position).normalize();
    const ang = THREE.MathUtils.radToDeg(fwd.angleTo(toFig)), t = THREE.MathUtils.smoothstep(ang, FADE_IN_DEG, FADE_OUT_DEG), k = FADE_MIN + (1 - FADE_MIN) * t;
    for (const [m, base] of fades) m.opacity = base * (m === G.partnerTagMat ? Math.max(0.4, k) : k);
    rim.lookAt(camera.position);
  }
  G.onPartnerMoved = () => {}; // position follows players[o].room every frame (smoothly)
  G.partnerFigure = fig;
  Object.assign(G, { tickPartner });
}
