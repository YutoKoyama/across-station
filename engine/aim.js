// ---------- aiming + dial turning (phone roll like a steering wheel) + the thrust ----------
import * as THREE from '../vendor/three.module.js';
import { faceYaw } from './world.js?v=202611130129';

export const HOLD_SEC = 1.5;
const THRUST_SEC = 3, THRUST_YAW_TOL = 25, THRUST_PITCH_TOL = 35;
const AIM_MAX_DIST = 9;
const AIM_SFX_GAP_MS = 300; // the aim click must not chatter when sweeping across many things
// dial feel: a notch is crossed only 55 deg past the current symbol (not 45) so a small wobble near the edge does not
// flick back and forth; between notches the wheel follows the phone (damped) so the hand sees it move at once
const NOTCH_DEG = 55, FOLLOW = 0.8, SETTLE_RATE = 18, BUMP_MS = 90, HINT_TURNS = 3;

export function installAim(G) {
  const { $, T, fmt, UI, camera, scene, ROOMS, roomById, interactive, players, valves, DIR_NAME } = G;
  const raycaster = new THREE.Raycaster(), center = new THREE.Vector2(0, 0);
  const vF = new THREE.Vector3(), vU = new THREE.Vector3(), vW = new THREE.Vector3(), vC = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  function cameraRollCW() { // the phone's own roll (before the view is levelled while turning, see view.js)
    const q = G.rawQ || camera.quaternion;
    vF.set(0, 0, -1).applyQuaternion(q); vU.set(0, 1, 0).applyQuaternion(q);
    vW.copy(Y).addScaledVector(vF, -vF.dot(Y)).normalize(); vC.crossVectors(vU, vW);
    return -THREE.MathUtils.radToDeg(Math.atan2(vC.dot(vF), vU.dot(vW))); // + = phone turned clockwise (as the player sees it)
  }
  G.aimed = null; G.grabbed = null;
  // ---------- dial focus (2026-11-12): tap a dial -> the view locks onto it (close-up), a phone sign turns with your real phone ----------
  // On a phone, a dial turns only while it is held this way (tests and the PC simulation keep the old aim-and-turn).
  G.focus = null; let focusRoll0 = 0, focusOkTimer = null;
  G.focusRequired = () => (G.phoneWeb || G.native) && !G.testMode;
  const canTurn = v => !G.focusRequired() || G.focus === v;
  const focusQ = new THREE.Quaternion(), fM = new THREE.Matrix4(), fP = new THREE.Vector3(), ORIGIN = new THREE.Vector3();
  function enterFocus(v) {
    if (!v || v.locked) return;
    v.plate.getWorldPosition(fP); fM.lookAt(ORIGIN, fP, Y); focusQ.setFromRotationMatrix(fM); G.focusQ = focusQ;
    G.focus = v; focusRoll0 = cameraRollCW(); turnedThisGrab = false;
    $('dialUI').style.display = 'flex'; $('hint').style.visibility = 'hidden'; G.haptic('tick'); G.sfx('ui', { vol: 0.4 });
  }
  function exitFocus() {
    if (!G.focus) return; clearTimeout(focusOkTimer);
    if (G.focus.wheel) settling.add(G.focus);
    G.focus = null; G.grabbed = null; holdT = 0; $('dialUI').style.display = 'none'; $('hint').style.visibility = '';
  }
  G.enterFocus = enterFocus; G.exitFocus = exitFocus;
  if ($('dialBack')) $('dialBack').onclick = exitFocus;
  let lastRoll = 0, raw = 0, notchAt = 0, holdT = 0, offT = 0, evaluated = false, turnedThisGrab = false, turnsDone = 0;
  const settling = new Set(); // wheels easing back onto their notch after the hand let go
  const wheelAngle = v => -v.wheel.rotation.z * 180 / Math.PI;
  const setWheel = (v, degCW) => { v.wheel.rotation.z = -degCW * Math.PI / 180; };
  function bump(v) { v.wheel.scale.setScalar(1.08); v.bumpT = performance.now(); } // a small kick on each notch
  function settleWheels(dt) {
    for (const v of settling) {
      const target = v.idx * 90, a = wheelAngle(v), d = ((target - a + 540) % 360) - 180;
      if (Math.abs(d) < 0.3) { setWheel(v, target); settling.delete(v); } else setWheel(v, a + d * Math.min(1, dt * SETTLE_RATE));
    }
    for (const v of valves) if (v.bumpT && performance.now() - v.bumpT > BUMP_MS) { v.wheel.scale.setScalar(1); v.bumpT = 0; }
  }
  // first turns: a curved arrow around the reticle shows "turn the phone like a wheel" until the player has done it a few times
  function setTurnHint(on) { const h = $('turnHint'); if (h) h.classList.toggle('show', on); }
  // per-room cache of aimable objects (rebuilt only when the puzzle changes, not every frame)
  let aimCache = {};
  function rebuildAimCache() {
    scene.updateMatrixWorld(true); // objects never move afterwards (only the wheel turns, which is not ray-tested)
    aimCache = {};
    for (const R of ROOMS) { const items = interactive.filter(i => i.room === R.id); aimCache[R.id] = { items, meshes: items.map(i => i.mesh) }; }
  }
  const EMISSIVE = { door: 0x1c1206, valve: 0x2e1505, none: 0x000000 }; // warm glow on what you aim at
  const glowMat = it => it.type === 'door' ? it.mat : it.type === 'valve' ? it.valve.mat : null;
  let shownAim = undefined, shownProg = -1, shownHint = null;
  function resetAim() { shownAim = undefined; rebuildAimCache(); } // after a new puzzle was built
  function hintFor(item) {
    if (!item) return '';
    if (item.type === 'door') return fmt(G.doorOpen(item) ? UI.hintDoor : (UI.hintDoorShut || '「{room}」への扉は、まだ開かない'), { room: roomById[item.to].name });
    if (item.type === 'valve') {
      const v = item.valve;
      if (!v.locked) return canTurn(v) ? fmt(UI.hintTurn, { sym: v.symbols[v.idx] }) : (UI.hintTapDial || 'タップでバルブを持つ');
      return v.kind === 'code' && !G.reached('vibrationCode') ? UI.hintNoPower : UI.hintLocked;
    }
    const WT = T.wings || {};
    if (item.type === 'heart') return item.text + (G.isStep('heartbeat') ? '　' + (WT.heartHint || '（1.5秒見つめる）') : '');
    if (item.type === 'pad') return item.text + (G.isStep('heartbeat') ? '　' + (WT.padHint || '（照準を合わせてリズムよくタップ）') : '');
    if (item.type === 'choice') return item.text + (G.isStep('photo') ? '　' + (WT.lockerHint || '（1.5秒見つめて開ける）') : '');
    if (item.type === 'gaze') return G.isStep('finale') ? (G.gazeWaiting && G.gazeWaiting() ? (WT.gazeWait || '相手も窓を見るのを待っています') : (WT.gazeHint || '観測窓を2人で3秒見つめる')) : '';
    return item.text || '';
  }
  function setHint(text, read) { const key = text + '|' + read; if (key === shownHint) return; shownHint = key; $('hint').textContent = text; $('hint').classList.toggle('read', !!read); }
  let lastAimSfx = 0;
  function setAimVisual(item) { // DOM/material updates only when the aimed object changes
    if (item === shownAim) return;
    if (shownAim && glowMat(shownAim)) glowMat(shownAim).emissive.setHex(shownAim.valve ? shownAim.valve.baseEmissive || EMISSIVE.none : EMISSIVE.none);
    if (item && glowMat(item)) glowMat(item).emissive.setHex(item.valve && item.valve.baseEmissive ? (item.valve.kind === 'code' ? 0x1f8a7c : 0xa8461a) : EMISSIVE[item.type]);
    if (item && !G.codePlaying && performance.now() - lastAimSfx > AIM_SFX_GAP_MS) { lastAimSfx = performance.now(); G.sfx('aim', { vol: 0.25 }); }
    $('reticle').classList.toggle('aim', !!item);
    shownAim = item;
  }
  const GAUGE_COLOR = G.THEME.palette.kohaku; // hold gauge inside the reticle
  function setHoldVisual(prog) {
    const p = Math.round(prog * 36) / 36; // ~10 degree steps are enough for the eye
    if (p === shownProg) return; shownProg = p;
    $('reticle').style.background = p > 0 ? `conic-gradient(${GAUGE_COLOR} ${p * 360}deg, transparent 0)` : 'transparent';
  }
  // judge a dial after it has been held still for HOLD_SEC (local), then apply it here and on the partner's phone
  function judgeDial(v) {
    const owner = G.valveOwner(v);
    const ok = v.kind === 'lock' ? v.symbols[v.idx] === v.answer : v.kind === 'code' ? v.symbols[v.idx] === G.puzzle.code[v.codeIndex] : !!owner && v.symbols[v.idx] === owner.targetSymbol;
    applyJudge(v, ok, true);
    if (ok && G.focus === v) { clearTimeout(focusOkTimer); focusOkTimer = setTimeout(() => { if (G.focus === v) exitFocus(); }, 1300); }
    G.netSend({ t: 'judge', i: valves.indexOf(v), idx: v.idx, ok });
  }
  function applyJudge(v, ok, local) {
    G.setLamp(v, ok); if (local) G.haptic(ok ? 'correct' : 'wrong');
    if (ok) { G.sfx('lock', { vol: 0.7 }); G.sfx('chime', { vol: 0.35, delay: 0.14 }); } else if (local) { G.sfx('thud', { vol: 0.7 }); G.sfx('buzz', { vol: 0.18, delay: 0.05 }); }
    if (v.kind === 'lock') { // wing dials: every dial of the step must be right
      v.ok = ok; if (ok) G.cue('solve');
      if (valves.filter(x => x.kind === 'lock' && x.step === v.step).every(x => x.ok)) G.completeStep(v.step);
      return;
    }
    if (v.kind === 'code') { // comm dials: must show the received code
      v.ok = ok; if (ok) G.cue('solve');
      if (G.puzzle.things.dial1.ok && G.puzzle.things.dial2.ok) G.completeStep('vibrationCode');
      return;
    }
    const owner = G.valveOwner(v); // cooling valve: judged for its owner; a decoy just gives the "wrong" signal
    if (owner) owner.result = ok;
    G.updateStatus();
    if (ok) G.cue('solve');
    if (players.A.result && players.B.result) G.completeStep('crossValves');
  }
  const cf = new THREE.Vector3();
  function updateThrust(dt) { // phase 3: face the announced direction in your own room for THRUST_SEC
    const p = players[G.cur], puzzle = G.puzzle, NET = G.NET;
    if (!G.isStep('thrust') || p.thrust || p.room !== p.start) { p.thrustT = 0; return 0; }
    cf.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const yaw = THREE.MathUtils.radToDeg(Math.atan2(-cf.x, -cf.z));
    const want = THREE.MathUtils.radToDeg(faceYaw(puzzle.thrustWall));
    const dy = Math.abs(((yaw - want + 540) % 360) - 180), pitch = THREE.MathUtils.radToDeg(Math.asin(cf.y));
    const facing = dy <= THRUST_YAW_TOL && Math.abs(pitch) <= THRUST_PITCH_TOL;
    if (NET.on && facing !== !!p.holding) { p.holding = facing; G.netSend({ t: 'thrust', who: G.cur, holding: facing }); G.updatePartner(); }
    if (!facing) { p.thrustT = 0; p.waiting = false; return 0; }
    // online: the count only runs while the partner is pushing too (2人同時)
    const other = players[G.cur === 'A' ? 'B' : 'A'];
    p.waiting = NET.on && !(other.holding || other.thrust);
    if (p.waiting) { p.thrustT = 0; return 0.001; }
    if (p.thrustT === 0) $('notice').style.display = 'none'; // starting the thrust: clear the view
    const before = Math.floor(p.thrustT); p.thrustT += dt;
    if (Math.floor(p.thrustT) > before && p.thrustT < THRUST_SEC) { G.haptic('second'); G.sfx('thrustTick', { vol: 0.55, rate: 0.8 + 0.1 * Math.floor(p.thrustT) }); }
    if (p.thrustT >= THRUST_SEC) { p.thrust = true; G.haptic('thrustOk'); G.sfx('boom', { vol: 0.8 }); G.updateStatus(); G.netSend({ t: 'thrust', who: G.cur, holding: true, done: true });
      if (players.A.thrust && players.B.thrust) G.completeStep('thrust'); else G.notice(fmt(T.thrustOkOne, { me: G.cur }), true); }
    return Math.min(1, p.thrustT / THRUST_SEC);
  }
  let shownThrust = null, thrustLoopOn = false;
  function setThrustVisual(tp) { // big countdown arc while doing the thrust (phase 3, own room)
    const p = players[G.cur];
    const show = G.isStep('thrust') && !p.thrust && p.room === p.start;
    const key = show ? Math.round(tp * 50) + (p.waiting ? 1000 : 0) : -1;
    if (key === shownThrust) return; shownThrust = key;
    $('thrustUI').style.display = show ? 'block' : 'none';
    if (!show) return;
    $('thrustArc').setAttribute('stroke-dasharray', `${Math.round(tp * 100)} 100`);
    $('thrustNum').textContent = tp > 0.01 ? String(Math.max(1, Math.ceil(THRUST_SEC - p.thrustT))) : String(THRUST_SEC);
    $('thrustLabel').textContent = p.waiting ? T.thrustWaitPartner : tp > 0 ? fmt(T.thrustOn, { dir: DIR_NAME[G.puzzle.thrustWall] }) : T.thrustAim;
  }
  function updateAim(dt) {
    camera.updateMatrixWorld();
    raycaster.setFromCamera(center, camera);
    const c = aimCache[players[G.cur].room];
    if (!c) return;
    const hits = raycaster.intersectObjects(c.meshes, false);
    let aimed = G.aimed = hits.length && hits[0].distance < AIM_MAX_DIST ? c.items[c.meshes.indexOf(hits[0].object)] : null;
    if (G.focus) { if (G.focus.room !== players[G.cur].room || G.focus.locked) exitFocus(); else aimed = G.aimed = interactive.find(i => i.valve === G.focus) || aimed; }
    const p = players[G.cur];
    const thrusting = G.isStep('thrust') && !p.thrust && p.room === p.start;
    // while a thrust is being held, a door in that direction must not light up or say "tap to go" (taps are ignored then)
    const holdingThrust = thrusting && p.thrustT > 0;
    const shown = holdingThrust && aimed && aimed.type === 'door' ? null : aimed;
    setAimVisual(shown);
    setHint(holdingThrust ? '' : shown ? hintFor(shown) : (thrusting ? T.thrustHint : ''), shown && ['read', 'comm', 'heart', 'pad', 'choice'].includes(shown.type));

    const onValve = aimed && aimed.type === 'valve' && !aimed.valve.locked && canTurn(aimed.valve);
    const onComm = aimed && ((aimed.type === 'comm' && G.reached('vibrationCode')) || (aimed.type === 'heart' && G.isStep('heartbeat')) || (aimed.type === 'choice' && G.isStep('photo')));
    if (onValve || onComm) offT = 0; else offT += dt;
    const target = onValve ? aimed.valve : onComm ? aimed : null;
    if (target && G.grabbed !== target) {
      if (G.grabbed && G.grabbed.wheel) settling.add(G.grabbed);
      G.grabbed = target; lastRoll = cameraRollCW(); raw = notchAt = (target.idx || 0) * 90; holdT = 0; evaluated = false; turnedThisGrab = false;
      if (target.wheel) settling.delete(target);
    }
    if (G.grabbed && offT > 0.3) { if (G.grabbed.wheel) settling.add(G.grabbed); G.grabbed = null; holdT = 0; }
    const grabbed = G.grabbed;
    let prog = 0;
    if (grabbed && (grabbed.type === 'comm' || grabbed.type === 'heart' || grabbed.type === 'choice')) { // hold on a panel: play the code / the heartbeat, open a locker
      if (onComm && !evaluated) { holdT += dt; prog = Math.min(1, holdT / HOLD_SEC);
        if (holdT >= HOLD_SEC) { evaluated = true; prog = 0; if (grabbed.type === 'comm') G.playCode(); else if (grabbed.type === 'heart') G.playHeart(); else G.chooseLocker(grabbed); } }
    } else if (grabbed) {
      // only turn while the reticle is actually on the dial (turning away must not move it)
      const r = cameraRollCW(); let d = r - lastRoll; d = ((d + 540) % 360) - 180; lastRoll = r; if (onValve) raw += d;
      while (raw - notchAt > NOTCH_DEG) notchAt += 90; // crossed into the next notch (with a little play, see NOTCH_DEG)
      while (raw - notchAt < -NOTCH_DEG) notchAt -= 90;
      const idx = ((Math.round(notchAt / 90) % 4) + 4) % 4;
      setWheel(grabbed, notchAt + (raw - notchAt) * FOLLOW); // the wheel follows the hand between notches
      if (idx !== grabbed.idx) {
        grabbed.idx = idx; bump(grabbed); turnedThisGrab = true; turnsDone++;
        holdT = 0; evaluated = false; G.haptic('notch'); G.sfx('dial', { vol: 0.6, vary: 0.12 });
        G.netSend({ t: 'dial', i: valves.indexOf(grabbed), idx });
        if (grabbed.kind === 'code' || grabbed.kind === 'lock') grabbed.ok = false;
        G.setLamp(grabbed, false);
        const owner = G.valveOwner(grabbed); // moving a solved valve away un-solves it
        if (owner && owner.result !== null) { owner.result = null; G.updateStatus(); }
      } else if (onValve && !evaluated) {
        holdT += dt; prog = Math.min(1, holdT / HOLD_SEC);
        if (holdT >= HOLD_SEC) { evaluated = true; prog = 0; judgeDial(grabbed); }
      }
    }
    if (G.focus) {
      const ph = $('dialPhone'); if (ph) ph.style.transform = `rotate(${(cameraRollCW() - focusRoll0).toFixed(1)}deg)`;
      const sym = $('dialSym'); if (sym) sym.textContent = G.focus.symbols[G.focus.idx];
    }
    settleWheels(dt);
    setTurnHint(!!(grabbed && grabbed.wheel && !turnedThisGrab && turnsDone < HINT_TURNS && !evaluated));
    const gp = G.updateGaze ? G.updateGaze(dt, aimed) : 0; if (gp > 0.001) prog = gp; // finale: look out of the window together
    const tp = updateThrust(dt);
    const thrOn = tp > 0.01 && !players[G.cur].thrust; // thruster roar while the thrust is held
    if (thrOn !== thrustLoopOn) { thrustLoopOn = thrOn; if (G.SOUND()) G.LOOK.loop('thrust', thrOn, 0.32); }
    setHoldVisual(prog);
    setThrustVisual(tp);
  }
  Object.assign(G, { HOLD_SEC, resetAim, applyJudge, updateAim });
}
