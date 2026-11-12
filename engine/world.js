// ---------- world: renderer, camera, room geometry, labels (the room art itself is built by the theme, look.js) ----------
import * as THREE from '../vendor/three.module.js';

// room dimensions (10m x 10m x 5m, eye 1.6m above floor)
export const HW = 5, FLOOR = -1.6, CEIL = 3.4, MIDY = (FLOOR + CEIL) / 2, RH = CEIL - FLOOR;
// wall index: 0 = 前方(north, -z), 1 = 右舷(east, +x), 2 = 後方(south, +z), 3 = 左舷(west, -x)
export const WALL = [
  { rotY: 0,            pos: (o = 0) => new THREE.Vector3(0, 0, -HW + o) },
  { rotY: -Math.PI / 2, pos: (o = 0) => new THREE.Vector3(HW - o, 0, 0) },
  { rotY: Math.PI,      pos: (o = 0) => new THREE.Vector3(0, 0, HW - o) },
  { rotY: Math.PI / 2,  pos: (o = 0) => new THREE.Vector3(-HW + o, 0, 0) },
];
export const faceYaw = k => -k * Math.PI / 2; // camera yaw when looking at wall k
// a group placed on wall k whose local +z points into the room, local x = along the wall (left->right as you face it)
export function onWall(k, offset = 0.02) { const g = new THREE.Group(); g.rotation.y = WALL[k].rotY; g.position.copy(WALL[k].pos(offset)); return g; }

export function installWorld(G, Renderer, createLook) {
  // ---------- renderer / camera ----------
  const renderer = new Renderer({ antialias: true, powerPreference: 'high-performance' });
  G.pixelRatioCap = 1.5;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, G.pixelRatioCap));
  renderer.setSize(G.viewW(), G.viewH());
  document.body.prepend(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x02030a);
  const camera = new THREE.PerspectiveCamera(75, G.viewW() / G.viewH(), 0.05, 200);
  camera.position.set(0, 0, 0); // eye position is fixed: look-around only
  addEventListener('resize', () => { camera.aspect = G.viewW() / G.viewH(); camera.updateProjectionMatrix(); renderer.setSize(G.viewW(), G.viewH()); });
  const hemi = new THREE.HemisphereLight(0xbfd4ff, 0x202030, 1.15); scene.add(hemi);
  G.hemiBase = hemi.color.clone();
  Object.assign(G, { renderer, scene, camera, hemi });

  // ---------- labels (text on 3D panels, drawn in the theme's style) ----------
  function labelTex(text, w, h, bg, fg, px) {
    const LOOK = G.LOOK;
    const c = document.createElement('canvas'); c.width = 512; c.height = Math.max(32, Math.round(512 * h / w)); const g = c.getContext('2d');
    const font = p => LOOK.labelFont(p);
    LOOK.drawLabelFrame(g, c.width, c.height, bg); fg = LOOK.mapCol(fg); px = Math.round(px * 0.9);
    const lines = String(text).split('\n');
    // shrink the font until the widest line fits inside the frame (long clue lines were being cut off)
    const maxW = c.width * 0.9;
    g.font = font(px);
    const widest = Math.max(...lines.map(l => (g.measureText(l) || {}).width || 0));
    if (widest > maxW) px = Math.floor(px * maxW / widest);
    // also fit the height (4-line panels such as the code table were cut off at the bottom)
    const maxH = c.height * 0.88;
    if (lines.length * px * 1.2 > maxH) px = Math.floor(maxH / (lines.length * 1.2));
    g.fillStyle = fg; g.font = font(px); g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((l, i) => g.fillText(l, c.width / 2, c.height / 2 + (i - (lines.length - 1) / 2) * px * 1.2));
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function label(text, w, h, bg = '#0b0e1c', fg = '#cfd6ff', px = 80) {
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: labelTex(text, w, h, bg, fg, px) }));
  }
  function setLabel(mesh, text, w, h, bg = '#0b0e1c', fg = '#cfd6ff', px = 80) {
    mesh.material.map.dispose(); mesh.material.map = labelTex(text, w, h, bg, fg, px); mesh.material.needsUpdate = true;
  }
  const starShape = new THREE.Shape();
  for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.16 : 0.38, a = Math.PI / 2 + i * Math.PI / 5;
    i ? starShape.lineTo(Math.cos(a) * r, Math.sin(a) * r) : starShape.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  const starGeo = new THREE.ShapeGeometry(starShape);
  function pipe(parent, a, b, r, mat) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), 8, 1), mat);
    m.position.copy(A).add(B).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    parent.add(m); return m;
  }

  // ---------- rooms ----------
  const ROOMS = G.STAGE.rooms;
  const roomById = Object.fromEntries(ROOMS.map(r => [r.id, r]));
  const interactive = []; // { mesh, room, type:'door'|'valve', ... }
  Object.assign(G, { label, setLabel, pipe, ROOMS, roomById, interactive });

  function buildRoom(R) {
    const LOOK = G.LOOK;
    const g = new THREE.Group(); g.visible = false; scene.add(g); R.group = g;
    R.doors = {}; // wall -> target room id
    const left = ROOMS.find(x => x.col === R.col - 1), right = ROOMS.find(x => x.col === R.col + 1);
    if (left) R.doors[3] = left.id; if (right) R.doors[1] = right.id;
    LOOK.buildShell(R, g);
    for (const [k, to] of Object.entries(R.doors)) { // doors
      const dg = onWall(+k, 0.03); dg.position.y = FLOOR; g.add(dg);
      const d = LOOK.buildDoor(dg, to, roomById[to].name); interactive.push({ mesh: d.panel, room: R.id, type: 'door', to, mat: d.mat });
    }
  }
  G.LOOK = createLook(THREE, G.THEME, { HW, FLOOR, CEIL, MIDY, RH, WALL, onWall, label, pipe, starGeo });
  G.LOOK.renderer(renderer, scene, hemi); G.hemiBase = hemi.color.clone();
  ROOMS.forEach(buildRoom);
}
