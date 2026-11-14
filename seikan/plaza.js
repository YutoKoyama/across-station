import { THREE, C, mat, glow, put, rbox, blob, lights, starSky, interpreter } from './kit.js';
import { inCircle } from './move.js';

export const JOBS = [
  { key: 'kousin', name: '交信室', sub: '異星語の解読', col: C.teal, ang: -Math.PI / 2 },
  { key: 'bunki', name: '分岐路', sub: 'うそつき案内人', col: C.blue, ang: -Math.PI / 2 + 2 * Math.PI / 3 },
  { key: 'kaigi', name: '和平会議', sub: '通訳官', col: C.amber, ang: -Math.PI / 2 - 2 * Math.PI / 3 },
];

export function build(S, opt = {}) {
  S.fog = new THREE.Fog('#141c45', 70, 170);
  lights(S, { area: 46 }); starSky(S);
  const LAND_R = 36, PLAZA_R = 7.6, MOAT_IN = 7.7, MOAT_OUT = 10.4, BLD_D = 23;
  const dir = a => new THREE.Vector3(Math.cos(a), 0, Math.sin(a));

  // ---- landmass: soft rolling top + rounded rock underside
  { const g = new THREE.CircleGeometry(LAND_R, 96, 0, Math.PI * 2); g.rotateX(-Math.PI / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), r = Math.hypot(x, z), a = Math.atan2(z, x);
      const edge = 1 + 0.05 * Math.sin(a * 5) + 0.03 * Math.sin(a * 13 + 1);
      const k = r / LAND_R; let y = 0;
      if (r > 14) y = 0.35 * Math.sin(x * 0.18) * Math.sin(z * 0.21) * Math.min(1, (r - 14) / 6);
      p.setXYZ(i, x * edge, y - 0.02, z * edge); }
    g.computeVertexNormals(); put(S, g, mat(C.grass, { roughness: 0.95 }));
    const rim = new THREE.LatheGeometry([new THREE.Vector2(LAND_R * 1.02, 0), new THREE.Vector2(LAND_R * 0.99, -1.4), new THREE.Vector2(LAND_R * 0.86, -5), new THREE.Vector2(LAND_R * 0.55, -13), new THREE.Vector2(LAND_R * 0.22, -22), new THREE.Vector2(0.01, -27)], 96);
    const q = rim.attributes.position; for (let i = 0; i < q.count; i++) { const x = q.getX(i), z = q.getZ(i), y = q.getY(i), a = Math.atan2(z, x);
      const k = 1 + 0.05 * Math.sin(a * 5) + 0.03 * Math.sin(a * 13 + 1) + (y < -1 ? 0.06 * Math.sin(a * 9 + y * 0.7) : 0); q.setXYZ(i, x * k, y, z * k); }
    rim.computeVertexNormals(); put(S, rim, mat('#6a5d7e', { roughness: 1 }));
    put(S, new THREE.TorusGeometry(LAND_R * 1.0, 0.7, 12, 160), mat(C.grassDark, { roughness: 1 }), 0, -0.45, 0).rotation.x = Math.PI / 2;
    for (const [x, y, z, s] of [[48, -7, 12, 3.2], [-50, -11, -14, 4], [22, -15, -48, 2.6], [-32, 1, 44, 2]])
    { const rk = put(S, blob(s, 3, 0.18, x), mat('#6a5d7e', { roughness: 1 }), x, y, z); put(rk, blob(s * 0.8, 3, 0.1, y), mat(C.grassDark), 0, s * 0.45, 0).scale.y = 0.45; }
  }

  // ---- plaza: pale stone disc, inlaid compass rings, water channel, 3 bridges
  put(S, new THREE.CylinderGeometry(PLAZA_R, PLAZA_R + 0.15, 0.5, 96), mat(C.stone), 0, 0.25, 0);
  for (const [r, w, c] of [[6.6, 0.12, '#c4b79c'], [4.3, 0.1, '#c4b79c'], [2.4, 0.16, '#d9b67a']])
    put(S, new THREE.RingGeometry(r - w, r, 96), mat(c, { side: THREE.DoubleSide }), 0, 0.505, 0, false).rotation.x = -Math.PI / 2;
  const water = new THREE.Mesh(new THREE.RingGeometry(MOAT_IN, MOAT_OUT, 128), new THREE.MeshStandardMaterial({ color: '#3a9fbf', emissive: '#1a5f7a', emissiveIntensity: 0.6, roughness: 0.12, metalness: 0.2, transparent: true, opacity: 0.92 }));
  water.rotation.x = -Math.PI / 2; water.position.y = 0.05; water.receiveShadow = true; S.add(water);
  put(S, new THREE.TorusGeometry(MOAT_OUT + 0.15, 0.22, 16, 160), mat(C.stoneDark), 0, 0.12, 0).rotation.x = Math.PI / 2;
  // centre beacon
  put(S, new THREE.CylinderGeometry(1.5, 1.8, 0.7, 48), mat('#9c97b0'), 0, 0.85, 0);
  put(S, new THREE.LatheGeometry([0, 0.5, 0.42, 0.34, 0.3, 0.36, 0].map((r, i) => new THREE.Vector2(Math.max(r, 0.001), i * 0.75)), 48), mat(C.cream), 0, 1.2, 0);
  const halo = put(S, new THREE.TorusGeometry(1.15, 0.06, 16, 96), glow('#ffd28a', 2.2), 0, 4.9, 0, false);
  const orb = put(S, new THREE.SphereGeometry(0.34, 32, 24), glow('#ffe9be', 2.5), 0, 5.8, 0, false);
  const bl = new THREE.PointLight('#ffcf7a', 7, 18, 2); bl.position.set(0, 5.4, 0); S.add(bl);

  const tags = [];
  for (const j of JOBS) {
    const d = dir(j.ang), yaw = -j.ang + Math.PI / 2;
    // arched bridge
    const br = new THREE.Group(); br.position.copy(d.clone().multiplyScalar((MOAT_IN + MOAT_OUT) / 2)); br.rotation.y = yaw; S.add(br);
    const arch = new THREE.Shape(); arch.moveTo(-2.4, 0); arch.quadraticCurveTo(0, 0.9, 2.4, 0); arch.lineTo(2.4, 0.35); arch.quadraticCurveTo(0, 1.25, -2.4, 0.35);
    const deck = new THREE.ExtrudeGeometry(arch, { depth: 3, bevelEnabled: true, bevelSize: 0.06, bevelThickness: 0.06, bevelSegments: 3, curveSegments: 24 });
    deck.translate(0, 0.1, -1.5); deck.rotateY(Math.PI / 2); put(br, deck, mat(C.wood));
    for (const s of [-1, 1]) {
      const rail = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(s * 1.45, 1.1, -2.3), new THREE.Vector3(s * 1.45, 2.0, 0), new THREE.Vector3(s * 1.45, 1.1, 2.3)), 24, 0.07, 8);
      put(br, rail, mat(C.woodDark));
      for (const z of [-2.2, 2.2]) { put(br, new THREE.CylinderGeometry(0.1, 0.12, 0.9, 16), mat(C.woodDark), s * 1.45, 0.75, z);
        put(br, new THREE.SphereGeometry(0.17, 20, 16), glow(j.col, 1.6), s * 1.45, 1.3, z, false); }
    }
    // path with soft lamp posts
    const len = BLD_D - MOAT_OUT - 4.6, pg = new THREE.Group(); pg.position.copy(d.clone().multiplyScalar(MOAT_OUT + len / 2)); pg.rotation.y = yaw; S.add(pg);
    put(pg, rbox(3.4, 0.2, len, 0.09), mat('#e0d7c4'), 0, 0.06, 0);
    for (let k = 0; k < 3; k++) for (const s of [-1, 1]) { const z = -len / 2 + 1.2 + k * (len - 2.4) / 2;
      put(pg, new THREE.CylinderGeometry(0.06, 0.08, 1.5, 12), mat('#4b4f6e'), s * 2.1, 0.75, z);
      put(pg, new THREE.SphereGeometry(0.2, 20, 16), glow(j.col, 1.3), s * 2.1, 1.6, z, false); }
    // building
    const b = new THREE.Group(); b.position.copy(d.clone().multiplyScalar(BLD_D)); b.rotation.y = yaw + Math.PI; S.add(b);
    put(b, new THREE.CylinderGeometry(6.4, 6.9, 0.8, 64), mat('#cfc6b3'), 0, 0.4, 0);
    put(b, new THREE.CylinderGeometry(6.0, 6.4, 0.25, 64), mat('#e2dac8'), 0, 0.92, 0);
    buildings[j.key](b, j.col);
    const L = new THREE.PointLight(j.col, 6, 15, 2); L.position.copy(d.clone().multiplyScalar(BLD_D - 4.5)).setY(3); S.add(L);
    tags.push({ pos: d.clone().multiplyScalar(BLD_D).setY(j.key === 'kousin' ? 14.2 : 12.6), html: `<small>${j.sub}</small>${j.name}`, col: j.col });
  }

  // ---- trees (round puffs), bushes, rocks, flowers, away from paths
  const onPath = (x, z) => { const r = Math.hypot(x, z); if (r < MOAT_OUT + 1.8) return true; const a = Math.atan2(z, x);
    return JOBS.some(j => { const da = Math.abs(((a - j.ang + Math.PI * 3) % (Math.PI * 2)) - Math.PI); return (da * r < 3.8 && r < BLD_D + 7) || Math.hypot(x - Math.cos(j.ang) * BLD_D, z - Math.sin(j.ang) * BLD_D) < 9; }); };
  const blockers = [];
  let sd = 11; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  const leafs = ['#4f8a5e', '#5f9a68', '#6aa673', '#e7a3b5'];
  for (let n = 0; n < 90; n++) { const a = rnd() * 6.283, r = 12.5 + rnd() * (LAND_R - 16), x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (onPath(x, z)) continue; const t = rnd();
    if (t < 0.45) { const h = 1.6 + rnd() * 1.4, tr = new THREE.Group(); tr.position.set(x, 0, z); S.add(tr); blockers.push([x, z, 0.75]);
      put(tr, new THREE.CylinderGeometry(0.13, 0.22, h, 12), mat('#7a5a44'), 0, h / 2, 0);
      const lc = leafs[rnd() < 0.15 ? 3 : Math.floor(rnd() * 3)];
      for (const [dx, dy, dz, s] of [[0, 0.5, 0, 1.0], [0.55, 0.15, 0.2, 0.72], [-0.45, 0.2, -0.3, 0.68], [0.05, 1.05, -0.05, 0.62]])
        put(tr, blob((0.9 + rnd() * 0.3) * s, 3, 0.08, n + dx), mat(lc, { roughness: 0.9 }), dx, h + dy, dz);
    } else if (t < 0.7) put(S, blob(0.5 + rnd() * 0.4, 3, 0.1, n), mat('#5c946a', { roughness: 0.95 }), x, 0.25, z);
    else if (t < 0.85) { const rr = 0.35 + rnd() * 0.5; put(S, blob(rr, 3, 0.2, n), mat('#9a94ad', { roughness: 0.9 }), x, 0.15, z); blockers.push([x, z, rr + 0.35]); }
    else for (let f = 0; f < 5; f++) put(S, new THREE.SphereGeometry(0.09, 12, 8), mat(['#ffd27a', '#ff9fb4', '#ffffff'][f % 3]), x + (rnd() - 0.5), 0.12, z + (rnd() - 0.5), false);
  }


  const BR_MID = (MOAT_IN + MOAT_OUT) / 2;
  const angTo = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  const walk = {
    ground(x, z) { const r = Math.hypot(x, z), a = Math.atan2(z, x);
      if (r < 2.3) return null;                                   // beacon
      const onBridge = JOBS.some(j => angTo(a, j.ang) * r < 1.2);
      if (r < PLAZA_R - 0.3) return onBridge && r > 6.7 ? 0.62 : 0.5;
      if (r < MOAT_OUT + 0.6) { if (!onBridge) return null; const tt = Math.max(-2.4, Math.min(2.4, r - BR_MID)), u = (tt + 2.4) / 4.8; return 0.45 + 2 * u * (1 - u) * 0.9; }
      if (r > LAND_R - 2) return null;
      for (const j of JOBS) if (inCircle(x, z, Math.cos(j.ang) * BLD_D, Math.sin(j.ang) * BLD_D, 6.9)) return null;
      for (const [bx, bz, br] of blockers) if (inCircle(x, z, bx, bz, br)) return null;
      const onPathTo = JOBS.some(j => angTo(a, j.ang) * r < 1.7);
      if (onPathTo && r < BLD_D - 4.4) return 0.16;
      return r > 14 ? Math.max(0, 0.35 * Math.sin(x * 0.18) * Math.sin(z * 0.21) * Math.min(1, (r - 14) / 6)) : 0;
    },
    interact(x, z) { for (const j of JOBS) { const dx = Math.cos(j.ang) * (BLD_D - 7.6), dz = Math.sin(j.ang) * (BLD_D - 7.6);
      if (inCircle(x, z, dx, dz, 2.6)) return { label: '入る', go: () => { window.__goScene(j.key); } }; } return null; },
  };
  // ---- characters
  const me = interpreter(C.amber); me.position.set(2.2, 0.5, 4.6); me.rotation.y = Math.PI * 0.94; S.add(me);
  const aya = interpreter(C.teal); aya.position.set(-1.3, 0.5, 5.4); aya.rotation.y = Math.PI * 1.12; S.add(aya);
  if (opt.title) { me.visible = aya.visible = false; return { cam: { yaw: 0.9, pitch: 0.36, dist: 82, target: new THREE.Vector3(0, -4, 0), look: new THREE.Vector3(0, 0, 0) }, tags: [], update(t) { halo.rotation.z = t * 0.5; window.__orbit && window.__orbit(t); } }; }

  return {
    cam: { yaw: 0.42, pitch: 0.36, dist: 12.5, target: new THREE.Vector3(2.2, 2.0, 4.6), look: new THREE.Vector3(-2.5, 1.6, -6) },
    player: me, other: aya, walk, lookAhead: 4, lookUp: 1.0, actLabel: null,
    tags,
    update(t) { halo.rotation.z = t * 0.5; halo.rotation.x = Math.PI / 2.4 + Math.sin(t * 0.7) * 0.1; orb.position.y = 5.8 + Math.sin(t * 1.4) * 0.12;
      water.material.emissiveIntensity = 0.55 + Math.sin(t * 0.8) * 0.12;
      for (const c of [me, aya]) c.userData.badge.position.y = 2.25 + Math.sin(t * 2 + c.position.x) * 0.05; },
  };
}

const buildings = {
  kousin(b, col) {     // comms tower: white rounded tower, teal band, dish
    put(b, new THREE.LatheGeometry([[3.9, 0], [3.7, 1.5], [3.3, 5], [3.1, 7.2], [3.6, 7.4], [3.6, 7.9], [0.01, 7.9]].map(([r, y]) => new THREE.Vector2(r, y)), 64), mat(C.cream), 0, 1, 0);
    put(b, new THREE.CylinderGeometry(3.25, 3.35, 0.5, 64), mat('#3f8f86'), 0, 5.6, 0);
    for (let k = 0; k < 8; k++) { const a = k / 8 * 6.283; const w = put(b, rbox(0.7, 1.3, 0.12, 0.08), glow('#bff6ec', 0.9), Math.cos(a) * 3.36, 3.6, Math.sin(a) * 3.36, false); w.rotation.y = -a + Math.PI / 2; }
    put(b, rbox(1.8, 2.6, 0.4, 0.3), mat('#2a3b5c'), 0, 2.3, 3.6);
    put(b, new THREE.CylinderGeometry(0.18, 0.25, 2.6, 16), mat('#8a8fa8'), 0, 10, 0);
    const dish = put(b, new THREE.SphereGeometry(3, 48, 24, 0, Math.PI * 2, 0, Math.PI / 3.3), mat('#f2eee4', { side: THREE.DoubleSide }), 0, 11.6, 0); dish.rotation.x = -0.85;
    put(b, new THREE.SphereGeometry(0.32, 24, 16), glow(col, 2), 0, 12.9, 1.6, false);
  },
  bunki(b, col) {      // maze gate: tiered rounded hall with three glowing arches
    put(b, rbox(9.6, 5, 6.4, 0.5), mat('#c4bfd6'), 0, 3.5, 0);
    put(b, rbox(7.4, 2.4, 5, 0.45), mat('#ada8c4'), 0, 7.2, 0);
    put(b, rbox(4, 1.6, 3.4, 0.4), mat('#9893b3'), 0, 9.2, 0);
    for (const x of [-2.9, 0, 2.9]) {
      const s = new THREE.Shape(); s.moveTo(-0.8, 0); s.lineTo(-0.8, 2); s.absarc(0, 2, 0.8, Math.PI, 0, true); s.lineTo(0.8, 0);
      put(b, new THREE.ExtrudeGeometry(s, { depth: 0.2, bevelEnabled: false, curveSegments: 24 }), mat('#262b48'), x, 1.0, 3.12);
      const ring = new THREE.Shape(); ring.absarc(0, 0, 0.98, 0, Math.PI, false); ring.absarc(0, 0, 0.84, Math.PI, 0, true);
      put(b, new THREE.ExtrudeGeometry(ring, { depth: 0.12, bevelEnabled: false, curveSegments: 24 }), glow(col, 1.4), x, 3.0, 3.25, false);
    }
    for (const s of [-1, 1]) put(b, new THREE.ConeGeometry(0.75, 2.4, 32), mat('#7f79a3'), s * 3.6, 10, 0);
    put(b, new THREE.SphereGeometry(0.3, 24, 16), glow(col, 2), 0, 10.3, 0, false);
  },
  kaigi(b, col) {      // peace hall: columns + warm dome
    put(b, new THREE.CylinderGeometry(5.1, 5.3, 0.9, 64), mat('#e6dcc6'), 0, 1.4, 0);
    for (let k = 0; k < 14; k++) { const a = k / 14 * 6.283;
      put(b, new THREE.LatheGeometry([[0.36, 0], [0.3, 0.2], [0.28, 3.4], [0.36, 3.7], [0.01, 3.7]].map(([r, y]) => new THREE.Vector2(r, y)), 24), mat(C.cream), Math.cos(a) * 4.4, 1.85, Math.sin(a) * 4.4); }
    put(b, new THREE.CylinderGeometry(4.9, 4.9, 0.6, 64), mat('#d8cbb0'), 0, 5.85, 0);
    put(b, new THREE.SphereGeometry(4.4, 64, 32, 0, Math.PI * 2, 0, Math.PI / 2), mat('#d99a52', { roughness: 0.55 }), 0, 6.15, 0);
    put(b, new THREE.CylinderGeometry(0.5, 0.75, 1.2, 32), mat('#efe6d3'), 0, 10.9, 0);
    put(b, new THREE.SphereGeometry(0.32, 24, 16), glow(col, 2), 0, 11.8, 0, false);
    put(b, new THREE.CylinderGeometry(2.6, 2.6, 3.3, 48), mat('#3b2a22'), 0, 3.5, 0);
    const lamp = new THREE.PointLight('#ffc27a', 4, 8, 2); lamp.position.set(0, 3.6, 0); b.add(lamp);
  },
};
