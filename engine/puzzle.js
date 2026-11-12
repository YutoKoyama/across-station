// ---------- puzzle: dials, readable panels, the steps of the story, the vibration code ----------
// 1 冷却：A/Bのバルブ（手がかりは相手側の部屋） → 2 通信：振動の暗号をダイヤルで入力 → 3 逆噴射：方位を向いて3秒 → 4 脱出
// The order of gimmicks comes from the pack ("steps": [...]); phase n = steps[n - 1], then the ending.
import * as THREE from '../vendor/three.module.js';
import { FLOOR, CEIL, onWall } from './world.js?v=202611121517';
import { seedRng, rand, shuffle, pick } from './rng.js?v=202611121517';

export const SYMBOLS = ['○', '△', '□', '☆'];
// vibration code: told apart by length and order only (spec 7). トン = short, ツー = long
export const RHYTHM = { '○': [120, 220, 120], '△': [120, 220, 520], '□': [520, 220, 120], '☆': [520, 220, 520] };
export const LAMP = { off: 0x3b4254, ok: 0x22c55e };
const VALVE_X_OFFSET = [-1.6, 1.6]; // 1st / 2nd valve of a room sit left / right of the wall centre

export function installPuzzle(G) {
  const { $, T, STAGE, fmt, roomById, interactive, label, setLabel, pipe, DIR_NAME } = G;
  const valves = []; // all dials: { kind:'valve'|'code', room, wall, symbols[4] (up,right,down,left), idx, wheel, plate, locked }
  G.valves = valves;
  function setLamp(v, ok) { v.lampMat.color.setHex(ok ? LAMP.ok : LAMP.off); }
  function buildValve(roomId, wall, xOff, opts = {}) {
    const LOOK = G.LOOK;
    const kind = opts.kind || 'valve';
    const R = roomById[roomId];
    const base = onWall(wall, 0.05); R.group.add(base); // dial centre at eye height (y = 0)
    const holder = new THREE.Group(); holder.position.x = xOff; base.add(holder);
    const DS = LOOK.dialStyle(kind); // a circle on a square back plate, theme colours
    const back = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 2.3), DS.back); back.position.z = -0.01; holder.add(back);
    const plate = new THREE.Mesh(new THREE.CircleGeometry(1.0, 40), DS.plate); holder.add(plate);
    const symbols = shuffle([...SYMBOLS]);
    for (let i = 0; i < 4; i++) { const a = Math.PI / 2 - i * Math.PI / 2;
      const s = label(symbols[i], 0.34, 0.34, '#2b3150', '#ffffff', 300); s.position.set(Math.cos(a) * 0.78, Math.sin(a) * 0.78, 0.02); holder.add(s); }
    const wheel = new THREE.Group(); wheel.position.z = 0.2; holder.add(wheel);
    const wheelMat = new THREE.MeshLambertMaterial({ color: DS.wheel, emissive: 0x000000 });
    wheel.add(new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.06, 8, 32), wheelMat));
    for (let i = 0; i < 2; i++) { const s = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.07, 0.07), wheelMat); s.rotation.z = i * Math.PI / 2; wheel.add(s); }
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.16, 8), DS.hub); hub.rotation.x = Math.PI / 2; wheel.add(hub);
    const pointer = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.24, 3), DS.pointer); pointer.position.set(0, 0.5, 0.06); wheel.add(pointer);
    if (kind === 'valve') pipe(holder, [0, -1.0, -0.02], [0, FLOOR, -0.02], 0.09, DS.pipe);
    if (opts.title) { const t = label(opts.title, 1.6, 0.3, '#0b0e1c', kind === 'code' ? '#5eead4' : '#ffb27a', 64); t.position.set(0, 1.25, 0.02); holder.add(t); }
    // status lamp (top right of the dial): grey = not done, green = confirmed correct. Visual backup for the vibration answer.
    const lampMat = new THREE.MeshBasicMaterial({ color: LAMP.off });
    const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.13, 12), lampMat); lamp.position.set(0.85, 0.85, 0.03); holder.add(lamp);
    const v = { kind, room: roomId, wall, symbols, idx: 0, wheel, plate, mat: wheelMat, root: base, locked: false, codeIndex: opts.codeIndex, lampMat };
    interactive.push({ mesh: plate, room: roomId, type: 'valve', valve: v, puzzleItem: true });
    valves.push(v); return v;
  }
  function setValveIdx(v, idx) { v.idx = idx; v.wheel.rotation.z = -idx * Math.PI / 2; }

  // ---------- readable panels: clue panels, the code table, the comm screen ----------
  // Aiming at a panel also shows its text at the bottom of the reticle (easier to read on the ceiling: proposal P3).
  function buildPanel(roomId, place, w = 2.2, h = 1.3, x = -2.6, y = 0.9) {
    const R = roomById[roomId];
    const mesh = label('…', w, h, '#04140c', '#5dff9d', 64);
    if (place === 'ceil') { mesh.rotation.x = Math.PI / 2; mesh.position.set(0, CEIL - 0.02, 1.0); R.group.add(mesh); mesh.userData.root = mesh; } // between the light strips
    else { const g = onWall(place, 0.04); g.position.y = y; mesh.position.x = x; g.add(mesh); R.group.add(g); mesh.userData.root = g; }
    mesh.userData.size = [w, h];
    return mesh;
  }
  function setPanel(mesh, text, kind = 'read', fg = '#5dff9d', bg = '#04140c') {
    const [w, h] = mesh.userData.size; setLabel(mesh, text, w, h, bg, fg, 64);
    let item = interactive.find(i => i.mesh === mesh);
    if (!item) { item = { mesh, room: Object.values(roomById).find(R => R.group === mesh.userData.root.parent).id, type: kind, puzzleItem: true }; interactive.push(item); }
    item.text = text.replace(/\n/g, ' ');
    return item;
  }

  // ---------- story / steps ----------
  const STEPS = STAGE.steps || ['crossValves', 'vibrationCode', 'thrust'];
  const stepAt = n => STEPS[n - 1] || 'end';
  const stepNow = () => (G.puzzle ? stepAt(G.puzzle.phase) : STEPS[0]);
  const isStep = name => stepNow() === name;
  const reached = name => STEPS.includes(name) && G.puzzle.phase >= STEPS.indexOf(name) + 1;
  function completeStep(name) { if (isStep(name)) setPhase(G.puzzle.phase + 1); }

  G.players = Object.fromEntries(Object.entries(STAGE.roles).map(([k, r]) => [k, { start: r.start, room: r.start, face: 0, result: null }]));
  G.cur = 'A'; G.puzzle = null; G.codePlaying = false;
  const players = G.players;
  const valveOwner = v => Object.values(players).find(p => p.target === v) || null;
  function freeWalls(roomId) { const R = roomById[roomId]; return [0, 1, 2, 3].filter(k => !(k in R.doors)); }
  function newPuzzle(seed = Math.floor(Math.random() * 2 ** 31)) {
    seedRng(seed);
    $('notice').style.display = 'none';
    G.hq.length = 0; G.codePlaying = false; if (G.SOUND()) G.LOOK.duck(false); // stop vibrations left over from the last round
    // remove everything from the previous round
    for (const v of valves) v.root.removeFromParent();
    valves.length = 0;
    for (let i = interactive.length - 1; i >= 0; i--) if (interactive[i].puzzleItem) {
      const it = interactive[i]; if (it.type !== 'valve') it.mesh.userData.root.removeFromParent(); interactive.splice(i, 1); }
    const puzzle = G.puzzle = { seed, phase: 1, things: {}, code: [pick(SYMBOLS), pick(SYMBOLS)], thrustWall: rand(4), codePlayed: 0 };
    // phase 1: cooling valves (2 per start room, 1 is a decoy)
    for (const k of ['A', 'B']) {
      const p = players[k]; p.room = p.start; p.face = rand(4); p.result = null; p.thrust = false; p.thrustT = 0;
      const walls = shuffle(freeWalls(p.start)).slice(0, 2);
      const vs = walls.map((w, i) => buildValve(p.start, w, VALVE_X_OFFSET[i], { title: T.valveTitle }));
      vs.forEach(v => setValveIdx(v, rand(4)));
      p.target = vs[rand(2)]; p.targetSymbol = pick(SYMBOLS);
      if (p.target.symbols[p.target.idx] === p.targetSymbol) setValveIdx(p.target, (p.target.idx + 1) % 4);
      puzzle.things['valve' + k] = p.target; puzzle.things['decoy' + k] = vs.find(v => v !== p.target);
    }
    // 案2: each crew member's clue is in a room where they are NOT (rooms come from the stage data)
    const PL = STAGE.placement;
    const freeOf = room => freeWalls(room).filter(w => !valves.some(v => v.room === room && v.wall === w));
    const clueOf = k => buildPanel(PL.clueRoom[k], PL.clueOnCeiling[k] ? 'ceil' : pick(['ceil', ...freeOf(PL.clueRoom[k])]));
    const clueA = clueOf('A'), clueB = clueOf('B');
    setPanel(clueA, fmt(T.clue, { role: 'A', dir: DIR_NAME[players.A.target.wall], sym: players.A.targetSymbol }));
    setPanel(clueB, fmt(T.clue, { role: 'B', dir: DIR_NAME[players.B.target.wall], sym: players.B.targetSymbol }));
    // phase 2: code table in one room, comm panel + 2 comm dials in another
    const table = buildPanel(PL.codeTableRoom, freeOf(PL.codeTableRoom)[0], 2.4, 1.6, 0, 0.9);
    setPanel(table, T.codeTable, 'read', '#fde68a', '#1c1405');
    const comm = buildPanel(PL.commRoom, PL.commWall, 2.8, 1.5, 0, 0.6);
    const dials = [0, 1].map(i => buildValve(PL.commRoom, PL.dialWall, VALVE_X_OFFSET[i], { kind: 'code', codeIndex: i, title: fmt(T.dialTitle, { n: i + 1 }) }));
    dials.forEach(d => { setValveIdx(d, rand(4)); d.locked = true; });
    Object.assign(puzzle.things, { clueA, clueB, table, comm, dial1: dials[0], dial2: dials[1] });
    // (for the automated tests' logs only)
    puzzle.clueText = { A: `${DIR_NAME[players.A.target.wall]}の壁のバルブを「${players.A.targetSymbol}」`, B: `${DIR_NAME[players.B.target.wall]}の壁のバルブを「${players.B.targetSymbol}」` };
    puzzle.clueOf = { A: clueA, B: clueB };
    setPhase(1);
    G.resetAim();
    G.showPlayer('A', false);
  }
  function setPhase(n) {
    const puzzle = G.puzzle;
    if (n !== 1 && n <= puzzle.phase) return;
    puzzle.phase = n;
    const step = stepAt(n), comm = puzzle.things.comm;
    const item = setPanel(comm,
      !reached('vibrationCode') ? T.commOff : step === 'vibrationCode' ? T.commReady : fmt(T.commThrust, { dir: DIR_NAME[puzzle.thrustWall] }), 'comm', !reached('vibrationCode') ? '#64748b' : '#5dff9d');
    item.type = 'comm';
    for (const v of valves) v.locked = v.kind === 'valve' ? step !== 'crossValves' : step !== 'vibrationCode';
    $('goal').textContent = T.goals[step] || '';
    if (n > 1) G.cue(step === 'end' ? 'end' : 'step:' + step);
    G.updateStatus();
  }
  function playCode() { // the 2-symbol code, one rhythm per symbol with a clear pause in between
    const puzzle = G.puzzle, hq = G.hq;
    if (G.codePlaying) return false; // the code is still vibrating: do not stack a second copy (it would blur the rhythm)
    G.codePlaying = true; puzzle.codePlayed++; G.netSend({ t: 'code', n: puzzle.codePlayed }); G.sfx('comm', { vol: 0.12, dur: 1.4 });
    const comm = puzzle.things.comm, n = puzzle.code.length;
    const showRx = k => setPanel(comm, fmt(T.commReceiving, { dots: '●'.repeat(k) + '○'.repeat(n - k) }), 'comm');
    if (G.SOUND()) G.LOOK.duck(true); // quieter room while the code vibrates
    hq.push(() => showRx(0));
    hq.push([40, 700]); // short "start" blip
    puzzle.code.forEach((s, i) => { hq.push(() => showRx(i + 1)); hq.push(RHYTHM[s]); hq.push([0, i === 0 ? 1200 : 300]); });
    hq.push(() => { G.codePlaying = false; if (G.SOUND()) G.LOOK.duck(false); if (isStep('vibrationCode')) setPanel(comm, T.commReceived, 'comm'); G.updatePartner(); }); // marker: runs when the code has finished
    G.runHaptics();
  }
  Object.assign(G, { setLamp, buildValve, setValveIdx, setPanel, stepAt, stepNow, isStep, reached, completeStep, valveOwner, newPuzzle, setPhase, playCode });
}
