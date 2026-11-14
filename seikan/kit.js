// Shared look for every scene: smooth shading, rounded shapes, soft light.
import * as THREE from 'three';
export { THREE };

export const C = {
  sky: '#0b1230', skyLow: '#1a2350', grass: '#6f9a72', grassDark: '#5b8463', stone: '#d8d0bf', stoneDark: '#b9b0a0',
  wood: '#9a7454', woodDark: '#7a5a42', rock: '#6f6a85', teal: '#5FE0C8', blue: '#86A9FF', amber: '#FFB547', cream: '#f4eee2',
};

export function renderer(canvas) {
  const R = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  R.setPixelRatio(Math.min(devicePixelRatio, 2));
  R.shadowMap.enabled = true; R.shadowMap.type = THREE.PCFSoftShadowMap;
  R.toneMapping = THREE.ACESFilmicToneMapping; R.toneMappingExposure = 1.05;
  return R;
}

// soft matte plastic / clay look
export const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.72, metalness: 0.0, ...o });
export const glow = (c, i = 1.6) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i, roughness: 0.4 });
export const basic = c => new THREE.MeshBasicMaterial({ color: c });

export function put(parent, geo, m, x = 0, y = 0, z = 0, shadow = true) {
  const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = shadow; parent.add(o); return o;
}

// rounded box (smooth bevel) — the main building block instead of hard boxes
export function rbox(w, h, d, r = 0.2, seg = 4) {
  r = Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001);
  const s = new THREE.Shape(), x = -w / 2 + r, y = -h / 2 + r, W = w - 2 * r, H = h - 2 * r;
  s.moveTo(x, y - r); s.lineTo(x + W, y - r); s.quadraticCurveTo(x + W + r, y - r, x + W + r, y);
  s.lineTo(x + W + r, y + H); s.quadraticCurveTo(x + W + r, y + H + r, x + W, y + H + r);
  s.lineTo(x, y + H + r); s.quadraticCurveTo(x - r, y + H + r, x - r, y + H); s.lineTo(x - r, y); s.quadraticCurveTo(x - r, y - r, x, y - r);
  const g = new THREE.ExtrudeGeometry(s, { depth: d - 2 * r, bevelEnabled: true, bevelThickness: r, bevelSize: r * 0.999, bevelSegments: seg, curveSegments: seg * 2 });
  g.translate(0, 0, -(d - 2 * r) / 2); g.computeVertexNormals(); return g;
}

// gentle lumpy sphere for rocks, bushes, clouds
export function blob(r, detail = 3, amt = 0.12, seed = 1) {
  const g = new THREE.IcosahedronGeometry(r, detail), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); const n = v.clone().normalize();
    const k = 1 + amt * (Math.sin(n.x * 3.1 + seed) * Math.sin(n.y * 2.7 + seed * 2) + 0.5 * Math.sin(n.z * 5.3 + seed * 3));
    v.multiplyScalar(k); p.setXYZ(i, v.x, v.y, v.z); }
  g.computeVertexNormals(); return g;
}

export function lights(S, { sky = '#9fb4ff', ground = '#3a3150', hemi = 1.0, sun = '#ffe3c0', sunI = 1.7, pos = [-28, 40, 20], area = 40 } = {}) {
  S.add(new THREE.HemisphereLight(sky, ground, hemi));
  const L = new THREE.DirectionalLight(sun, sunI); L.position.set(...pos); L.castShadow = true;
  L.shadow.mapSize.set(2048, 2048); Object.assign(L.shadow.camera, { left: -area, right: area, top: area, bottom: -area, near: 1, far: 140 });
  L.shadow.bias = -0.0004; L.shadow.normalBias = 0.03; L.shadow.radius = 4; S.add(L);
  const rim = new THREE.DirectionalLight('#7fb0ff', 0.55); rim.position.set(25, 18, -30); S.add(rim);
  return L;
}

export function starSky(S, { planet = true } = {}) {
  const g = new THREE.BufferGeometry(), n = 1600, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const t = Math.random() * 6.283, u = Math.random() * 0.95 + 0.03, r = 200;
    a.set([r * Math.cos(t) * Math.sqrt(1 - u * u), r * u - 25, r * Math.sin(t) * Math.sqrt(1 - u * u)], i * 3); }
  g.setAttribute('position', new THREE.BufferAttribute(a, 3));
  S.add(new THREE.Points(g, new THREE.PointsMaterial({ color: '#d8e0ff', size: 1.1, sizeAttenuation: false, fog: false })));
  // soft gradient dome
  const dome = new THREE.Mesh(new THREE.SphereGeometry(230, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color('#070b1f') }, mid: { value: new THREE.Color('#151d4a') }, low: { value: new THREE.Color('#3a2b5e') } },
    vertexShader: 'varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.); }',
    fragmentShader: 'uniform vec3 top,mid,low; varying vec3 p; void main(){ float h=p.y; vec3 c = h>0.1? mix(mid,top,smoothstep(0.1,0.7,h)) : mix(low,mid,smoothstep(-0.25,0.1,h)); gl_FragColor=vec4(c,1.); }' }));
  dome.renderOrder = -1; S.add(dome);
  if (planet) {
    const pl = new THREE.Mesh(new THREE.SphereGeometry(26, 64, 48), new THREE.MeshStandardMaterial({ color: '#5a5fc0', roughness: 1, fog: false }));
    pl.position.set(-100, 60, -150); S.add(pl);
    const ring = new THREE.Mesh(new THREE.RingGeometry(34, 47, 128), new THREE.MeshBasicMaterial({ color: '#a99ae6', side: THREE.DoubleSide, transparent: true, opacity: 0.35, fog: false }));
    ring.position.copy(pl.position); ring.rotation.set(1.25, 0.25, 0.2); S.add(ring);
    const moon = new THREE.Mesh(new THREE.SphereGeometry(5, 32, 24), new THREE.MeshBasicMaterial({ color: '#f0e4c8', fog: false }));
    moon.position.set(115, 75, -120); S.add(moon);
  }
}

// chibi interpreter: big round head, small body, scarf in the player colour, satchel
export function interpreter(col, { scale = 1 } = {}) {
  const g = new THREE.Group();
  const skin = mat('#f6e3cf', { roughness: 0.6 }), suit = mat('#2f3a66', { roughness: 0.6 }), acc = mat(col, { roughness: 0.5 });
  put(g, new THREE.CapsuleGeometry(0.36, 0.42, 8, 24), suit, 0, 0.62, 0);                   // body
  put(g, new THREE.TorusGeometry(0.3, 0.1, 12, 32), acc, 0, 1.0, 0).rotation.x = Math.PI / 2; // scarf
  const tail = put(g, rbox(0.16, 0.42, 0.06, 0.03), acc, 0.12, 0.8, -0.34); tail.rotation.z = -0.2;
  put(g, new THREE.SphereGeometry(0.5, 40, 32), skin, 0, 1.48, 0);                           // head
  const hair = put(g, new THREE.SphereGeometry(0.53, 40, 32, 0, Math.PI * 2, 0, Math.PI * 0.55), mat('#3b2a26', { roughness: 0.55 }), 0, 1.52, -0.03);
  hair.rotation.x = -0.25;
  for (const s of [-1, 1]) {
    put(g, new THREE.SphereGeometry(0.075, 20, 16), mat('#1b1d2b', { roughness: 0.2 }), s * 0.17, 1.47, 0.45, false).scale.set(1, 1.35, 0.6); // eyes
    put(g, new THREE.SphereGeometry(0.06, 16, 12), mat('#ffb3a6', { roughness: 0.8 }), s * 0.28, 1.36, 0.4, false).scale.set(1, 0.6, 0.4); // cheeks
    put(g, new THREE.CapsuleGeometry(0.1, 0.22, 6, 12), suit, s * 0.4, 0.62, 0).rotation.z = s * 0.25;                   // arms
    put(g, new THREE.CapsuleGeometry(0.11, 0.12, 6, 12), mat('#20284a'), s * 0.15, 0.14, 0);                             // legs
  }
  put(g, rbox(0.42, 0.46, 0.2, 0.06), mat('#8a6a4e'), 0, 0.7, -0.4);                                 // satchel
  put(g, new THREE.TorusGeometry(0.33, 0.035, 8, 32, Math.PI), mat('#6d533e'), 0, 0.7, -0.1).rotation.z = Math.PI * 0.75; // strap
  // floating badge above head in player colour
  const badge = put(g, new THREE.OctahedronGeometry(0.11, 0), glow(col, 1.2), 0, 2.25, 0, false); g.userData.badge = badge;
  g.scale.setScalar(scale); return g;
}

export function orbitCam(frame, cam, o) {
  const st = { yaw: o.yaw, pitch: o.pitch, dist: o.dist, target: o.target.clone(), look: o.look || new THREE.Vector3() };
  st.apply = () => { const t = st.target;
    cam.position.set(t.x + Math.sin(st.yaw) * Math.cos(st.pitch) * st.dist, t.y + Math.sin(st.pitch) * st.dist, t.z + Math.cos(st.yaw) * Math.cos(st.pitch) * st.dist);
    cam.lookAt(t.x + st.look.x, t.y + st.look.y, t.z + st.look.z); };
  window.__setView = (y, p, dd) => { st.yaw = y; st.pitch = p; if (dd) st.dist = dd; };
  return st;
}

export function tagger(frame, cam, items) { // items: [{pos:Vector3, html, col}] — hidden where they would cover a UI panel, nudged up when they touch each other
  const box = document.createElement('div'); box.className = 'tagbox'; frame.querySelectorAll('.tagbox').forEach(b => b.remove()); frame.appendChild(box);
  for (const it of items) { it.el = document.createElement('div'); it.el.className = 'tag'; it.el.style.setProperty('--c', it.col); it.el.innerHTML = it.html; box.appendChild(it.el); }
  const fr = r0 => r0, hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
  return () => { const w = frame.clientWidth, h = frame.clientHeight;
    const plates = [...frame.querySelectorAll('#topbar > *, #stick, .act, #lobby, #logo, #coach')].filter(e => e.offsetParent).map(e => ({ l: e.offsetLeft, t: e.offsetTop, r: e.offsetLeft + e.offsetWidth, b: e.offsetTop + e.offsetHeight }));
    const shown = [];
    for (const it of items) { const v = it.pos.clone().project(cam); let px = (v.x + 1) / 2 * w, py = (1 - v.y) / 2 * h;
      if (it.el.offsetWidth) { it.w = it.el.offsetWidth; it.h = it.el.offsetHeight; } const tw = it.w || 110, th = it.h || 38;
      let rc = { l: px - tw / 2, r: px + tw / 2, t: py - th, b: py };
      for (const o of shown) if (hit(rc, o)) { const dy = rc.b - o.t + 4; py -= dy; rc = { l: rc.l, r: rc.r, t: rc.t - dy, b: rc.b - dy }; }
      const ok = v.z < 1 && rc.l > 4 && rc.r < w - 4 && rc.t > 4 && rc.b < h - 4 && !plates.some(p => hit(rc, p));
      it.el.style.display = ok ? 'block' : 'none'; if (ok) shown.push(rc);
      it.el.style.left = px + 'px'; it.el.style.top = py + 'px'; } };
}
