// ---------- the two wings (2026-11-13): 光を追う植物 / 心拍合わせ / 写真の持ち主 / finale "海を見に" ----------
// Built into every new puzzle (after the prologue's valves, code and thrust). Rooms and words come from the pack:
//   STAGE.wings = { plants: {room, dialRoom}, heart: {room, padRoom}, photo: {room, lockerRoom}, finale: {room}, memos: [{room, wall, x, y, text}] }
// "答えは相手の側": the leaves are in the A wing, the skylight dial in the B wing; the heartbeat is felt in the B wing,
// tapped in the A wing; the photo is in the B wing, the lockers in the A wing. The finale needs both in one room.
import * as THREE from '../vendor/three.module.js';
import { FLOOR, CEIL, onWall, faceYaw } from './world.js?v=202611130320';
import { mergeGeometries } from '../vendor/addons/utils/BufferGeometryUtils.js';
import { rand, shuffle, pick } from './rng.js?v=202611130320';
import { SYMBOLS } from './puzzle.js?v=202611130320';

const HOLD_SEC = 1.5, GAZE_SEC = 3, PAD_TAPS = 5, PAD_TOL = 0.16, PAD_EACH_TOL = 0.3;
const BPM = [54, 72, 96];
// photo features: what the photo shows (in its own words) <-> what the locker list says
const FEATURES = [
  { cat: '首元', opts: [['首に赤い布を巻いている', '赤いマフラー'], ['首に紺の布を巻いている', '紺のマフラー']] },
  { cat: '目元', opts: [['丸いレンズを掛けている', '丸眼鏡'], ['四角いレンズを掛けている', '角ばった眼鏡']] },
  { cat: '手首', opts: [['左手首に古い時計', '古い腕時計'], ['左手首に編んだひも', '組みひものお守り']] },
  { cat: '胸元', opts: [['胸に星の形の飾り', '星のバッジ'], ['胸に月の形の飾り', '月のバッジ']] },
];
const NAMES = ['クスノキ', 'アマネ', 'ハヤセ', 'ミナト'];

export function installWings(G) {
  const { $, T, STAGE, fmt, roomById, players, interactive, DIR_NAME } = G;
  const W = STAGE.wings; if (!W) return;
  const TX = T.wings || {};
  const extra = []; // 3D objects that belong to one round (removed at the next new puzzle)
  const stepOk = name => G.puzzle && G.isStep(name);

  // ---------- building (called by newPuzzle) ----------
  G.buildExtra = puzzle => {
    for (const o of extra) o.removeFromParent(); extra.length = 0;
    // 光を追う植物: the leaves in the greenhouse lean toward one wall; the skylight dial in the other wing needs that wall's symbol
    const plantDir = puzzle.plantDir = rand(4);
    const map = shuffle([...SYMBOLS]); puzzle.skyMap = map; // wall k -> symbol
    buildPlants(W.plants.room, plantDir);
    const dial = G.buildValve(W.plants.dialRoom, W.plants.dialWall, -0.9, { kind: 'lock', step: 'plants', title: TX.skyDialTitle || '天窓ダイヤル', scale: 0.7 }); // dial + table side by side in one portrait view (|x| <= 1.75)
    dial.answer = map[plantDir]; G.setValveIdx(dial, rand(4)); if (dial.symbols[dial.idx] === dial.answer) G.setValveIdx(dial, (dial.idx + 1) % 4);
    const table = G.buildPanel(W.plants.dialRoom, W.plants.dialWall, 1.5, 1.2, 1.0, 0.1);
    G.setPanel(table, fmt(TX.skyTable || '天窓の配電表\n{d0}＝{s0}　{d1}＝{s1}\n{d2}＝{s2}　{d3}＝{s3}',
      { d0: DIR_NAME[0], d1: DIR_NAME[1], d2: DIR_NAME[2], d3: DIR_NAME[3], s0: map[0], s1: map[1], s2: map[2], s3: map[3] }), 'read', '#fde68a', '#1c1405');
    // 心拍合わせ: the monitor (felt) and the pad (tapped)
    puzzle.bpm = pick(BPM); puzzle.heartPlayed = 0; puzzle.padTaps = [];
    const mon = G.buildPanel(W.heart.room, W.heart.wall, 2.4, 1.3, 0, 0.5);
    const monItem = G.setPanel(mon, TX.heartIdle || '心拍モニター\n（まだ反応がない）', 'heart', '#7dd3fc', '#06121c'); monItem.type = 'heart';
    const pad = G.buildPanel(W.heart.padRoom, W.heart.padWall, 2.2, 1.4, 0, 0.4);
    const padItem = G.setPanel(pad, TX.padIdle || '同期パッド\n（まだ電源が入っていない）', 'pad', '#fda4af', '#1c0a10'); padItem.type = 'pad';
    // 写真の持ち主: 3 of the 4 feature kinds; the right locker matches all 3, each decoy differs in exactly one
    const cats = shuffle([...FEATURES]).slice(0, 3);
    const want = cats.map(c => rand(2));
    const photo = G.buildPanel(W.photo.room, W.photo.wall, 2.4, 1.7, W.photo.x ?? -2.2, 0.5);
    G.setPanel(photo, (TX.photoHead || '色あせた写真（裏に「しずく 最初の日」）\n写っている人：') + '\n' + cats.map((c, i) => '・' + c.opts[want[i]][0]).join('\n'), 'read', '#f5e6c8', '#1a1510');
    const names = shuffle([...NAMES]), right = rand(4);
    puzzle.lockers = [];
    // 2 x 2 lockers that fit one portrait screen facing the wall (|x| <= 1.61 < 1.77, top <= +1.21), one item per line
    const LW = W.photo.lockerWall, LX = [-0.82, 0.82], LY = [0.62, -0.62];
    for (let i = 0; i < 4; i++) {
      const items = cats.map((c, j) => c.opts[want[j]][1]);
      if (i !== right) { const j = (i + (i > right ? 0 : 1)) % 3; items[j] = cats[j].opts[1 - want[j]][1]; } // one feature differs
      const L = G.buildPanel(W.photo.lockerRoom, LW, 1.42, 0.98, LX[i % 2], LY[i >> 1] - 0.04);
      lockerFrame(L);
      const it = G.setPanel(L, fmt(TX.locker || 'ロッカー {n}\n{name}\n{items}', { n: i + 1, name: names[i], items: items.join('\n') }), 'choice', '#e2e8f0', '#0f172a');
      it.type = 'choice'; it.right = i === right; it.owner = names[i]; it.mesh.userData.lockerIndex = i; puzzle.lockers.push(it); // no "（博士）" on any door: the owner is revealed when it opens (review 2 S5)
    }
    // 博士の音声メモ (story, readable panels)
    for (const m of W.memos || []) { const p = G.buildPanel(m.room, m.wall, m.w || 2.3, m.h || 1.3, m.x ?? 0, m.y ?? 0.6); G.setPanel(p, m.text, 'read', '#c7f9e8', '#04140f'); }
    // finale: the porthole of the finale room is the thing to look at (an invisible target over it)
    const R = roomById[W.finale.room], ww = R.winWall ?? 3, wg = onWall(ww, 0.12); wg.position.y = 2.0; R.group.add(wg); extra.push(wg);
    const target = new THREE.Mesh(new THREE.CircleGeometry(1.35, 24), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    target.position.x = R.winX ?? -2.5; wg.add(target); target.userData.root = wg;
    interactive.push({ mesh: target, room: R.id, type: 'gaze', puzzleItem: true, text: '' });
    puzzle.things = Object.assign(puzzle.things, { skyDial: dial, heartMon: monItem, pad: padItem });
    for (const k of ['A', 'B']) { players[k].gazeT = 0; players[k].gazing = false; }
    G.seaShown = false; G.LOOK.showSea && G.LOOK.showSea(false);
  };
  // a locker door around a panel: steel frame, vent slits on top, an amber handle (amber = can be operated)
  const LOCKER_MAT = {};
  function lockerFrame(panel) {
    const M = LOCKER_MAT; if (!M.frame) { M.frame = new THREE.MeshLambertMaterial({ color: 0x2f3a50 }); M.slit = new THREE.MeshBasicMaterial({ color: 0x10141f }); M.handle = new THREE.MeshBasicMaterial({ color: 0xf2a23a }); }
    const [w, h] = panel.userData.size, g = panel.userData.root, x = panel.position.x, y = 0.04; // frame centre (the panel sits 0.04 m low)
    const parts = new Map(), put = (mat, geo, px, py, pz) => { geo.translate(px, py, pz); if (!parts.has(mat)) parts.set(mat, []); parts.get(mat).push(geo); };
    put(M.frame, new THREE.BoxGeometry(w + 0.16, h + 0.2, 0.04), x, y, -0.005);
    for (const dy of [0, 0.045]) put(M.slit, new THREE.BoxGeometry(0.9, 0.022, 0.01), x, y + h / 2 + 0.03 + dy - 0.02, 0.02);
    put(M.handle, new THREE.BoxGeometry(0.035, 0.3, 0.03), x + w / 2 + 0.045, y - 0.04, 0.03);
    for (const [mat, list] of parts) g.add(new THREE.Mesh(mergeGeometries(list, false), mat));
    panel.position.z = 0.025;
  }
  // 光を追う植物 (review 1 M2): 4 plants, one straight ahead of each wall (3 m out), so whichever way you face, one is in view.
  // Each one reads from every side: seen from the side, a stem bent hard toward wall `dir` with arrow-shaped leaves pointing there;
  // seen along that line, the flower's yellow face (it faces the light) or its dark back. A grow light glows low on wall `dir`.
  // All of it is merged into one mesh per material (6 draw calls).
  function buildPlants(roomId, dir) {
    const R = roomById[roomId], g = new THREE.Group(); R.group.add(g); extra.push(g);
    const mats = { pot: new THREE.MeshLambertMaterial({ color: 0x4a3a2c }), soil: new THREE.MeshLambertMaterial({ color: 0x241a12 }),
      stem: new THREE.MeshLambertMaterial({ color: 0x3d6b34 }), leaf: new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, emissive: 0x0e240a, side: THREE.DoubleSide }),
      face: new THREE.MeshBasicMaterial({ color: 0xd8b850 }), center: new THREE.MeshLambertMaterial({ color: 0xb8862a }), back: new THREE.MeshLambertMaterial({ color: 0x24401e }),
      light: new THREE.MeshBasicMaterial({ color: 0xa8d880 }), mount: new THREE.MeshLambertMaterial({ color: 0x2f3a50 }) };
    const parts = {}; const put = (k, geo, m4) => { const gg = geo.index ? geo.toNonIndexed() : geo; gg.applyMatrix4(m4); for (const a of Object.keys(gg.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(a)) gg.deleteAttribute(a); (parts[k] ||= []).push(gg); };
    const M4 = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    const yaw = faceYaw(dir), qYaw = new THREE.Matrix4().makeRotationY(yaw); // the plant is built leaning toward -z, then turned to wall `dir`
    const SEG = 0.3, BEND = [0.2, 0.5, 0.85, 1.15];
    const LEAF = new THREE.Shape(); LEAF.moveTo(0, 0); LEAF.quadraticCurveTo(0.11, 0.13, 0, 0.44); LEAF.quadraticCurveTo(-0.11, 0.13, 0, 0); // widest at ~30 %
    const LEAF_COLS = ['#5faf45', '#6fbf4f', '#4e9a3a'].map(h => new THREE.Color(h)); let nLeaf = 0;
    for (const [px, pz] of [[0, -3], [3, 0], [0, 3], [-3, 0]]) {
      const at = new THREE.Matrix4().makeTranslation(px, 0, pz).multiply(qYaw), local = m => at.clone().multiply(m);
      put('pot', new THREE.CylinderGeometry(0.3, 0.24, 0.42, 16), local(M4(0, FLOOR + 0.21, 0)));
      put('soil', new THREE.CylinderGeometry(0.27, 0.27, 0.02, 16), local(M4(0, FLOOR + 0.42, 0)));
      let y = FLOOR + 0.42, z = 0;
      BEND.forEach((a, i) => { // stem segment tilted by `a` toward -z
        const dy = Math.cos(a) * SEG, dz = -Math.sin(a) * SEG;
        put('stem', new THREE.CylinderGeometry(0.03 - i * 0.003, 0.035 - i * 0.003, SEG + 0.02, 8), local(M4(0, y + dy / 2, z + dz / 2, -a)));
        // two leaves on each of the two lower segments (review 2 S4: a soft leaf outline, not a spike; none near the flower),
        // standing upright so the side view shows the leaf; the tip points toward -z (the light)
        if (i < 2) for (const sx of [-1, 1]) {
          const leaf = new THREE.ShapeGeometry(LEAF, 6); leaf.rotateY(Math.PI / 2); // in the y-z plane, tip along +y
          const c = LEAF_COLS[(nLeaf++) % LEAF_COLS.length], n = leaf.attributes.position.count;
          leaf.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(n * 3).map((_, j) => [c.r, c.g, c.b][j % 3]), 3));
          put('leaf', leaf, local(new THREE.Matrix4().makeTranslation(sx * 0.04, y + dy * (0.45 + 0.25 * (sx > 0)), z + dz * 0.6).multiply(new THREE.Matrix4().makeRotationY(sx * 0.35)).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2 + 0.2))));
        }
        y += dy; z += dz;
      });
      // the flower: yellow face toward the light (only drawn from the front), dark green back
      const fa = 1.35; // face normal tilted a little up from -z
      put('back', new THREE.CylinderGeometry(0.17, 0.17, 0.05, 20), local(M4(0, y, z, -fa)));
      put('face', new THREE.CircleGeometry(0.15, 20), local(M4(0, y + Math.cos(fa) * 0.03, z - Math.sin(fa) * 0.03, Math.PI / 2 - fa, Math.PI, 0)));
      put('center', new THREE.SphereGeometry(0.035, 10, 8), local(M4(0, y + Math.cos(fa) * 0.05, z - Math.sin(fa) * 0.05)));
    }
    // the grow light on wall `dir`, low (below the memos, above the floor neon); two short bars beside a door. Muted (review 2 S4).
    const Rw = R.doors && dir in R.doors ? [[-2.9, 1.2], [2.9, 1.2]] : [[0, 1.6]];
    const wall = onWall(dir, 0.06); wall.updateMatrix();
    for (const [x, len] of Rw) {
      put('light', new THREE.BoxGeometry(len, 0.03, 0.03), wall.matrix.clone().multiply(M4(x, -0.45, 0.01)));
      for (const e of [-1, 1]) put('mount', new THREE.BoxGeometry(0.08, 0.12, 0.04), wall.matrix.clone().multiply(M4(x + e * (len / 2 + 0.02), -0.45, -0.01)));
    }
    // the skylight in the middle of the ceiling (the task is "温室の天窓を開ける"): dark while shut, the sky once it opens
    const B = new THREE.Matrix4();
    put('mount', new THREE.BoxGeometry(3.2, 0.08, 0.1), B.clone().makeTranslation(0, CEIL - 0.05, -1.55)); put('mount', new THREE.BoxGeometry(3.2, 0.08, 0.1), B.clone().makeTranslation(0, CEIL - 0.05, 1.55));
    put('mount', new THREE.BoxGeometry(0.1, 0.08, 3.2), B.clone().makeTranslation(-1.55, CEIL - 0.05, 0)); put('mount', new THREE.BoxGeometry(0.1, 0.08, 3.2), B.clone().makeTranslation(1.55, CEIL - 0.05, 0));
    put('mount', new THREE.BoxGeometry(3.0, 0.06, 0.06), B.clone().makeTranslation(0, CEIL - 0.06, 0)); put('mount', new THREE.BoxGeometry(0.06, 0.06, 3.0), B.clone().makeTranslation(0, CEIL - 0.06, 0));
    for (const [k, list] of Object.entries(parts)) g.add(new THREE.Mesh(mergeGeometries(list, false), mats[k]));
    if (G.LOOK.halo) for (const [x] of Rw) { const v = new THREE.Vector3(x, -0.45, 0.2).applyMatrix4(wall.matrix); G.LOOK.halo(g, v, 1.2, '#a8d880', 0.12); }
    const sky = new THREE.Mesh(new THREE.PlaneGeometry(3.0, 3.0), SKY.shut); sky.rotation.x = Math.PI / 2; sky.position.y = CEIL - 0.02; g.add(sky); skylight = sky;
  }
  // the skylight opens when the plants step is done (and shuts again for a new round)
  const SKY = { shut: new THREE.MeshBasicMaterial({ color: 0x10141f }), open: new THREE.MeshBasicMaterial({ map: (G.LOOK.theme && G.LOOK.theme.tex && G.LOOK.theme.tex.window) || null, fog: false }) };
  let skylight = null;
  G.onPhase = () => { if (skylight && G.puzzle) skylight.material = G.reached('plants') && !G.isStep('plants') ? SKY.open : SKY.shut; };

  // ---------- 心拍: play the heartbeat (vibration / flash) ----------
  G.playHeart = () => {
    const pz = G.puzzle; if (!stepOk('heartbeat') || G.codePlaying) return;
    G.codePlaying = true; pz.heartPlayed++;
    const it = pz.things.heartMon, iv = Math.round(60000 / pz.bpm);
    G.setPanel(it.mesh, TX.heartPlaying || '心拍モニター\n♥ 受信中…　リズムを覚えて相手へ', 'heart', '#7dd3fc', '#06121c').type = 'heart';
    for (let i = 0; i < 8; i++) { G.hq.push([60, 110, 90]); G.hq.push([0, Math.max(80, iv - 380)]); }
    G.hq.push(() => { G.codePlaying = false; G.setPanel(it.mesh, TX.heartDone || '心拍モニター\n受信完了（もう一度：1.5秒見つめる）', 'heart', '#7dd3fc', '#06121c').type = 'heart'; });
    G.runHaptics(); G.netSend({ t: 'heart' });
  };
  // ---------- 同期パッド: tap in rhythm ----------
  G.padTap = () => {
    const pz = G.puzzle; if (!stepOk('heartbeat')) return;
    const now = performance.now(), taps = pz.padTaps; if (taps.length && now - taps[taps.length - 1] > 2500) taps.length = 0;
    taps.push(now); G.haptic('tick'); G.sfx('ui', { vol: 0.5 });
    const target = 60000 / pz.bpm, iv = taps.slice(1).map((t, i) => t - taps[i]).slice(-(PAD_TAPS - 1));
    const n = Math.min(taps.length, PAD_TAPS);
    let ok = iv.length >= PAD_TAPS - 1;
    if (ok) { const mean = iv.reduce((a, b) => a + b, 0) / iv.length; ok = Math.abs(mean - target) / target < PAD_TOL && iv.every(x => Math.abs(x - target) / target < PAD_EACH_TOL); }
    const it = pz.things.pad;
    if (ok) { taps.length = 0; G.setPanel(it.mesh, TX.padDone || '同期パッド\n同期完了', 'pad', '#86efac', '#04140c').type = 'pad'; G.sfx('chime', { vol: 0.4 }); G.haptic('correct'); finishStep('heartbeat'); return; }
    const miss = iv.length >= PAD_TAPS - 1;
    if (miss) taps.splice(0, taps.length - 1);
    G.setPanel(it.mesh, fmt(miss ? (TX.padMiss || '同期パッド\nずれている…（{n}/{m}）') : (TX.padCount || '同期パッド\n{n}/{m}'), { n: miss ? 1 : n, m: PAD_TAPS }), 'pad', '#fda4af', '#1c0a10').type = 'pad';
  };
  // ---------- ロッカー: choose by holding the aim ----------
  G.chooseLocker = it => {
    if (!stepOk('photo')) return;
    if (it.right) { G.sfx('lock', { vol: 0.7 }); G.sfx('chime', { vol: 0.35, delay: 0.14 }); G.haptic('correct');
      G.setPanel(it.mesh, fmt(TX.lockerOpen || 'ロッカーが開いた\n中に博士の最後のメモ', { name: it.owner || '' }), 'read', '#86efac', '#04140c'); G.notice(TX.lastMemo || '', false); finishStep('photo'); }
    else { G.sfx('thud', { vol: 0.7 }); G.sfx('buzz', { vol: 0.18, delay: 0.05 }); G.haptic('wrong'); G.notice(TX.lockerWrong || 'ロッカーは開かない。持ち物が写真と少し違うようだ', true); }
  };
  function finishStep(name) { if (!G.isStep(name)) return; G.netSend({ t: 'done', step: name }); G.completeStep(name); }
  G.finishStep = finishStep;

  // ---------- finale: both look out of the porthole together for GAZE_SEC ----------
  G.updateGaze = (dt, aimed) => {
    const me = players[G.cur], o = players[G.cur === 'A' ? 'B' : 'A'];
    if (!stepOk('finale')) { me.gazeT = 0; return 0; }
    const looking = !!aimed && aimed.type === 'gaze' && me.room === W.finale.room;
    if (G.NET.on && looking !== !!me.gazing) { me.gazing = looking; G.netSend({ t: 'gaze', who: G.cur, on: looking }); }
    me.gazing = looking;
    const partnerOk = G.NET.on ? (o.gazing && o.room === W.finale.room) : o.room === W.finale.room; // one phone: the other crew member only has to be there
    if (!looking) { me.gazeT = 0; return 0; }
    if (!partnerOk) { me.gazeT = 0; return 0.001; }
    me.gazeT += dt;
    if (me.gazeT >= GAZE_SEC) { me.gazeT = 0; finishStep('finale'); return 0; }
    return Math.min(1, me.gazeT / GAZE_SEC);
  };
  // paused / app in the background: stop looking (otherwise the partner could finish alone; review 1 S7)
  G.stopGaze = () => { const me = players[G.cur]; if (!me) return; me.gazeT = 0; if (me.gazing) { me.gazing = false; if (G.NET && G.NET.on) G.netSend({ t: 'gaze', who: G.cur, on: false }); } };
  G.gazeWaiting = () => { const me = players[G.cur]; return stepOk('finale') && me.gazing && me.gazeT === 0; };
}
