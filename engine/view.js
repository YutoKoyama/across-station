// ---------- view: phone orientation -> camera, touch look, tapping doors, moving between rooms ----------
import * as THREE from '../vendor/three.module.js';
import { faceYaw } from './world.js?v=202611130320';
import { sleep } from './feedback.js?v=202611130320';

export function installView(G) {
  const { $, camera, renderer, ROOMS, roomById, players } = G;
  const deg = THREE.MathUtils.degToRad;
  const zee = new THREE.Vector3(0, 0, 1), euler = new THREE.Euler(), q0 = new THREE.Quaternion();
  const q1 = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
  let ori = null; G.gotSensor = false;
  addEventListener('deviceorientation', e => { if (e.alpha != null) { ori = e; G.gotSensor = true; } });
  const sensorQ = new THREE.Quaternion(), yawOffset = new THREE.Quaternion(), targetQ = new THREE.Quaternion(), smoothQ = new THREE.Quaternion();
  function readSensorQuat(out) {
    const a = deg(ori.alpha || 0), b = deg(ori.beta || 0), g = deg(ori.gamma || 0);
    const o = deg(G.screenAngle ? G.screenAngle() : ((screen.orientation && screen.orientation.angle) || 0));
    euler.set(b, a, -g, 'YXZ'); out.setFromEuler(euler); out.multiply(q1); out.multiply(q0.setFromAxisAngle(zee, -o)); return out;
  }
  G.touchMode = false; let tYaw = 0, tPitch = 0;
  // 案1: "正面に戻す" makes YOUR front = the wall assigned to you (players[cur].face), not necessarily the station front
  function recenter() {
    const f = faceYaw(players[G.cur].face);
    if (G.touchMode || !ori) { tYaw = f; tPitch = 0; if (!ori) return; }
    readSensorQuat(sensorQ);
    const e = new THREE.Euler().setFromQuaternion(sensorQ, 'YXZ');
    yawOffset.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -e.y + f);
    smoothQ.copy(yawOffset).multiply(sensorQ);
  }
  G.recenterPending = true;
  const touchEuler = new THREE.Euler();
  // test mode (automated device tests only): the view is injected instead of read from the sensor
  G.testMode = false; G.testView = { yaw: 0, pitch: 0, roll: 0 }; const testEuler = new THREE.Euler();
  function updateCamera(dt = 1 / 60) {
    if (G.testMode) { const tv = G.testView; camera.quaternion.setFromEuler(testEuler.set(deg(tv.pitch), deg(tv.yaw), -deg(tv.roll), 'YXZ')); }
    else if (G.touchMode) camera.quaternion.setFromEuler(touchEuler.set(tPitch, tYaw, 0, 'YXZ'));
    else {
      if (!ori) return;
      if (G.recenterPending) { recenter(); G.recenterPending = false; }
      readSensorQuat(sensorQ); targetQ.copy(yawOffset).multiply(sensorQ);
      if (smoothQ.angleTo(targetQ) < deg(0.6)) smoothQ.slerp(targetQ, 0.35); else smoothQ.copy(targetQ);
      camera.quaternion.copy(smoothQ);
    }
    levelWhileTurning(dt);
    camera.quaternion.multiply(TILT_BIAS); // see TILT_BIAS
  }
  // review 2 S7: looking EXACTLY at a corner (yaw 45 deg with pitch and roll exactly 0) made every textured wall and the floor
  // sample black (SwiftShader; the camera matrix is perfectly symmetric). A fixed 0.03 deg tilt keeps that exact case from ever happening.
  const TILT_BIAS = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.0005);
  // ---------- dial turning: keep the view level while a dial is held ----------
  // Turning the phone like a steering wheel also rolled the whole view, so on screen the room spun and the wheel
  // (turning with the phone) seemed to stand still. While a dial is held the camera keeps only yaw + pitch: the room
  // stays level and the wheel visibly turns with your hand. The phone's real roll (G.rawQ) still drives the dial.
  const ROLL_LOCK_RATE = 20; // how fast the view levels / un-levels (1/s): 95 % in about 0.15 s
  const rawQ = new THREE.Quaternion(), lockE = new THREE.Euler(); let rollK = 0, focusK = 0;
  const FOCUS_RATE = 9, FOCUS_FOV = 46; // ~0.3 s to settle on the dial; the dial fills most of the width
  function levelWhileTurning(dt) {
    rawQ.copy(camera.quaternion); G.rawQ = rawQ;
    const turning = !!(G.grabbed && G.grabbed.wheel); // a dial, not the comm panel
    rollK += ((turning ? 1 : 0) - rollK) * Math.min(1, dt * ROLL_LOCK_RATE);
    G.viewLevel = rollK;
    if (rollK >= 0.001) { lockE.setFromQuaternion(rawQ, 'YXZ'); lockE.z *= 1 - rollK; camera.quaternion.setFromEuler(lockE); }
    // dial focus: the view eases onto the held dial and zooms in; the phone's own turning (rawQ) still drives the dial
    focusK += ((G.focus ? 1 : 0) - focusK) * Math.min(1, dt * FOCUS_RATE);
    if (G.baseFov === undefined) G.baseFov = camera.fov;
    if (focusK > 0.001 && G.focusQ) camera.quaternion.slerp(G.focusQ, focusK);
    const fov = G.baseFov + (FOCUS_FOV - G.baseFov) * focusK;
    if (Math.abs(fov - camera.fov) > 0.05) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
  function setTouchMode(on) { G.touchMode = on; const b = $('btnTouch'); b.textContent = G.fmt(G.UI.touchLabel, { v: on ? G.UI.on : G.UI.off }); b.classList.toggle('on', on);
    if (on) { tYaw = faceYaw(players[G.cur].face); tPitch = 0; } else G.recenterPending = true; }

  // ---------- touch: drag to look (touch mode) / tap to use a door ----------
  let down = null, lastXY = null;
  addEventListener('pointerdown', e => { if (e.target !== renderer.domElement) return; down = { x: e.clientX, y: e.clientY, t: performance.now() }; lastXY = [e.clientX, e.clientY]; });
  addEventListener('pointermove', e => { if (!lastXY) return;
    if (G.touchMode) { const k = camera.fov / G.viewH() * Math.PI / 180; const [dx, dy] = G.toContentDelta(e.clientX - lastXY[0], e.clientY - lastXY[1]); tYaw += dx * k; tPitch = Math.max(-1.4, Math.min(1.4, tPitch + dy * k)); }
    lastXY = [e.clientX, e.clientY]; });
  addEventListener('pointerup', e => {
    const aimed = G.aimed;
    const thrustHeld = G.puzzle && G.isStep('thrust') && players[G.cur].thrustT > 0;
    const tap = down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 12 && performance.now() - down.t < 500;
    if (!thrustHeld && tap && !G.focus && aimed && aimed.type === 'door') { if (G.doorOpen(aimed)) goThrough(aimed.to); else { G.sfx('thud', { vol: 0.5 }); G.haptic('wrong'); } }
    else if (tap && aimed && aimed.type === 'pad' && G.padTap) G.padTap();
    else if (tap && !G.focus && aimed && aimed.type === 'valve' && !aimed.valve.locked && G.focusRequired()) G.enterFocus(aimed.valve);
    down = null; lastXY = null; });

  // ---------- moving between rooms: 0.3 s fade, view direction kept ----------
  let moving = false;
  async function fadeSwap(fn) { if (moving) return; moving = true; $('fade').style.opacity = 1; await sleep(150); fn(); await sleep(30); $('fade').style.opacity = 0; await sleep(150); moving = false; }
  function showRoom(id) { for (const R of ROOMS) R.group.visible = (R.id === id); G.partnerJump = true; G.updateMap(); if (G.updateWho) G.updateWho(); G.LOOK.enterRoom(roomById[id]); }
  function goThrough(to) { G.sfx('doorOpen', { vol: 0.5 }); G.sfx('doorClose', { vol: 0.35, delay: 0.32 }); fadeSwap(() => { players[G.cur].room = to; showRoom(to); G.grabbed = null; G.haptic('door'); G.netSend({ t: 'room', who: G.cur, room: to }); }); }
  function showPlayer(k, fade = true) {
    const f = () => { G.cur = k; showRoom(players[k].room); G.recenterPending = true; if (G.touchMode) recenter(); G.grabbed = null; G.updateStatus(); };
    fade ? fadeSwap(f) : f();
  }
  Object.assign(G, { recenter, updateCamera, setTouchMode, showRoom, goThrough, showPlayer });
}
