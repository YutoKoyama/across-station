import { THREE, C, mat, glow, put, rbox, blob, lights, interpreter } from './kit.js';
import { inCircle, inBox } from './move.js';
const inRoom = (x, z, r = 11.6) => x * x + z * z < r * r;

// round room shell: floor, curved wall with soft panels, ceiling ring lights
function roomShell(S, { r = 13, h = 7, wall = '#2b3560', floor = '#3b4472', trim = C.teal, window: win = null } = {}) {
  S.background = new THREE.Color('#0a0f26'); S.fog = new THREE.Fog('#0a0f26', 30, 60);
  lights(S, { hemi: 0.75, sunI: 1.1, pos: [-10, 22, 12], area: 18, sky: '#a9b8ff', ground: '#2a2440' });
  put(S, new THREE.CircleGeometry(r, 96), mat(floor, { roughness: 0.6 }), 0, 0, 0).rotation.x = -Math.PI / 2;
  for (const [rr, w] of [[r * 0.45, 0.12], [r * 0.75, 0.1]]) put(S, new THREE.RingGeometry(rr - w, rr, 96), glow(trim, 0.35), 0, 0.01, 0, false).rotation.x = -Math.PI / 2;
  const wallGeo = new THREE.CylinderGeometry(r, r, h, 96, 1, true, win ? Math.PI + win.gap / 2 : 0, Math.PI * 2 - (win ? win.gap : 0));
  put(S, wallGeo, mat(wall, { side: THREE.BackSide, roughness: 0.8 }), 0, h / 2, 0);
  for (let k = 0; k < 24; k++) { const a = k / 24 * 6.283; if (win && Math.abs(a - Math.PI) < win.gap / 2 + 0.12) continue;
    const p = put(S, rbox(1.6, 3.6, 0.2, 0.25), mat('#35407a', { roughness: 0.7 }), Math.sin(a) * (r - 0.15), 2.6, Math.cos(a) * (r - 0.15)); p.rotation.y = a + Math.PI;
    put(p, rbox(1.0, 0.08, 0.05, 0.03), glow(trim, 0.8), 0, 1.3, -0.12, false); }
  put(S, new THREE.TorusGeometry(r - 0.4, 0.12, 12, 128), glow('#cfd8ff', 0.6), 0, h - 0.2, 0, false).rotation.x = Math.PI / 2;
  put(S, new THREE.CircleGeometry(r, 64), mat('#1d244a', { side: THREE.BackSide }), 0, h, 0, false).rotation.x = -Math.PI / 2;
  put(S, new THREE.TorusGeometry(r - 0.05, 0.25, 12, 128), mat('#4a5590'), 0, 0.1, 0).rotation.x = Math.PI / 2;
}

// a window to space with planet, set into the wall gap
function spaceWindow(S, { z = -12.6, w = 11, h = 5.5, y = 3.3 } = {}) {
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(w * 2.2, h * 2.2), new THREE.ShaderMaterial({ fog: false,
    vertexShader: 'varying vec2 u; void main(){u=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying vec2 u; float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);} void main(){ vec3 c=mix(vec3(.03,.05,.16),vec3(.16,.12,.32),smoothstep(.0,.9,1.-u.y)); vec2 g=floor(u*180.); float s=step(.993,h(g)); c+=vec3(s); vec2 pc=u-vec2(.68,.42); float d=length(pc*vec2(1.,1.)); float pl=smoothstep(.2,.195,d); vec3 pcol=mix(vec3(.35,.38,.85),vec3(.95,.75,.55),smoothstep(-.2,.2,pc.x-pc.y*.4)); c=mix(c,pcol*(.55+.45*smoothstep(.2,-.1,pc.x+pc.y)),pl); float ring=smoothstep(.012,.0,abs(length(pc*vec2(1.,3.2))-.3))*step(.18,d+abs(pc.y)*2.); c+=vec3(.6,.55,.9)*ring*.5; gl_FragColor=vec4(c,1.);}' }));
  sky.position.set(0, y, z - 1.5); S.add(sky);
  const fr = new THREE.Shape(); fr.absellipse(0, 0, w / 2 + 0.5, h / 2 + 0.5, 0, Math.PI * 2);
  const hole = new THREE.Path(); hole.absellipse(0, 0, w / 2, h / 2, 0, Math.PI * 2, true); fr.holes.push(hole);
  put(S, new THREE.ExtrudeGeometry(fr, { depth: 0.6, bevelEnabled: true, bevelSize: 0.12, bevelThickness: 0.12, bevelSegments: 4, curveSegments: 64 }), mat('#c9cfe6', { roughness: 0.5 }), 0, y, z - 0.3);
  const glass = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.MeshStandardMaterial({ color: '#9fd8ff', transparent: true, opacity: 0.08, roughness: 0.05, metalness: 0.3 }));
  glass.scale.set(w / 2, h / 2, 1); glass.position.set(0, y, z + 0.2); S.add(glass);
}

// ---------------------------------------------------------------- 交信室
export function kousin(S) {
  roomShell(S, { trim: C.teal, window: { gap: 1.25, rot: 0 } });
  spaceWindow(S);
  // envoy: translucent jelly with three eyes and drifting ribbons
  const env = new THREE.Group(); env.position.set(0, 3.3, -6.5); S.add(env);
  const jelly = new THREE.MeshStandardMaterial({ color: '#7ff0dc', emissive: '#1d7f73', emissiveIntensity: 0.6, roughness: 0.2, transparent: true, opacity: 0.86 });
  const bell = put(env, new THREE.SphereGeometry(1.5, 64, 48, 0, Math.PI * 2, 0, Math.PI * 0.62), jelly, 0, 0, 0); bell.scale.set(1, 1.05, 1);
  put(env, new THREE.TorusGeometry(1.22, 0.16, 20, 64), jelly, 0, -0.55, 0).rotation.x = Math.PI / 2;
  for (const [x, y, s] of [[-0.45, 0.35, 0.2], [0.45, 0.35, 0.2], [0, 0.72, 0.15]]) {
    put(env, new THREE.SphereGeometry(s, 32, 24), mat('#f8fbff', { roughness: 0.2 }), x, y, 1.28, false);
    put(env, new THREE.SphereGeometry(s * 0.55, 24, 16), mat('#10203a', { roughness: 0.1 }), x, y, 1.28 + s * 0.6, false); }
  const ribbons = [];
  for (let k = 0; k < 7; k++) { const a = k / 7 * 6.283, pts = [];
    for (let i = 0; i <= 8; i++) pts.push(new THREE.Vector3(Math.cos(a) * (1.0 - i * 0.04), -0.6 - i * 0.32, Math.sin(a) * (1.0 - i * 0.04)));
    const rb = put(env, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.07 - k * 0.002, 8), jelly, 0, 0, 0, false); rb.userData.a = a; ribbons.push(rb); }
  const envLight = new THREE.PointLight(C.teal, 8, 10, 2); envLight.position.set(0, 3.3, -5); S.add(envLight);
  // console desk with glowing glyph screen
  const desk = new THREE.Group(); desk.position.set(0, 0, -2.6); S.add(desk);
  put(desk, rbox(5.4, 1.1, 1.4, 0.35), mat('#c9cfe6', { roughness: 0.45 }), 0, 0.55, 0);
  const scr = put(desk, rbox(4.6, 0.08, 1.0, 0.04), glow('#3fd6bd', 0.7), 0, 1.13, 0.05, false); scr.rotation.x = -0.25;
  for (let k = 0; k < 6; k++) put(desk, new THREE.CylinderGeometry(0.11, 0.11, 0.08, 24), glow(['#ffb547', '#5fe0c8', '#86a9ff'][k % 3], 1.2), -1.9 + k * 0.76, 1.22, 0.45, false);
  // ring of floating glyph tiles (the alien "dictionary")
  const tiles = new THREE.Group(); tiles.position.set(0, 3.3, -6.5); S.add(tiles);
  for (let k = 0; k < 9; k++) { const a = k / 9 * 6.283; const t = put(tiles, rbox(0.62, 0.62, 0.06, 0.12), glow(k % 3 ? '#5fe0c8' : '#ffb547', 0.9), Math.cos(a) * 3, Math.sin(a * 2) * 0.4, Math.sin(a) * 1.4, false); t.lookAt(0, 0, 8); }
  const me = interpreter(C.amber); me.position.set(1.0, 0, 1.4); me.rotation.y = Math.PI * 1.02; S.add(me);
  const aya = interpreter(C.teal); aya.position.set(-1.6, 0, 0.6); aya.rotation.y = Math.PI * 0.9; S.add(aya);
  return {
    cam: { yaw: 0.28, pitch: 0.2, dist: 6.4, target: new THREE.Vector3(1.0, 1.9, 1.4), look: new THREE.Vector3(-1.2, 1.0, -7) },
    player: me, other: aya, lookAhead: 4, lookUp: 0.9, actLabel: null,
    walk: { ground: (x, z) => inRoom(x, z) && !inBox(x, z, 0, -2.6, 2.7, 0.7) && !inCircle(x, z, 0, -6.5, 1.9) ? 0 : null,
      interact: (x, z) => Math.hypot(x, z - 12) < 3 ? { label: '広場へ', go: () => { window.__goScene('plaza'); } } : null },
    tags: [{ pos: new THREE.Vector3(0, 5.4, -6.5), html: '<small>使者</small>ヴェル＝ナ', col: C.teal }],
    update(t) { env.position.y = 3.3 + Math.sin(t * 1.1) * 0.18; bell.scale.y = 1.05 + Math.sin(t * 2.2) * 0.04;
      ribbons.forEach((r, i) => { r.rotation.y = Math.sin(t * 0.9 + i) * 0.08; r.rotation.z = Math.sin(t * 1.3 + i * 2) * 0.05; });
      tiles.rotation.y = t * 0.2; },
  };
}

// ---------------------------------------------------------------- 分岐路
function guide(kind) {
  const g = new THREE.Group();
  const P = { pero: '#ffb08a', mimi: '#f5c6ea', gou: '#9fb3c9', nana: '#b6e39a' }[kind], m = mat(P, { roughness: 0.55 });
  put(g, new THREE.CylinderGeometry(0.85, 0.95, 0.5, 48), mat('#4a5590'), 0, 0.25, 0);
  put(g, new THREE.TorusGeometry(0.9, 0.05, 8, 64), glow(C.blue, 1), 0, 0.5, 0, false).rotation.x = Math.PI / 2;
  if (kind === 'pero') { put(g, new THREE.SphereGeometry(0.75, 48, 32), m, 0, 1.25, 0);
    put(g, new THREE.CylinderGeometry(0.03, 0.03, 0.6, 8), mat('#555'), 0, 2.2, 0); put(g, new THREE.SphereGeometry(0.12, 20, 16), glow('#ffd27a', 1.5), 0, 2.55, 0, false); }
  if (kind === 'mimi') { put(g, new THREE.CapsuleGeometry(0.55, 0.5, 12, 32), m, 0, 1.3, 0);
    for (const s of [-1, 1]) put(g, new THREE.CapsuleGeometry(0.16, 0.8, 8, 16), m, s * 0.32, 2.3, 0).rotation.z = -s * 0.25; }
  if (kind === 'gou') { put(g, rbox(1.3, 1.5, 1.1, 0.35), m, 0, 1.35, 0);
    put(g, rbox(0.9, 0.3, 0.1, 0.12), glow('#7fe8ff', 1.1), 0, 1.6, 0.56, false); }
  if (kind === 'nana') { put(g, new THREE.CapsuleGeometry(0.48, 1.2, 12, 32), m, 0, 1.55, 0);
    put(g, new THREE.ConeGeometry(0.5, 0.6, 32), mat('#6c5aa8'), 0, 2.75, 0); }
  const fy = kind === 'gou' ? 1.6 : kind === 'nana' ? 1.95 : 1.35, fz = kind === 'gou' ? 0.58 : kind === 'nana' ? 0.46 : kind === 'mimi' ? 0.55 : 0.72;
  if (kind !== 'gou') for (const s of [-1, 1]) { put(g, new THREE.SphereGeometry(0.09, 20, 16), mat('#1b1d2b', { roughness: 0.2 }), s * 0.2, fy, fz, false).scale.set(1, 1.3, 0.6);
    put(g, new THREE.SphereGeometry(0.07, 16, 12), mat('#ff9fb0'), s * 0.34, fy - 0.15, fz - 0.06, false).scale.set(1, 0.6, 0.4); }
  return g;
}
export function bunki(S) {
  roomShell(S, { trim: C.blue, wall: '#2a3168', floor: '#363f78' });
  // three tall doors on the back wall
  const doors = [];
  [-4.6, 0, 4.6].forEach((x, i) => {
    const d = new THREE.Group(); d.position.set(x, 0, -11.2); S.add(d);
    const s = new THREE.Shape(); s.moveTo(-1.5, 0); s.lineTo(-1.5, 3.3); s.absarc(0, 3.3, 1.5, Math.PI, 0, true); s.lineTo(1.5, 0);
    const frame = new THREE.Shape(); frame.moveTo(-1.9, 0); frame.lineTo(-1.9, 3.3); frame.absarc(0, 3.3, 1.9, Math.PI, 0, true); frame.lineTo(1.9, 0); frame.lineTo(1.5, 0); frame.lineTo(1.5, 3.3); frame.absarc(0, 3.3, 1.5, 0, Math.PI, false); frame.lineTo(-1.5, 0);
    put(d, new THREE.ExtrudeGeometry(frame, { depth: 0.5, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 3, curveSegments: 32 }), mat('#cfd4ee', { roughness: 0.5 }), 0, 0, 0);
    const leaf = put(d, new THREE.ExtrudeGeometry(s, { depth: 0.15, bevelEnabled: false, curveSegments: 32 }), mat(['#3a4a8a', '#4a3a7a', '#2f5a7a'][i], { roughness: 0.5 }), 0, 0, 0.1);
    put(d, new THREE.CircleGeometry(0.42, 48), glow(C.blue, 1.1), 0, 3.5, 0.3, false);
    doors.push(leaf);
  });
  const names = [['pero', -5.2, -4.2, 'ペロ'], ['mimi', -1.8, -6.2, 'ミミ'], ['gou', 1.8, -6.2, 'ゴウ'], ['nana', 5.2, -4.2, 'ナナ']];
  const gs = names.map(([k, x, z]) => { const g = guide(k); g.position.set(x, 0, z); g.lookAt(0, 0, 3); S.add(g); return g; });
  const me = interpreter(C.amber); me.position.set(0.8, 0, 2.6); me.rotation.y = Math.PI * 1.0; S.add(me);
  const aya = interpreter(C.teal); aya.position.set(-1.4, 0, 1.8); aya.rotation.y = Math.PI * 0.86; S.add(aya);
  return {
    cam: { yaw: 0.2, pitch: 0.24, dist: 7.5, target: new THREE.Vector3(0.8, 2.0, 2.6), look: new THREE.Vector3(-0.8, 0.6, -7) },
    player: me, other: aya, lookAhead: 4, lookUp: 0.6, actLabel: null,
    walk: { ground: (x, z) => inRoom(x, z) && z > -10.2 && !names.some(([k, gx, gz]) => inCircle(x, z, gx, gz, 1.35)) ? 0 : null,
      interact: (x, z) => { const n = names.find(([k, gx, gz]) => inCircle(x, z, gx, gz, 2.6)); return n ? { label: n[3] + 'に質問', go: () => window.__guide && window.__guide(n[0]) } : Math.hypot(x, z - 12) < 3 ? { label: '広場へ', go: () => { window.__goScene('plaza'); } } : null; } },
    tags: names.map(([k, x, z, n], i) => ({ pos: new THREE.Vector3(x, k === 'nana' ? 3.5 : k === 'mimi' ? 3.3 : 2.8, z), html: `<small>${i < 2 ? 'ユウが質問できる' : 'アヤが質問できる'}</small>${n}`, col: i < 2 ? C.amber : C.teal })),
    update(t) { gs.forEach((g, i) => { g.children.forEach((c, j) => { if (j > 1) c.position.y += Math.sin(t * 2 + i) * 0.0015; }); }); },
  };
}

// ---------------------------------------------------------------- 和平会議
function krill() { // coral-shell people: rounded shell body, small claws
  const g = new THREE.Group(), m = mat('#f08a6a', { roughness: 0.5 });
  put(g, new THREE.SphereGeometry(0.8, 48, 32), m, 0, 1.05, 0).scale.set(1, 0.9, 0.85);
  for (let k = 0; k < 5; k++) put(g, new THREE.TorusGeometry(0.62 - k * 0.04, 0.05, 8, 48, Math.PI), mat('#d9694c'), 0, 0.85 + k * 0.17, -0.1).rotation.y = Math.PI / 2;
  for (const s of [-1, 1]) { const arm = put(g, new THREE.CapsuleGeometry(0.12, 0.5, 8, 16), m, s * 0.85, 1.1, 0.25); arm.rotation.z = s * 0.9;
    put(g, new THREE.SphereGeometry(0.24, 24, 16, 0, Math.PI * 1.6), m, s * 1.15, 1.45, 0.35).rotation.z = s * 0.6;
    put(g, new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), m, s * 0.25, 1.95, 0.3).rotation.z = -s * 0.3;
    put(g, new THREE.SphereGeometry(0.11, 20, 16), mat('#1b1d2b', { roughness: 0.2 }), s * 0.32, 2.15, 0.32, false); }
  return g;
}
function gura() { // moss people: tall soft bean with leaf crown
  const g = new THREE.Group(), m = mat('#8cc48a', { roughness: 0.75 });
  put(g, new THREE.CapsuleGeometry(0.62, 0.9, 12, 32), m, 0, 1.25, 0);
  for (let k = 0; k < 5; k++) { const a = k / 5 * 6.283; const l = put(g, new THREE.SphereGeometry(0.28, 24, 16), mat('#5f9a5e'), Math.cos(a) * 0.35, 2.35, Math.sin(a) * 0.35); l.scale.set(0.5, 1.4, 0.5); l.rotation.set(Math.sin(a) * 0.6, 0, -Math.cos(a) * 0.6); }
  for (const s of [-1, 1]) { put(g, new THREE.SphereGeometry(0.1, 20, 16), mat('#1b1d2b', { roughness: 0.2 }), s * 0.22, 1.7, 0.56, false).scale.set(1, 1.3, 0.6);
    put(g, new THREE.CapsuleGeometry(0.13, 0.45, 8, 16), m, s * 0.7, 1.1, 0.1).rotation.z = s * 0.4; }
  return g;
}
export function kaigi(S) {
  roomShell(S, { trim: C.amber, wall: '#33305c', floor: '#403a66', window: { gap: 1.1, rot: 0 } });
  spaceWindow(S, { w: 10, h: 4.6, y: 3.6 });
  put(S, new THREE.CylinderGeometry(3.6, 3.6, 0.3, 96), mat('#d9b98a', { roughness: 0.45 }), 0, 1.15, -4);
  put(S, new THREE.CylinderGeometry(3.0, 3.2, 1.0, 96), mat('#7a5a44'), 0, 0.5, -4);
  put(S, new THREE.TorusGeometry(3.6, 0.06, 8, 128), glow(C.amber, 0.9), 0, 1.31, -4, false).rotation.x = Math.PI / 2;
  // flags of both peoples
  for (const [x, c] of [[-6.5, '#f08a6a'], [6.5, '#8cc48a']]) { put(S, new THREE.CylinderGeometry(0.06, 0.06, 4, 12), mat('#cfc6b3'), x, 2, -7.5);
    const f = put(S, rbox(1.4, 2.0, 0.05, 0.1), mat(c, { roughness: 0.8 }), x + 0.75, 3, -7.5); }
  const left = [], right = [];
  for (const [x, z] of [[-4.9, -4.0], [-4.4, -6.4], [-2.6, -8.3]]) { const k = krill(); k.position.set(x, 0, z); k.lookAt(0, 0, -4); S.add(k); left.push(k); }
  for (const [x, z] of [[4.9, -4.0], [4.4, -6.4], [2.6, -8.3]]) { const g = gura(); g.position.set(x, 0, z); g.lookAt(0, 0, -4); S.add(g); right.push(g); }
  // tension "weather": a soft orb over the table changes colour with tension
  const orb = put(S, new THREE.SphereGeometry(0.55, 48, 32), glow('#ffb547', 1.4), 0, 3.4, -4, false);
  const ol = new THREE.PointLight('#ffb547', 6, 10, 2); ol.position.set(0, 3.4, -4); S.add(ol);
  const me = interpreter(C.amber); me.position.set(-1.3, 0, 0.6); me.rotation.y = Math.PI * 1.1; S.add(me);
  const aya = interpreter(C.teal); aya.position.set(1.3, 0, 0.6); aya.rotation.y = Math.PI * 0.9; S.add(aya);
  return {
    cam: { yaw: -0.05, pitch: 0.46, dist: 6.6, target: new THREE.Vector3(0, 2.0, 1.0), look: new THREE.Vector3(0, -0.2, -6) },
    player: me, other: aya, lookAhead: 4.5, lookUp: 0.2, actLabel: null,
    walk: { ground: (x, z) => inRoom(x, z) && !inCircle(x, z, 0, -4, 4.1) && ![...left, ...right].some(o => inCircle(x, z, o.position.x, o.position.z, 1.2)) && !inBox(x, z, -6.5, -7.5, 0.3, 0.3) && !inBox(x, z, 6.5, -7.5, 0.3, 0.3) ? 0 : null,
      interact: (x, z) => Math.hypot(x, z - 12) < 3 ? { label: '広場へ', go: () => { window.__goScene('plaza'); } } : null },
    tags: [{ pos: new THREE.Vector3(-4.9, 3.0, -4.0), html: '<small>クリル族の代表</small>ハサ長老', col: '#f08a6a' }, { pos: new THREE.Vector3(4.9, 3.4, -4.0), html: '<small>グラ族の代表</small>モス議長', col: '#8cc48a' }],
    update(t) { orb.scale.setScalar(1 + Math.sin(t * 2.4) * 0.06); left.forEach((k, i) => k.position.y = Math.abs(Math.sin(t * 1.8 + i)) * 0.04); right.forEach((g, i) => g.rotation.z = Math.sin(t * 0.9 + i) * 0.03); },
  };
}

// ---------------------------------------------------------------- 執務室（出勤してまず座る自分のデスク）
export function office(S, opt = {}) {
  S.background = new THREE.Color('#0a0f26'); S.fog = new THREE.Fog('#0a0f26', 18, 40);
  lights(S, { hemi: 0.7, sunI: 0.9, pos: [-6, 14, 8], area: 10, sky: '#b9c4ff', ground: '#3a2e40', sun: '#ffd9b0' });
  const W = 9, D = 7, H = 4.2;
  put(S, rbox(W, 0.2, D, 0.08), mat('#5a4a5e', { roughness: 0.8 }), 0, -0.1, 0);                     // floor
  put(S, new THREE.CircleGeometry(1.9, 64), mat('#8a6a9a', { roughness: 1 }), -0.2, 0.01, 0.6, false).rotation.x = -Math.PI / 2; // round rug
  put(S, rbox(W, H, 0.3, 0.1), mat('#3a4478', { roughness: 0.8 }), 0, H / 2, -D / 2);               // back wall (window cut by overlay)
  for (const s of [-1, 1]) put(S, rbox(0.3, H, D, 0.1), mat('#343d6e', { roughness: 0.8 }), s * W / 2, H / 2, 0);
  // big round window onto the bureau island
  const win = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.6), new THREE.ShaderMaterial({ fog: false,
    vertexShader: 'varying vec2 u; void main(){u=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying vec2 u; float h(vec2 p){return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453);} void main(){ vec3 c=mix(vec3(.05,.07,.2),vec3(.2,.14,.36),1.-u.y); c+=vec3(step(.992,h(floor(u*vec2(240.,140.))))); vec2 p=u-vec2(.5,.18); float land=smoothstep(.02,0.,length(p*vec2(1.,3.2))-.28); c=mix(c,vec3(.36,.55,.42),land); float bt=smoothstep(.01,0.,abs(p.x+.12)-.015)*step(0.,p.y)*step(p.y,.16); float bt2=smoothstep(.01,0.,abs(p.x-.14)-.02)*step(0.,p.y)*step(p.y,.12); c=mix(c,vec3(.92,.88,.8),max(bt,bt2)); float bc=smoothstep(.012,0.,length(p-vec2(0.,.17))-.01); c+=vec3(1.,.8,.45)*bc; vec2 q=u-vec2(.82,.78); c=mix(c,vec3(.42,.42,.85),smoothstep(.1,.095,length(q))); gl_FragColor=vec4(c,1.);}' }));
  win.position.set(0.6, 2.4, -D / 2 + 0.17); S.add(win);
  const fr = new THREE.Shape(); fr.moveTo(-2.6, -1.6); fr.lineTo(2.6, -1.6); fr.lineTo(2.6, 1.6); fr.lineTo(-2.6, 1.6);
  const hl = new THREE.Path(); hl.moveTo(-2.3, -1.3); hl.absarc(-1.8, -0.8, 0.5, Math.PI * 1.5, Math.PI, true); hl.absarc(-1.8, 0.8, 0.5, Math.PI, Math.PI / 2, true); hl.absarc(1.8, 0.8, 0.5, Math.PI / 2, 0, true); hl.absarc(1.8, -0.8, 0.5, 0, -Math.PI / 2, true); fr.holes.push(hl);
  put(S, new THREE.ExtrudeGeometry(fr, { depth: 0.15, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 3, curveSegments: 16 }), mat('#d6dbef', { roughness: 0.5 }), 0.6, 2.4, -D / 2 + 0.15);
  // shelves with dictionaries
  const sh = new THREE.Group(); sh.position.set(-3.4, 0, -2.9); S.add(sh);
  put(sh, rbox(1.8, 3.2, 0.7, 0.08), mat('#8a6a52'), 0, 1.6, 0);
  for (let r = 0; r < 3; r++) { put(sh, rbox(1.6, 0.06, 0.6, 0.02), mat('#a7845f'), 0, 0.6 + r * 0.95, 0.05);
    let x = -0.7; for (let k = 0; k < 7; k++) { const w = 0.12 + ((k * 7 + r * 3) % 4) * 0.03, h = 0.55 + ((k + r) % 3) * 0.1;
      put(sh, rbox(w, h, 0.45, 0.03), mat(['#e07a5f', '#5fe0c8', '#86a9ff', '#ffb547', '#c7a6ff', '#8cc48a'][(k + r) % 6], { roughness: 0.6 }), x + w / 2, 0.65 + r * 0.95 + h / 2, 0.1); x += w + 0.03; } }
  // desk + chair + things on it
  const desk = new THREE.Group(); desk.position.set(0.4, 0, -1.3); S.add(desk);
  put(desk, rbox(3.4, 0.14, 1.5, 0.06), mat('#b88a62', { roughness: 0.55 }), 0, 1.05, 0);
  for (const [x, z] of [[-1.5, -0.6], [1.5, -0.6], [-1.5, 0.6], [1.5, 0.6]]) put(desk, new THREE.CylinderGeometry(0.05, 0.05, 1.0, 12), mat('#4b4f6e'), x, 0.5, z);
  put(desk, rbox(1.6, 0.95, 0.08, 0.06), mat('#22284a'), 0, 1.75, -0.45);                               // screen
  const screen = put(desk, rbox(1.46, 0.8, 0.02, 0.04), glow('#3d6f9a', 0.7), 0, 1.75, -0.4, false);
  put(desk, new THREE.CylinderGeometry(0.05, 0.08, 0.3, 12), mat('#4b4f6e'), 0, 1.25, -0.45);
  put(desk, rbox(0.9, 0.04, 0.3, 0.02), mat('#d9dceb'), 0, 1.14, 0.15);                                 // keyboard
  put(desk, new THREE.CylinderGeometry(0.11, 0.09, 0.22, 24), mat('#f2ede2'), 1.1, 1.23, 0.1);          // mug
  put(desk, new THREE.TorusGeometry(0.07, 0.02, 8, 24), mat('#f2ede2'), 1.22, 1.23, 0.1).rotation.y = Math.PI / 2;
  for (let k = 0; k < 3; k++) put(desk, rbox(0.55, 0.06, 0.4, 0.02), mat(['#86a9ff', '#ffb547', '#5fe0c8'][k]), -1.1, 1.15 + k * 0.065, 0.1 + k * 0.02).rotation.y = k * 0.12;
  put(desk, new THREE.CylinderGeometry(0.12, 0.1, 0.18, 24), mat('#d9cfba'), 1.35, 1.21, -0.45);         // plant pot
  for (let k = 0; k < 5; k++) { const l = put(desk, new THREE.SphereGeometry(0.1, 16, 12), mat('#5f9a5e'), 1.35 + Math.cos(k) * 0.08, 1.4 + k * 0.03, -0.45 + Math.sin(k) * 0.08); l.scale.set(0.6, 1.4, 0.6); l.rotation.z = Math.cos(k) * 0.6; }
  const lamp = new THREE.PointLight('#ffd9a8', 4, 5, 2); lamp.position.set(-0.9, 2.1, -1.0); S.add(lamp);
  put(desk, new THREE.CylinderGeometry(0.03, 0.03, 0.8, 12), mat('#4b4f6e'), -1.3, 1.5, -0.4);
  put(desk, new THREE.ConeGeometry(0.2, 0.22, 24, 1, true), mat('#ffb547', { side: THREE.DoubleSide }), -1.3, 1.95, -0.35).rotation.x = -0.4;
  const chair = new THREE.Group(); chair.position.set(0.4, 0, 0.35); S.add(chair);
  put(chair, new THREE.CylinderGeometry(0.42, 0.42, 0.14, 32), mat('#3b4472'), 0, 0.6, 0);
  put(chair, rbox(0.8, 0.8, 0.12, 0.1), mat('#3b4472'), 0, 1.1, 0.38);
  put(chair, new THREE.CylinderGeometry(0.05, 0.05, 0.55, 12), mat('#4b4f6e'), 0, 0.3, 0);
  const me = interpreter(opt.col || C.amber); me.position.set(0.4, 0.32, 0.25); me.rotation.y = Math.PI; me.userData.seated = true; me.userData.seatY = 0.32; S.add(me);
  // the day's work order hovers above the screen
  return {
    cam: { yaw: 0.78, pitch: 0.3, dist: 4.4, target: new THREE.Vector3(0.4, 1.6, 0.4), look: new THREE.Vector3(-1.0, 0.4, -2) },
    player: me, lookAhead: 1.6, lookUp: 0.2, actLabel: null, camHeight: 1.3,
    walk: { ground: (x, z) => Math.abs(x) < 4.1 && Math.abs(z) < 3.1 && !inBox(x, z, 0.4, -1.3, 1.7, 0.75, 0.25) && !inBox(x, z, -3.4, -2.9, 0.9, 0.35, 0.25) ? 0 : null },
    tags: [],
    update(t) { screen.material.emissiveIntensity = 0.65 + Math.sin(t * 3) * 0.05; },
  };
}
