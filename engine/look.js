// ---------- Look (engine-side theme) ----------
// The content pack decides WHAT is in a room (rooms, story, "dressing" list). The theme decides HOW it looks:
// palette, baked-light textures, materials, lights, fake bloom (halo sprites), fog and the UI stylesheet.
// Another title in the series = another theme folder (www/themes/<id>/theme.json), same engine.
// Performance rules (art guide): light/shadow are baked into textures, one point light per room,
// no post-processing pass; "bloom" = a few additive halo sprites. Only the current room is drawn.

import { mergeGeometries } from '../vendor/addons/utils/BufferGeometryUtils.js';

export async function loadTheme(THREE, id) {
  const base = `themes/${id}/`;
  const r = await fetch(base + 'theme.json?v=202611130500');
  if (!r.ok) throw new Error('theme not found: ' + id);
  const theme = await r.json();
  const loader = new THREE.TextureLoader();
  const tex = {};
  await Promise.all(Object.entries(theme.textures || {}).map(async ([k, file]) => {
    const t = await loader.loadAsync(base + file);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; tex[k] = t;
  }));
  theme.tex = tex;
  if (tex.env) { tex.env.mapping = THREE.EquirectangularReflectionMapping; tex.env.anisotropy = 1; }
  // 3D props (CC0, Kenney Space Kit, glb) - only loaded when the theme lists them
  theme.model = {};
  if (theme.models && Object.keys(theme.models).length) {
    const { GLTFLoader } = await import('../vendor/addons/GLTFLoader.js');
    const gl = new GLTFLoader();
    await Promise.all(Object.entries(theme.models).map(async ([k, file]) => {
      try { theme.model[k] = (await gl.loadAsync(base + file)).scene; } catch (e) { console.warn('model', k, e); }
    }));
  }
  // sound set (CC0 Kenney audio + synthesis) - engine/sound.js decodes the files once audio is unlocked by a tap
  if (theme.sfx) { const S = await import('./sound.js?v=202611130500'); theme.sound = await S.createSound(base, theme.sfx, theme.ambience || {}); }
  if (theme.css && ![...document.querySelectorAll('link[rel=stylesheet]')].some(x => (x.getAttribute('href') || '').split('?')[0] === base + theme.css)) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = base + theme.css; document.head.appendChild(l); }
  return theme;
}

export function createLook(THREE, theme, E) {
  // E = engine context: { HW, FLOOR, CEIL, MIDY, RH, WALL, onWall, label, pipe }
  const { HW, FLOOR, CEIL, MIDY, RH, WALL, onWall } = E;
  const C = theme.materials, PAL = theme.palette, L = theme.light;
  const col = h => new THREE.Color(h);
  const lambert = (c, extra = {}) => new THREE.MeshLambertMaterial({ color: col(c), ...extra });
  // metal = lambert + a faint reflection of the workshop HDRI (CC0) - cheap "sheen", no PBR cost
  const REFL = theme.reflect || {};
  const metal = (c, k = 'metal', extra = {}) => lambert(c, theme.tex.env ? { envMap: theme.tex.env, combine: THREE.MixOperation, reflectivity: REFL[k] ?? 0.12, ...extra } : extra);
  const M = {
    structure: metal(C.structure), doorFrame: metal(C.doorFrame),
    pipeCold: metal(C.pipeCold, 'pipe'), pipeHot: metal(C.pipeHot, 'pipe'), pipeGray: metal(C.pipeGray, 'pipe'),
    propMetal: metal(C.propMetal || C.structure), propDark: metal(C.propDark || C.doorFrame), propAccent: metal(C.propAccent || C.lever, 'pipe'), propBlack: lambert(PAL.tekkon),
    lamp: new THREE.MeshBasicMaterial({ color: col(C.lampStrip) }),
    neonCyan: new THREE.MeshBasicMaterial({ color: col((theme.neon && theme.neon.cyan) || '#7ff3ff'), fog: false }),
    neonSoft: new THREE.MeshBasicMaterial({ color: col((theme.neon && theme.neon.soft) || '#2e7f9c') }),
    neonAmber: new THREE.MeshBasicMaterial({ color: col((theme.neon && theme.neon.amber) || '#ffab4a'), fog: false }),
    band: new THREE.MeshBasicMaterial({ color: col(C.starBand) }),
    lever: lambert(C.lever),
  };
  const MOOD = theme.moods || {};
  const moodOf = R => MOOD[R.mood] || MOOD.default || {};
  const baked = []; // { mat, base: Color } - baked-light materials, tinted by the story lights (cues)
  function bakedMat(map, tint) {
    const m = new THREE.MeshBasicMaterial({ map, color: tint.clone() }); baked.push({ mat: m, base: tint.clone() }); return m;
  }
  // bakedNormal: overall grade of the baked walls; a room mood may set its own wall grade (visual review 1, M5: the 6 wing rooms)
  const roomTint = R => new THREE.Color(1, 1, 1).lerp(col(R.color || '#ffffff').multiplyScalar(2.2), theme.roomTintStrength ?? 0.25).multiply(col(moodOf(R).wall || L.bakedNormal || '#ffffff'));
  const halos = []; // { sprite, base, pulse }
  function halo(parent, pos, size, color, opacity, pulse = 0) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: theme.tex.halo, color: col(color), transparent: true, opacity,
      blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    s.position.copy(pos); s.scale.set(size, size, 1); parent.add(s); halos.push({ s, base: opacity, pulse }); return s;
  }
  // ---- batching: static pieces that share a material are merged into ONE draw call per room ----
  function batch() {
    const parts = new Map(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sc = new THREE.Vector3(1, 1, 1);
    return {
      add(mat, geo, [x, y, z], [rx = 0, ry = 0, rz = 0] = [], s = null) {
        const gg = geo.index ? geo.toNonIndexed() : geo.clone(); gg.deleteAttribute('uv1'); if (!gg.attributes.uv) gg.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(gg.attributes.position.count * 2), 2));
        m4.compose(v.set(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), s ? sc.set(...s) : sc.set(1, 1, 1)); gg.applyMatrix4(m4);
        if (!parts.has(mat)) parts.set(mat, []); parts.get(mat).push(gg); return this;
      },
      pipe(mat, a, b, r, seg = 10) { const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), len = A.distanceTo(B);
        const gg = new THREE.CylinderGeometry(r, r, len, seg, 1).toNonIndexed(); const qq = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
        gg.applyMatrix4(new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), qq, sc.set(1, 1, 1)));
        if (!parts.has(mat)) parts.set(mat, []); parts.get(mat).push(gg); return this; },
      flush(parent) { for (const [mat, list] of parts) { const geo = mergeGeometries(list, false); if (geo) parent.add(new THREE.Mesh(geo, mat)); } parts.clear(); },
    };
  }
  let sceneRef = null;
  // window views share one texture (rotates slowly = the station is spinning)
  const windowTex = theme.tex.window; windowTex.center.set(0.5, 0.5);
  const lights = [];
  const views = []; let seaTex = null;
  // the ending: the porthole shows the sea at sunrise (drawn once on a canvas)
  function makeSea() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 512; const g = c.getContext('2d');
    const sky = g.createLinearGradient(0, 0, 0, 300); sky.addColorStop(0, '#0d1838'); sky.addColorStop(0.55, '#6b4a6a'); sky.addColorStop(1, '#ffc27a'); g.fillStyle = sky; g.fillRect(0, 0, 512, 300);
    const sun = g.createRadialGradient(256, 300, 4, 256, 300, 120); sun.addColorStop(0, 'rgba(255,248,220,1)'); sun.addColorStop(1, 'rgba(255,180,90,0)'); g.fillStyle = sun; g.fillRect(0, 160, 512, 160);
    const sea = g.createLinearGradient(0, 300, 0, 512); sea.addColorStop(0, '#2f7fb8'); sea.addColorStop(1, '#08223f'); g.fillStyle = sea; g.fillRect(0, 300, 512, 212);
    g.strokeStyle = 'rgba(255,215,150,0.75)'; g.lineWidth = 3; for (let i = 0; i < 6; i++) { const w = 160 - i * 22; g.beginPath(); g.moveTo(256 - w, 318 + i * 16); g.lineTo(256 + w, 318 + i * 16); g.stroke(); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }
  function showSea(on) { try { if (on && !seaTex) seaTex = makeSea(); } catch (e) { return; } for (const v of views) { v.material.map = on ? seaTex : windowTex; v.material.needsUpdate = true; } }
  const tintNow = new THREE.Color(1, 1, 1);

  // ---- post effects (2026-11-13, "Canva look"): light bleed (bloom) on the neon parts ----
  // Only on a real WebGL renderer (the PC simulation tests use a fake one). If the phone is too slow even at the lowest
  // resolution, main.js turns it off (setBloom(false)); the settings screen can turn it off too.
  let composer = null, bloomPass = null, bloomOn = true, rRef = null, sRef = null, cRef = null;
  async function setupBloom(B) {
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
        import('../vendor/addons/postprocessing/EffectComposer.js'), import('../vendor/addons/postprocessing/RenderPass.js'),
        import('../vendor/addons/postprocessing/UnrealBloomPass.js'), import('../vendor/addons/postprocessing/OutputPass.js')]);
      const w = rRef.domElement.width / rRef.getPixelRatio(), h = rRef.domElement.height / rRef.getPixelRatio();
      const c = new EffectComposer(rRef); c.addPass(new RenderPass(sRef, cRef));
      bloomPass = new UnrealBloomPass(new THREE.Vector2(w / 2, h / 2), B.strength ?? 0.9, B.radius ?? 0.55, B.threshold ?? 0.72);
      c.addPass(bloomPass); c.addPass(new OutputPass());
      c.setPixelRatio(rRef.getPixelRatio()); c.setSize(w, h); composer = c;
    } catch (e) { console.warn('bloom off', e); composer = null; }
  }
  function render() { if (composer && bloomOn) composer.render(); else rRef.render(sRef, cRef); }
  function resize(w, h, pr) { if (!composer) return; composer.setPixelRatio(pr); composer.setSize(w, h); if (bloomPass) bloomPass.resolution.set(w / 2, h / 2); }
  function setBloom(on) { bloomOn = !!on; }
  function renderer(renderer, scene, hemi, camera) {
    const R = theme.renderer || {};
    rRef = renderer; sRef = scene; cRef = camera;
    if (R.bloom && camera && renderer.isWebGLRenderer && !globalThis.__SIM__) setupBloom(R.bloom);
    renderer.toneMapping = R.toneMapping === 'aces' ? THREE.ACESFilmicToneMapping : THREE.NeutralToneMapping;
    renderer.toneMappingExposure = R.exposure ?? 1;
    scene.background = col(R.background || '#0a0d16');
    if (R.fog) scene.fog = new THREE.Fog(col(R.fog.color), R.fog.near, R.fog.far);
    sceneRef = scene;
    hemi.color.set(L.hemiSky); hemi.groundColor.set(L.hemiGround); hemi.intensity = L.hemiIntensity;
    const v = document.createElement('div'); v.id = 'vignette'; document.body.insertBefore(v, renderer.domElement.nextSibling);
  }

  // ---- room shell: baked walls / floor / ceiling, structure, lamp ----
  function buildShell(R, g) {
    const tint = roomTint(R);
    const wallMat = bakedMat(theme.tex.wall, tint);
    for (let k = 0; k < 4; k++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2 * HW, RH), wallMat);
      m.rotation.y = WALL[k].rotY; m.position.copy(WALL[k].pos(0)); m.position.y = MIDY; g.add(m);
    }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(2 * HW, 2 * HW), bakedMat(theme.tex.ceil, tint));
    ceil.rotation.x = Math.PI / 2; ceil.position.y = CEIL; g.add(ceil);
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(2 * HW, 2 * HW), bakedMat(theme.tex.floor, tint));
    floor.rotation.x = -Math.PI / 2; floor.position.y = FLOOR; g.add(floor);
    // corner pillars + wall ribs + light housings (structure reads as a built room, not a box) - one draw call
    const B = batch();
    for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) B.add(M.structure, new THREE.BoxGeometry(0.42, RH, 0.42), [x * (HW - 0.2), MIDY, z * (HW - 0.2)]);
    for (let k = 0; k < 4; k++) for (const x of [-4.25, 4.25]) {
      const p = WALL[k].pos(0.06), ry = WALL[k].rotY; B.add(M.structure, new THREE.BoxGeometry(0.16, RH, 0.12), [p.x + Math.cos(ry) * x, MIDY, p.z - Math.sin(ry) * x], [0, ry, 0]);
    }
    // ceiling light strips (warm) + the room lamp (colour = the room's mood)
    for (const x of [-2.5, 2.5]) { B.add(M.structure, new THREE.BoxGeometry(0.5, 0.08, 6.2), [x, CEIL - 0.05, 0]); B.add(M.lamp, new THREE.BoxGeometry(0.3, 0.02, 5.8), [x, CEIL - 0.1, 0]); }
    B.flush(g);
    const MD = moodOf(R), lampCol = col(MD.lamp || L.lampColor), lampI = MD.lampIntensity ?? L.lampIntensity;
    const lamp = new THREE.PointLight(lampCol, lampI, L.lampDistance, L.lampDecay);
    lamp.position.set(0, CEIL - 0.6, 0); g.add(lamp); lights.push({ light: lamp, base: lampCol.clone(), intensity: lampI });
    R.lamp = lamp;
    // ★ band on the front wall (gameplay: "the ★ wall is 前方")
    const band = onWall(0, 0.03); band.position.y = 2.6; g.add(band);
    band.add(new THREE.Mesh(new THREE.PlaneGeometry(2 * HW - 0.8, 0.2), M.band));
    for (const x of [-3, 0, 3]) { const s = new THREE.Mesh(E.starGeo, M.band); s.position.set(x, 0.45, 0.005); band.add(s); }
    // room plate: name + stencil code
    const plate = E.label(R.name + (R.code ? '\n' + R.code : ''), 1.7, 0.62);
    const pg = onWall(2, 0.03); pg.position.y = 2.7; plate.position.x = -2.8; pg.add(plate); g.add(pg);
    // porthole: a circle inside a square frame (the series' "window" shape)
    // the porthole sits on a door wall, left of the door (walls without a door are kept for dials and panels); no door: west wall
    const winWall = [1, 3, 0, 2].find(k => k in R.doors) ?? 3; R.winWall = winWall;
    const wg = onWall(winWall, 0.03); wg.position.y = 2.0; g.add(wg);
    const wx = (winWall in R.doors) ? -3.2 : -2.5; R.winX = wx;
    const WR = theme.neon ? 1.2 : 0.78; // porthole radius
    const frame = new THREE.Mesh(new THREE.BoxGeometry(WR * 2.55, WR * 2.55, 0.08), M.structure); frame.position.set(wx, 0, 0.0); wg.add(frame);
    const view = new THREE.Mesh(new THREE.CircleGeometry(WR, 48), new THREE.MeshBasicMaterial({ map: windowTex, fog: false })); views.push(view); view.position.set(wx, 0, 0.05); wg.add(view);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(WR + 0.03, theme.neon ? 0.035 : 0.06, 6, 48), theme.neon ? M.neonCyan : M.doorFrame); rim.position.set(wx, 0, 0.06); wg.add(rim);
    halo(wg, new THREE.Vector3(wx, 0, 0.2), 2.4, '#4f7bd6', 0.18);
    // pipes along the ceiling edges
    E.pipe(g, [-HW, CEIL - 0.3, -HW + 0.3], [HW, CEIL - 0.3, -HW + 0.3], 0.08, M.pipeCold);
    E.pipe(g, [-HW, CEIL - 0.3, HW - 0.3], [HW, CEIL - 0.3, HW - 0.3], 0.08, M.pipeHot);
    E.pipe(g, [-HW + 0.3, FLOOR + 0.2, -HW], [-HW + 0.3, FLOOR + 0.2, HW], 0.1, M.pipeGray);
    if (R.lever) {
      const lv = new THREE.Group(); lv.position.set(1.8, FLOOR, -1.8); g.add(lv);
      const base = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), M.structure); base.position.y = 0.25; lv.add(base);
      const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.0, 8), M.pipeGray); stick.position.y = 0.95; stick.rotation.z = 0.35; lv.add(stick);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), M.lever); knob.position.set(-0.17, 1.42, 0); lv.add(knob);
    }
    for (const d of R.dressing || []) if (DRESS[d]) DRESS[d](R, g);
    if (theme.neon) neonShell(R, g);
  }
  // light lines like the Canva mockup: thin glowing seams on the wall ribs, an amber line along the floor, cyan ceiling strips
  function neonShell(R, g) {
    const B = batch(), seamCol = moodOf(R).seam, seam = seamCol ? new THREE.MeshBasicMaterial({ color: col(seamCol) }) : M.neonSoft; // rib seams in the room's colour; cyan / amber role lines stay
    for (let k = 0; k < 4; k++) {
      const ry = WALL[k].rotY, p = WALL[k].pos(0.13);
      for (const x of [-4.25, 4.25]) B.add(seam, new THREE.BoxGeometry(0.035, RH - 0.9, 0.02), [p.x + Math.cos(ry) * x, MIDY + 0.1, p.z - Math.sin(ry) * x], [0, ry, 0]);
      const f = WALL[k].pos(0.25), door = k in R.doors;
      const segs = door ? [[-HW + 0.6, -1.55], [1.55, HW - 0.6]] : [[-HW + 0.6, HW - 0.6]];
      for (const [a, b] of segs) { const len = b - a, mid = (a + b) / 2; B.add(M.neonAmber, new THREE.BoxGeometry(len, 0.025, 0.05), [f.x + Math.cos(ry) * mid, FLOOR + 0.03, f.z - Math.sin(ry) * mid], [0, ry, 0]); }
    }
    for (const x of [-2.5, 2.5]) B.add(M.neonCyan, new THREE.BoxGeometry(0.06, 0.02, 5.8), [x, CEIL - 0.115, 0]);
    B.flush(g);
  }

  // ---- doors: framed bulkhead with a status lamp ----
  function buildDoor(dg, to, toName) {
    const frame = new THREE.Mesh(new THREE.BoxGeometry(2.7, 3.35, 0.16), M.doorFrame); frame.position.set(0, 1.67, 0); dg.add(frame);
    const doorMat = new THREE.MeshLambertMaterial({ map: theme.tex.door, emissive: 0x000000 });
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3.0), doorMat); panel.position.set(0, 1.5, 0.09); dg.add(panel);
    const sign = E.label('→ ' + toName, 2.2, 0.42, '#0b0e1c', '#5dff9d', 80); sign.position.set(0, 3.6, 0.09); dg.add(sign);
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.07, 12), new THREE.MeshBasicMaterial({ color: col(PAL.kohaku) })); lamp.position.set(1.15, 3.6, 0.1); dg.add(lamp);
    halo(dg, new THREE.Vector3(1.15, 3.6, 0.2), 0.7, PAL.kohaku, theme.halo.door);
    if (theme.neon) { const B = batch(); // a glowing outline around the door
      B.add(M.neonCyan, new THREE.BoxGeometry(2.36, 0.035, 0.03), [0, 3.04, 0.1]); B.add(M.neonCyan, new THREE.BoxGeometry(0.035, 3.0, 0.03), [-1.17, 1.54, 0.1]); B.add(M.neonCyan, new THREE.BoxGeometry(0.035, 3.0, 0.03), [1.17, 1.54, 0.1]); B.flush(dg); }
    return { panel, mat: doorMat };
  }

  // ---- dials: a circle on a square back plate ----
  function dialStyle(kind) {
    return { plate: lambert(C.dialPlate), wheel: col(kind === 'code' ? C.codeWheel : C.valveWheel), back: metal(C.dialBack), hub: M.pipeGray,
      pointer: new THREE.MeshBasicMaterial({ color: col(PAL.kinari) }), pipe: M.pipeHot,
      glow: theme.neon ? col(kind === 'code' ? (theme.neon.code || '#2fd6c0') : (theme.neon.valve || '#ff6a1a')) : null };
  }

  // ---- labels on 3D panels: dark enamel, thin frame, an amber corner notch ----
  const LB = theme.label;
  const mapCol = c => (LB.colorMap && LB.colorMap[String(c).toLowerCase()]) || c;
  function drawLabelFrame(g, w, h, bg) {
    g.fillStyle = mapCol(bg); g.fillRect(0, 0, w, h);
    g.strokeStyle = LB.frame; g.lineWidth = 3; g.strokeRect(6, 6, w - 12, h - 12);
    const n = Math.min(w, h) * 0.16; // chamfered corner (bottom right) in amber
    g.fillStyle = mapCol(bg); g.beginPath(); g.moveTo(w, h - n); g.lineTo(w, h); g.lineTo(w - n, h); g.closePath(); g.fill();
    g.strokeStyle = LB.notch; g.lineWidth = 4; g.beginPath(); g.moveTo(w - 6, h - n - 2); g.lineTo(w - n - 2, h - 6); g.stroke();
    g.fillStyle = LB.notch; g.fillRect(6, 6, 18, 4); g.fillRect(6, 6, 4, 18); // small corner bracket (top left)
  }
  const labelFont = px => LB.font.replace('{px}', px);

  // ---- 3D props from the theme's model set, recoloured to the palette (material names from the CC0 kit) ----
  const PROP_MAT = { metal: 'propMetal', metalDark: 'propDark', metalRed: 'propAccent', dark: 'propBlack', _defaultMat: 'propDark' };
  const propBase = {}; // model key -> recentred, recoloured template
  function prop(key, parent, x, z, rotY = 0, height = 1, mats = null) {
    const src = theme.model && theme.model[key]; if (!src) return null;
    if (!propBase[key]) {
      const MM = mats || {};
      const t = src.clone(true); const box = new THREE.Box3().setFromObject(t); const c = box.getCenter(new THREE.Vector3());
      t.position.set(-c.x, -box.min.y, -c.z); const w = new THREE.Group(); w.add(t);
      w.userData.h = box.max.y - box.min.y;
      t.traverse(o => { if (o.isMesh) o.material = MM[o.material.name] || M[PROP_MAT[o.material.name] || 'propMetal']; });
      propBase[key] = w;
    }
    const p = propBase[key].clone(true); const s = height / propBase[key].userData.h;
    p.scale.setScalar(s); p.position.set(x, FLOOR, z); p.rotation.y = rotY; parent.add(p); return p;
  }

  // ---- dressing (what the pack asks for; how it looks is decided here) ----
  let ringParts = null, chart = null, reactorHalo = null;
  const beacons = [], cores = [];
  const DRESS = {
    // curved control desk in front of the back wall (below the comm panel so it never hides it)
    arcConsole(R, g) {
      const t0 = -0.78, tl = 1.56; // around +z (the back wall); CylinderGeometry theta 0 = +z
      const grp = new THREE.Group(); g.add(grp);
      const ds = THREE.DoubleSide, y0 = FLOOR;
      const body = new THREE.Mesh(new THREE.CylinderGeometry(3.35, 3.35, 0.78, 28, 1, true, t0, tl), lambert(C.dialBack, { side: ds }));
      body.position.y = y0 + 0.39; grp.add(body);
      const scrTex = theme.tex.console.clone(); scrTex.wrapS = THREE.RepeatWrapping; scrTex.repeat.set(5, 1); scrTex.needsUpdate = true;
      const screen = new THREE.Mesh(new THREE.CylinderGeometry(3.62, 3.35, 0.26, 28, 1, true, t0, tl), new THREE.MeshBasicMaterial({ map: scrTex, side: ds, color: col('#d9d2c2') }));
      screen.position.y = y0 + 0.78 + 0.13; grp.add(screen);
      const top = new THREE.Mesh(new THREE.RingGeometry(3.62, 3.98, 28, 1, -Math.PI / 2 - tl / 2, tl), lambert(C.structure, { side: ds }));
      top.rotation.x = -Math.PI / 2; top.position.y = y0 + 1.04; grp.add(top);
      const back = new THREE.Mesh(new THREE.CylinderGeometry(3.98, 3.98, 1.04, 28, 1, true, t0, tl), lambert(C.structure, { side: ds }));
      back.position.y = y0 + 0.52; grp.add(back);
      const strip = new THREE.Mesh(new THREE.CylinderGeometry(3.36, 3.36, 0.025, 28, 1, true, t0, tl), new THREE.MeshBasicMaterial({ color: col(PAL.kohaku), side: ds }));
      strip.position.y = y0 + 0.77; grp.add(strip);
      halo(g, new THREE.Vector3(0, y0 + 0.95, 3.45), 2.6, PAL.kohaku, theme.halo.console * 0.5);
    },
    // the station AI "Mizuho" = a ring of light hanging under a ceiling star chart (front half of the room)
    aiRing(R, g) {
      const z = -2.2, y = CEIL - 0.42;
      const ringMat = new THREE.MeshBasicMaterial({ color: col('#d9a868') });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.25, 0.032, 8, 64), ringMat); ring.rotation.x = Math.PI / 2; ring.position.set(0, y, z); g.add(ring);
      const inner = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.015, 6, 64), new THREE.MeshBasicMaterial({ color: col(PAL.kohaku) })); inner.rotation.x = Math.PI / 2; inner.position.set(0, y - 0.02, z); g.add(inner);
      for (let i = 0; i < 3; i++) { const a = i * Math.PI * 2 / 3; E.pipe(g, [Math.cos(a) * 1.25, y, z + Math.sin(a) * 1.25], [Math.cos(a) * 1.25, CEIL, z + Math.sin(a) * 1.25], 0.012, M.pipeGray); }
      const h1 = halo(g, new THREE.Vector3(0, y, z), 3.4, '#ffb45a', theme.halo.ring * 0.22, 0.35);
      ringParts = { mat: ringMat, base: col('#d9a868'), h1, hBase: h1.material.opacity };
      R.lamp.position.set(0, y - 0.2, z * 0.5);
    },
    starChart(R, g) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(1.2, 48), new THREE.MeshBasicMaterial({ map: theme.tex.starchart, transparent: true, depthWrite: false, opacity: 0.9 }));
      m.rotation.x = Math.PI / 2; m.position.set(0, CEIL - 0.03, -2.2); g.add(m); chart = m;
    },
    // two crew chairs at the console, turned toward it (someone sat here)
    crewChairs(R, g) { for (const a of [-0.36, 0.42]) prop('chair', g, Math.sin(a) * 2.7, Math.cos(a) * 2.7, a + (a > 0 ? 0.25 : -0.15), 1.05); },
    cargoBarrels(R, g) { prop('barrels', g, -3.55, -3.55, 0.5, 1.0); },
    generator(R, g) { prop('generator', g, -3.45, 3.45, Math.PI * 0.75, 1.25); },
    // ---------- 格納庫 (hangar): a small craft on its landing pad, a tool board, an overhead crane, hazard stripes ----------
    smallCraft(R, g) {
      const cx = -2.9, cz = 2.9;
      const pad = new THREE.Mesh(new THREE.CircleGeometry(1.9, 40), new THREE.MeshBasicMaterial({ map: theme.tex.pad, transparent: true, depthWrite: false }));
      pad.rotation.x = -Math.PI / 2; pad.position.set(cx, FLOOR + 0.015, cz); g.add(pad);
      // the craft gets its own livery: light enamel hull with amber trim (reads as a vehicle, not a crate)
      prop('craft', g, cx, cz, Math.PI * 0.25 + Math.PI, 1.25, { metal: metal('#9a9fa8'), metalDark: metal('#3a4152'), metalRed: metal('#c0832e', 'pipe'), dark: lambert(PAL.tekkon) });
      halo(g, new THREE.Vector3(cx + 0.7, FLOOR + 1.0, cz - 0.7), 1.2, '#ffcf8a', 0.35);
      const B = batch(); // refuelling hose from the wall to the craft + chocks
      B.pipe(M.pipeGray, [-HW + 0.2, FLOOR + 0.9, 4.0], [-HW + 0.9, FLOOR + 0.12, 3.6], 0.06).pipe(M.pipeGray, [-HW + 0.9, FLOOR + 0.12, 3.6], [cx - 0.6, FLOOR + 0.12, cz + 0.2], 0.06);
      for (const [x, z] of [[cx + 1.1, cz - 1.1], [cx - 1.2, cz + 1.0]]) B.add(M.propAccent, new THREE.BoxGeometry(0.35, 0.12, 0.22), [x, FLOOR + 0.06, z], [0, Math.PI / 4, 0]);
      B.flush(g);
      halo(g, new THREE.Vector3(cx, FLOOR + 0.2, cz), 3.4, '#7fa7ff', 0.12);
    },
    toolRack(R, g) {
      const x0 = 3.55, z0 = -HW + 0.28; // free-standing near the front-right corner, facing into the room
      const B = batch();
      for (const dx of [-0.82, 0.82]) B.add(M.structure, new THREE.BoxGeometry(0.08, 2.1, 0.4), [x0 + dx, FLOOR + 1.05, z0]);
      for (const y of [0.15, 0.85]) B.add(M.propDark, new THREE.BoxGeometry(1.64, 0.05, 0.42), [x0, FLOOR + y, z0 + 0.02]);
      B.add(M.propAccent, new THREE.BoxGeometry(0.5, 0.32, 0.34), [x0 - 0.45, FLOOR + 0.34, z0 + 0.02]); // tool chest
      B.add(M.propMetal, new THREE.BoxGeometry(0.42, 0.22, 0.3), [x0 + 0.4, FLOOR + 0.98, z0 + 0.02]); // crate on the shelf
      B.flush(g);
      const board = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.8), new THREE.MeshLambertMaterial({ map: theme.tex.toolboard }));
      board.position.set(x0, FLOOR + 1.62, z0 - 0.12); g.add(board);
    },
    craneRail(R, g) {
      const x = -2.9, B = batch();
      B.add(M.propDark, new THREE.BoxGeometry(0.28, 0.3, 2 * HW - 0.2), [x, CEIL - 0.35, 0]);
      B.add(M.structure, new THREE.BoxGeometry(0.6, 0.35, 0.5), [x, CEIL - 0.68, 1.6]);
      B.pipe(M.pipeGray, [x, CEIL - 0.85, 1.6], [x, 1.5, 1.6], 0.02, 6);
      B.add(M.propAccent, new THREE.TorusGeometry(0.14, 0.035, 6, 12, Math.PI * 1.4), [x, 1.36, 1.6], [0, 0, Math.PI * 0.8]);
      B.flush(g);
    },
    hazardBands(R, g) { // yellow / black floor-level bands on the walls without a door (hangar colour: blue + hazard)
      const mat = new THREE.MeshBasicMaterial({ map: theme.tex.hazard, color: roomTint(R) }); baked.push({ mat, base: mat.color.clone() });
      const B = batch(); for (const k of [0, 2, 3]) { if (k in R.doors) continue; const p = WALL[k].pos(0.04); B.add(mat, new THREE.PlaneGeometry(2 * HW - 1.0, 0.12), [p.x, FLOOR + 0.42, p.z], [0, WALL[k].rotY, 0]); }
      B.flush(g); mat.map.wrapS = THREE.RepeatWrapping;
    },
    warnBeacon(R, g) { // amber rotating beacon above the door (light only - no real light source)
      const k = +Object.keys(R.doors)[0]; const p = WALL[k].pos(0.25), ry = WALL[k].rotY;
      const bx = p.x + Math.cos(ry) * 1.75, bz = p.z - Math.sin(ry) * 1.75, by = FLOOR + 3.55;
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 0.16, 10), new THREE.MeshBasicMaterial({ color: col(PAL.kohaku) })); m.position.set(bx, by, bz); g.add(m);
      beacons.push(halo(g, new THREE.Vector3(bx, by, bz), 1.4, PAL.kohaku, 0.5));
    },
    // ---------- 発電室 (power room): reactor core window, thick pipes, coolant tank ----------
    reactorCore(R, g) {
      const x = 3.3, z = 3.3, B = batch();
      B.add(M.structure, new THREE.CylinderGeometry(1.05, 1.15, 0.9, 24, 1), [x, FLOOR + 0.45, z]); // base
      B.add(M.structure, new THREE.CylinderGeometry(1.05, 1.05, 1.5, 24, 1, true), [x, FLOOR + 3.03, z]); // upper housing
      for (const y of [FLOOR + 0.92, FLOOR + 2.28]) B.add(M.propDark, new THREE.TorusGeometry(1.0, 0.07, 6, 28), [x, y, z], [Math.PI / 2, 0, 0]); // window frames
      for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; B.add(M.propDark, new THREE.BoxGeometry(0.08, 1.36, 0.08), [x + Math.cos(a) * 0.99, FLOOR + 1.6, z + Math.sin(a) * 0.99]); } // window bars
      B.pipe(M.pipeHot, [x, FLOOR + 3.6, z], [x, CEIL, z], 0.38, 16);
      B.flush(g);
      const coreTex = theme.tex.core; coreTex.wrapS = coreTex.wrapT = THREE.RepeatWrapping; coreTex.repeat.set(2, 1);
      const win = new THREE.Mesh(new THREE.CylinderGeometry(0.97, 0.97, 1.36, 28, 1, true), new THREE.MeshBasicMaterial({ map: coreTex, color: col('#ffffff') }));
      win.position.set(x, FLOOR + 1.6, z); g.add(win); cores.push(coreTex);
      const sign = E.label('炉心 C-3\n高温注意', 0.9, 0.42, '#1c1405', '#fde68a', 60); sign.position.set(x - 0.78, FLOOR + 3.0, z - 0.78); sign.lookAt(0, FLOOR + 3.0, 0); g.add(sign);
      reactorHalo = halo(g, new THREE.Vector3(x, FLOOR + 1.6, z), 4.6, '#ff7a2a', 0.3, 1);
    },
    thickPipes(R, g) {
      const B = batch(), r = 0.24, y = CEIL - 0.45;
      B.pipe(M.pipeHot, [-HW + 0.45, y, HW - 0.45], [HW - 0.45, y, HW - 0.45], r, 14); // along the back wall
      B.pipe(M.pipeGray, [HW - 0.45, y, -HW + 0.45], [HW - 0.45, y, HW - 0.45], r, 14); // along the right wall
      B.pipe(M.pipeGray, [HW - 0.45, FLOOR, -HW + 0.45], [HW - 0.45, y, -HW + 0.45], r, 14); // riser in the front-right corner
      B.pipe(M.pipeHot, [-HW + 0.45, FLOOR, HW - 0.45], [-HW + 0.45, y, HW - 0.45], r, 14); // riser in the back-left corner
      for (const t of [-3, -1, 1, 3]) { B.add(M.propDark, new THREE.TorusGeometry(r + 0.03, 0.04, 6, 16), [t, y, HW - 0.45], [0, Math.PI / 2, 0]); B.add(M.propDark, new THREE.TorusGeometry(r + 0.03, 0.04, 6, 16), [HW - 0.45, y, t]); } // flanges
      for (const t of [-2, 2]) B.add(M.structure, new THREE.BoxGeometry(0.1, 0.45, 0.1), [t, CEIL - 0.2, HW - 0.45]); // hangers
      B.flush(g);
    },
    coolantTank(R, g) { prop('tank', g, 3.6, -3.6, 0.3, 1.4); },
    // ---------- the 6 wing rooms (visual review 1, M5): one plain landmark each, Box / Cylinder only, merged per material ----------
    suitRack(R, g) { // エアロック: two space suits hanging in the front-left corner
      const B = batch(), suit = lambert('#bdb8ae'), visor = new THREE.MeshBasicMaterial({ color: col('#1d5f78') });
      B.add(M.propDark, new THREE.BoxGeometry(0.06, 0.06, 1.6), [-4.5, FLOOR + 2.05, -3.45]);
      for (const z of [-3.9, -3.0]) {
        B.add(suit, new THREE.CylinderGeometry(0.26, 0.22, 0.95, 12), [-4.15, FLOOR + 1.05, z]);
        B.add(suit, new THREE.CylinderGeometry(0.1, 0.1, 0.55, 8), [-4.15, FLOOR + 0.3, z - 0.1]).add(suit, new THREE.CylinderGeometry(0.1, 0.1, 0.55, 8), [-4.15, FLOOR + 0.3, z + 0.1]);
        B.add(suit, new THREE.SphereGeometry(0.2, 14, 10), [-4.15, FLOOR + 1.72, z]);
        B.add(visor, new THREE.BoxGeometry(0.06, 0.12, 0.24), [-3.97, FLOOR + 1.74, z]);
        B.add(M.propMetal, new THREE.BoxGeometry(0.16, 0.42, 0.34), [-4.45, FLOOR + 1.15, z]);
      }
      B.flush(g);
    },
    commsRack(R, g) { // 通信室: two equipment racks with rows of status LEDs (back-left corner)
      const B = batch(), body = lambert('#1a2232'), led = new THREE.MeshBasicMaterial({ color: col('#3ea7c2') }), ledA = new THREE.MeshBasicMaterial({ color: col('#b9772f') });
      for (const x of [-3.9, -3.05]) {
        B.add(body, new THREE.BoxGeometry(0.8, 2.3, 0.6), [x, FLOOR + 1.15, 4.6]);
        for (let r = 0; r < 8; r++) for (let c = 0; c < 3; c++) B.add((r * 3 + c) % 5 === 2 ? ledA : led, new THREE.BoxGeometry(0.08, 0.025, 0.01), [x - 0.22 + c * 0.22, FLOOR + 0.5 + r * 0.22, 4.295]);
      }
      // a desk under the sync pad (front wall) with a radio set: seen whenever you face the pad
      B.add(M.propDark, new THREE.BoxGeometry(2.4, 0.06, 0.7), [0, FLOOR + 0.76, -4.55]);
      for (const x of [-1.1, 1.1]) B.add(M.propDark, new THREE.BoxGeometry(0.06, 0.76, 0.6), [x, FLOOR + 0.38, -4.55]);
      B.add(body, new THREE.BoxGeometry(0.7, 0.26, 0.4), [-0.6, FLOOR + 0.92, -4.6]).add(led, new THREE.BoxGeometry(0.5, 0.03, 0.01), [-0.6, FLOOR + 0.98, -4.395]).add(ledA, new THREE.BoxGeometry(0.08, 0.08, 0.01), [-0.75, FLOOR + 0.88, -4.395]);
      B.add(M.propMetal, new THREE.CylinderGeometry(0.015, 0.015, 0.3, 6), [0.7, FLOOR + 0.94, -4.7]).add(M.propMetal, new THREE.CylinderGeometry(0.2, 0.04, 0.08, 14), [0.7, FLOOR + 1.1, -4.7], [0.6, 0, 0]);
      B.flush(g);
    },
    planterBeds(R, g) { // 温室: low planter beds along the front and back walls
      const B = batch(), box = lambert('#3a2c22'), green = lambert('#3d6b34');
      for (const z of [-4.62, 4.62]) { B.add(box, new THREE.BoxGeometry(7.6, 0.3, 0.5), [0, FLOOR + 0.15, z]); B.add(green, new THREE.BoxGeometry(7.4, 0.1, 0.4), [0, FLOOR + 0.33, z]); }
      B.flush(g);
    },
    medBed(R, g) { // 医務室 (review 2 M1): a bed on legs with rails (open underneath), pillow, headboard, an IV stand; muted colours
      const B = batch(), frame = lambert('#4a5466'), rail = lambert('#8a94a4'), matt = lambert('#9fb0c0'), linen = lambert('#c8d2dc'), x = 4.3;
      for (const dx of [-0.4, 0.4]) for (const dz of [-0.95, 0.95]) B.add(frame, new THREE.BoxGeometry(0.06, 0.45, 0.06), [x + dx, FLOOR + 0.225, dz]);
      B.add(frame, new THREE.BoxGeometry(0.86, 0.06, 1.96), [x, FLOOR + 0.48, 0]);
      for (const dx of [-0.45, 0.45]) { B.add(rail, new THREE.BoxGeometry(0.04, 0.05, 1.5), [x + dx, FLOOR + 0.74, 0.1]); for (const dz of [-0.6, 0.8]) B.add(rail, new THREE.BoxGeometry(0.03, 0.2, 0.03), [x + dx, FLOOR + 0.62, dz]); }
      B.add(matt, new THREE.BoxGeometry(0.85, 0.12, 1.95), [x, FLOOR + 0.57, 0]);
      B.add(linen, new THREE.BoxGeometry(0.86, 0.02, 0.5), [x, FLOOR + 0.64, -0.3]).add(linen, new THREE.BoxGeometry(0.55, 0.1, 0.32), [x, FLOOR + 0.68, -0.75]);
      B.add(frame, new THREE.BoxGeometry(0.9, 0.55, 0.05), [x, FLOOR + 0.76, -1.0]);
      const ivx = 3.65, ivz = -1.55; // IV stand at the head end (outside the monitor's span when you face it)
      B.add(rail, new THREE.CylinderGeometry(0.015, 0.015, 1.7, 8), [ivx, FLOOR + 0.85, ivz]).add(frame, new THREE.CylinderGeometry(0.18, 0.18, 0.03, 16), [ivx, FLOOR + 0.02, ivz]);
      B.add(rail, new THREE.BoxGeometry(0.22, 0.02, 0.02), [ivx, FLOOR + 1.68, ivz]).add(lambert('#9fd4e0'), new THREE.BoxGeometry(0.12, 0.2, 0.04), [ivx + 0.08, FLOOR + 1.52, ivz]);
      B.flush(g);
    },
    cleanWall(R, g) { // 医務室: grey-white panels on the lower half of every wall (not lit up), seams every 1.2 m, a quiet cyan cross under the memo
      const B = batch(), panel = lambert('#9aa6b2'), seam = lambert('#7e8a96'), y = FLOOR + 0.8, h = 1.3;
      for (let k = 0; k < 4; k++) {
        const ry = WALL[k].rotY, at = (x, off) => { const p = WALL[k].pos(off); return [p.x + Math.cos(ry) * x, y, p.z - Math.sin(ry) * x]; };
        const segs = k in R.doors ? [[-4.15, -1.5], [1.5, 4.15]] : [[-4.15, 4.15]];
        for (const [a, b] of segs) {
          B.add(panel, new THREE.BoxGeometry(b - a, h, 0.02), at((a + b) / 2, 0.015), [0, ry, 0]);
          B.add(seam, new THREE.BoxGeometry(b - a, 0.03, 0.03), at((a + b) / 2, 0.02).map((v, i) => i === 1 ? y + h / 2 : v), [0, ry, 0]);
          for (let sx = Math.ceil(a / 1.2) * 1.2; sx < b - 0.1; sx += 1.2) if (sx > a + 0.1) B.add(seam, new THREE.BoxGeometry(0.02, h, 0.03), at(sx, 0.02), [0, ry, 0]);
        }
      }
      const cross = new THREE.MeshBasicMaterial({ color: col('#2f8fa8') }), c = WALL[2].pos(0.035), ry = WALL[2].rotY;
      B.add(cross, new THREE.BoxGeometry(0.5, 0.12, 0.01), [c.x, -0.75, c.z], [0, ry, 0]).add(cross, new THREE.BoxGeometry(0.12, 0.5, 0.01), [c.x, -0.75, c.z], [0, ry, 0]);
      B.flush(g);
    },
    bunkBed(R, g) { // 居住区: a two-tier bunk against the back wall (right of the photo, seen from inside)
      const B = batch(), wood = lambert('#5a4632');
      const x = -2.65, z = 4.5;
      B.add(wood, new THREE.BoxGeometry(2.0, 0.22, 0.9), [x, FLOOR + 0.4, z]).add(wood, new THREE.BoxGeometry(2.0, 0.22, 0.9), [x, FLOOR + 1.4, z]);
      for (const dx of [-0.97, 0.97]) for (const dz of [-0.42, 0.42]) B.add(M.propDark, new THREE.BoxGeometry(0.06, 1.9, 0.06), [x + dx, FLOOR + 0.95, z + dz]);
      B.add(lambert('#6a3428'), new THREE.BoxGeometry(1.6, 0.08, 0.85), [x, FLOOR + 0.55, z]).add(lambert('#1d4f63'), new THREE.BoxGeometry(1.6, 0.08, 0.85), [x, FLOOR + 1.55, z]);
      B.add(lambert('#3a2a3a'), new THREE.CircleGeometry(1.4, 32), [0, FLOOR + 0.012, 1.2], [-Math.PI / 2, 0, 0]); // a round rug: seen from every wall
      // a small desk under the photo (back wall centre) with a mug and two books: someone lived here
      B.add(wood, new THREE.BoxGeometry(1.6, 0.06, 0.55), [0, FLOOR + 0.75, 4.6]);
      for (const dx of [-0.74, 0.74]) B.add(M.propDark, new THREE.BoxGeometry(0.05, 0.75, 0.5), [dx, FLOOR + 0.375, 4.6]);
      B.add(lambert('#b5482e'), new THREE.CylinderGeometry(0.05, 0.05, 0.11, 12), [0.45, FLOOR + 0.835, 4.5]);
      B.add(lambert('#7fb8a8'), new THREE.BoxGeometry(0.22, 0.05, 0.3), [-0.4, FLOOR + 0.805, 4.55]).add(lambert('#c9bfa8'), new THREE.BoxGeometry(0.2, 0.05, 0.28), [-0.38, FLOOR + 0.855, 4.55], [0, 0.2, 0]);
      B.flush(g);
    },
    storageShelf(R, g) { // 倉庫: a shelf of crates on the left wall
      const B = batch(), x = -4.6, z = 1.6;
      for (const dz of [-1.05, 1.05]) for (const dx of [-0.27, 0.27]) B.add(M.propDark, new THREE.BoxGeometry(0.06, 2.4, 0.06), [x + dx, FLOOR + 1.2, z + dz]);
      for (const y of [0.3, 1.1, 1.9]) B.add(M.propDark, new THREE.BoxGeometry(0.6, 0.04, 2.2), [x, FLOOR + y, z]);
      const cr = [lambert('#6a7384'), lambert('#7a3a2a'), lambert('#8a6a3a')];
      [[0.3, -0.6, 0.5, 0], [0.3, 0.2, 0.6, 1], [1.1, -0.5, 0.45, 2], [1.1, 0.45, 0.55, 0], [1.9, 0.0, 0.5, 1]].forEach(([y, dz, s, c]) => B.add(cr[c], new THREE.BoxGeometry(0.5, s, s), [x + 0.02, FLOOR + y + 0.02 + s / 2, z + dz]));
      // a stack of crates on a pallet under the memo (front wall): kept below the memo (top <= FLOOR + 1.3)
      B.add(lambert('#5a4632'), new THREE.BoxGeometry(1.2, 0.12, 1.0), [0.9, FLOOR + 0.06, -4.2]);
      B.add(cr[2], new THREE.BoxGeometry(0.8, 0.6, 0.8), [0.75, FLOOR + 0.42, -4.2]).add(cr[0], new THREE.BoxGeometry(0.55, 0.45, 0.55), [1.2, FLOOR + 0.345, -3.7], [0, 0.3, 0]).add(cr[1], new THREE.BoxGeometry(0.5, 0.4, 0.5), [0.8, FLOOR + 0.92, -4.2], [0, -0.2, 0]);
      B.add(lambert('#c9922f'), new THREE.BoxGeometry(0.82, 0.05, 0.82), [0.75, FLOOR + 0.5, -4.2]);
      B.flush(g);
    },
    // a handwritten note on masking tape: someone was here (environmental storytelling)
    tapeNote(R, g) {
      const w = onWall(2, 0.05); w.position.y = 0.72; g.add(w);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.21), new THREE.MeshBasicMaterial({ map: theme.tex.tape, transparent: true }));
      m.position.x = 1.78; m.rotation.z = 0.04; w.add(m);
    },
  };

  function setTint(color) { // story light changes (cues) also colour the baked surfaces and the lamp
    if (color == null) tintNow.set(1, 1, 1); else tintNow.set(color);
    for (const b of baked) b.mat.color.copy(b.base).multiply(tintNow);
    for (const l of lights) l.light.color.copy(l.base).multiply(tintNow);
  }
  let t = 0;
  function update(dt, drift) {
    t += dt;
    if (drift) windowTex.rotation += dt * 0.01;
    if (ringParts) { // Mizuho breathes slowly (the only moving light in the room)
      const k = 0.5 + 0.5 * Math.sin(t * 1.1);
      ringParts.mat.color.copy(ringParts.base).multiplyScalar(0.7 + 0.3 * k).multiply(tintNow);
      ringParts.h1.material.opacity = ringParts.hBase * (0.7 + 0.6 * k);
    }
    if (chart) chart.rotation.z += dt * 0.004;
    for (const c of cores) c.offset.y -= dt * 0.06; // plasma drifts up behind the reactor window
    if (reactorHalo) reactorHalo.material.opacity = 0.3 * (0.8 + 0.2 * Math.sin(t * 2.3) + 0.1 * Math.sin(t * 7.1));
    for (const b of beacons) b.material.opacity = 0.15 + 0.55 * Math.max(0, Math.sin(t * 4)) ** 3; // rotating beacon sweep
  }
  // ---- per room: fog colour + ambience follow the room's mood ----
  const fogBase = theme.renderer && theme.renderer.fog ? col(theme.renderer.fog.color) : null;
  function enterRoom(R) {
    const MD = moodOf(R);
    if (sceneRef && sceneRef.fog && fogBase) sceneRef.fog.color.copy(MD.fog ? col(MD.fog) : fogBase);
    if (theme.sound) theme.sound.ambience(MD.ambience || null);
  }
  const SND = theme.sound || null;
  const sfx = (name, o) => { if (SND) SND.play(name, o); };
  return { halo: (parent, pos, size, color, opacity) => { const sp = halo(parent, pos, size, color, opacity); halos.pop(); return sp; }, showSea, renderer, render, resize, setBloom, hasBloom: () => !!composer, buildShell, buildDoor, dialStyle, drawLabelFrame, labelFont, mapCol, setTint, update, enterRoom, theme, sfx,
    audio: ctx => SND && SND.unlock(ctx), loop: (name, on, vol) => SND && SND.loop(name, on, vol), pause: p => SND && SND.pause(p), duck: on => SND && SND.duck(on), setVolume: v => SND && SND.setVolume(v), beep: ms => SND && SND.beep(ms), setAmbience: on => SND && SND.setAmbience(on), hasSound: !!SND };
}
