// ---------- the two wings (2026-11-13): 光を追う植物 / 心拍合わせ / 写真の持ち主 / finale "海を見に" ----------
// Built into every new puzzle (after the prologue's valves, code and thrust). Rooms and words come from the pack:
//   STAGE.wings = { plants: {room, dialRoom}, heart: {room, padRoom}, photo: {room, lockerRoom}, finale: {room}, memos: [{room, wall, x, y, text}] }
// "答えは相手の側": the leaves are in the A wing, the skylight dial in the B wing; the heartbeat is felt in the B wing,
// tapped in the A wing; the photo is in the B wing, the lockers in the A wing. The finale needs both in one room.
import * as THREE from '../vendor/three.module.js';
import { FLOOR, CEIL, onWall, faceYaw } from './world.js';
import { rand, shuffle, pick } from './rng.js';
import { SYMBOLS } from './puzzle.js';

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
    const dial = G.buildValve(W.plants.dialRoom, W.plants.dialWall, -1.6, { kind: 'lock', step: 'plants', title: TX.skyDialTitle || '天窓ダイヤル' });
    dial.answer = map[plantDir]; G.setValveIdx(dial, rand(4)); if (dial.symbols[dial.idx] === dial.answer) G.setValveIdx(dial, (dial.idx + 1) % 4);
    const table = G.buildPanel(W.plants.dialRoom, W.plants.dialWall, 2.2, 1.5, 2.3, 0.2);
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
    for (let i = 0; i < 4; i++) {
      const items = cats.map((c, j) => c.opts[want[j]][1]);
      if (i !== right) { const j = (i + (i > right ? 0 : 1)) % 3; items[j] = cats[j].opts[1 - want[j]][1]; } // one feature differs
      const L = G.buildPanel(W.photo.lockerRoom, W.photo.lockerWall, 2.05, 1.6, -3.6 + i * 2.4, 0.35);
      const it = G.setPanel(L, fmt(TX.locker || 'ロッカー {n}\n{name}\n{items}', { n: i + 1, name: names[i] === 'クスノキ' ? 'クスノキ（博士）' : names[i], items: items.join('・') }), 'choice', '#e2e8f0', '#0f172a');
      it.type = 'choice'; it.right = i === right; it.mesh.userData.lockerIndex = i; puzzle.lockers.push(it);
    }
    // 博士の音声メモ (story, readable panels)
    for (const m of W.memos || []) { const p = G.buildPanel(m.room, m.wall, m.w || 2.3, m.h || 1.3, m.x ?? 0, m.y ?? 0.6); G.setPanel(p, m.text, 'read', '#c7f9e8', '#04140f'); }
    // finale: the porthole of the finale room is the thing to look at (an invisible target over it)
    const R = roomById[W.finale.room], ww = R.winWall ?? 3, wg = onWall(ww, 0.12); wg.position.y = 2.0; R.group.add(wg); extra.push(wg);
    const target = new THREE.Mesh(new THREE.CircleGeometry(1.35, 24), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }));
    target.position.x = ww === 2 ? 2.9 : -2.5; wg.add(target); target.userData.root = wg;
    interactive.push({ mesh: target, room: R.id, type: 'gaze', puzzleItem: true, text: '' });
    puzzle.things = Object.assign(puzzle.things, { skyDial: dial, heartMon: monItem, pad: padItem });
    for (const k of ['A', 'B']) { players[k].gazeT = 0; players[k].gazing = false; }
    G.seaShown = false; G.LOOK.showSea && G.LOOK.showSea(false);
  };
  function buildPlants(roomId, dir) {
    const R = roomById[roomId], g = new THREE.Group(); R.group.add(g); extra.push(g);
    const stem = new THREE.MeshLambertMaterial({ color: 0x3f7a3a }), leaf = new THREE.MeshLambertMaterial({ color: 0x7ccf5a, emissive: 0x1b3a10 });
    const box = new THREE.MeshLambertMaterial({ color: 0x5a4632 });
    const yaw = faceYaw(dir); // lean toward wall `dir`
    for (const [x, z] of [[-1.6, 1.6], [0, 2.2], [1.6, 1.6], [-2.2, -0.6], [2.2, -0.6]]) {
      const pot = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.5, 0.7), box); pot.position.set(x, FLOOR + 0.25, z); g.add(pot);
      const p = new THREE.Group(); p.position.set(x, FLOOR + 0.5, z); p.rotation.y = yaw; g.add(p);
      const lean = new THREE.Group(); lean.rotation.x = -0.55; p.add(lean); // tip forward (toward -z of the group = toward the wall)
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.06, 1.4, 6), stem); s.position.y = 0.7; lean.add(s);
      for (let i = 0; i < 3; i++) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.22, 8, 6), leaf); l.scale.set(1.2, 0.35, 0.7); l.position.set((i - 1) * 0.12, 1.1 + i * 0.18, -0.05); lean.add(l); }
    }
  }

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
      G.setPanel(it.mesh, TX.lockerOpen || 'ロッカーが開いた\n中に博士の最後のメモ', 'read', '#86efac', '#04140c'); G.notice(TX.lastMemo || '', false); finishStep('photo'); }
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
  G.gazeWaiting = () => { const me = players[G.cur]; return stepOk('finale') && me.gazing && me.gazeT === 0; };
}
