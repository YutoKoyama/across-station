// ---------- test hooks (used only by tools/device_test.mjs over the WebView debug connection) ----------
// Nothing here runs in normal play: every function except enable() refuses to work until enable() is called,
// and enable() can only be called from the debugger (debug builds), never from the game UI.
import * as THREE from '../vendor/three.module.js';
import { faceYaw } from './world.js?v=202611121509';

export function installTestHooks(G) {
  const { $, players, valves, interactive, renderer, hemi, DIR_NAME } = G;
  const need = () => { if (!G.testMode) throw new Error('test mode is off'); };
  // one GAME frame: resolves after the render loop has run (updated aim / dials) at least once more.
  // (Waiting for our own requestAnimationFrame could fire before the game loop on a busy device -> race, P11.)
  const frame = () => new Promise(r => {
    if (G.lastLoopReal === 0) { requestAnimationFrame(() => r()); return; }
    const f0 = G.loopCount, t0f = performance.now();
    const tick = () => (G.loopCount > f0 || performance.now() - t0f > 2000) ? r() : setTimeout(tick, 4);
    tick();
  });
  // wait `ms` of GAME time (what the hold / thrust timers count), so a slow or busy device or PC cannot make a check
  // finish early (P11). Wall-clock time is used only when the render loop has never run (the plain simulation test).
  const WAIT_GIVE_UP = 6;
  const wait = ms => new Promise(r => {
    const g0 = G.gameClock, t0w = performance.now();
    const tick = () => {
      const real = performance.now() - t0w, loopRuns = G.lastLoopReal > 0;
      if ((loopRuns ? (G.gameClock - g0) * 1000 : real) >= ms || real > ms * WAIT_GIVE_UP + 2000) return r();
      setTimeout(tick, 8);
    };
    tick();
  });
  const testView = G.testView;
  function viewTo(obj) {
    obj.updateWorldMatrix(true, false);
    const d = obj.getWorldPosition(new THREE.Vector3()).normalize();
    testView.yaw = THREE.MathUtils.radToDeg(Math.atan2(-d.x, -d.z)); testView.pitch = THREE.MathUtils.radToDeg(Math.asin(d.y)); testView.roll = 0;
  }
  const thing = name => { const t = G.puzzle.things[name]; if (!t) throw new Error('unknown thing ' + name); return t; };
  const meshOf = t => t.plate || t; // dial -> its plate, panel -> the panel mesh
  const doorOf = to => interactive.find(i => i.type === 'door' && i.room === players[G.cur].room && i.to === to);
  window.__ssTest = {
    enable() { G.testMode = true; if (G.hideGuide) G.hideGuide(); const b = document.createElement('div'); b.id = 'testBadge'; b.textContent = 'テストモード';
      b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);top:4px;background:#b45309;color:#fff;font-size:11px;padding:2px 8px;border-radius:8px;z-index:50';
      document.body.appendChild(b); return true; },
    focus(name) { need(); G.enterFocus(thing(name)); return !!G.focus; },
    unfocus() { need(); G.exitFocus(); return true; },
    disable() { G.testMode = false; const b = document.getElementById('testBadge'); if (b) b.remove(); G.recenterPending = true; return true; },
    state() {
      const puzzle = G.puzzle, NET = G.NET, aimed = G.aimed;
      return { look: G.THEME.id, sound: G.THEME.sound ? G.THEME.sound.stats() : null, settings: G.settings ? { ...G.settings } : null,
        testMode: G.testMode, cur: G.cur, phase: puzzle.phase, step: G.stepNow(), cues: G.cueLog.slice(-10), light: '#' + hemi.color.getHexString(), done: $('done').style.display === 'flex', paused: G.paused, fps: $('fps').textContent, ratio: renderer.getPixelRatio(),
        aimed: aimed ? { type: aimed.type, to: aimed.to || null } : null, hint: $('hint').textContent, goal: $('goal').textContent,
        who: $('who').textContent, partner: $('partnerText').textContent, thrustUI: $('thrustUI').style.display === 'block', thrustNum: $('thrustNum').textContent,
        clueText: puzzle.clueText, code: puzzle.code, codePlayed: puzzle.codePlayed, thrustWall: puzzle.thrustWall, thrustDir: DIR_NAME[puzzle.thrustWall],
        dials: [puzzle.things.dial1, puzzle.things.dial2].map(d => ({ now: d.symbols[d.idx], ok: !!d.ok, locked: d.locked })),
        valves: valves.map((v, i) => ({ i, kind: v.kind, room: v.room, wall: v.wall, symbols: v.symbols, idx: v.idx, ok: !!v.ok, owner: (Object.entries(players).find(([, pl]) => pl.target === v) || [null])[0] })),
        online: { on: NET.on, role: NET.role, partner: NET.partner, started: NET.started },
        players: Object.fromEntries(Object.entries(players).map(([k, p]) => [k, { room: p.room, face: p.face, result: p.result, thrust: !!p.thrust, holding: !!p.holding, waiting: !!p.waiting,
          targetWall: p.target.wall, targetSymbol: p.targetSymbol, valveSymbolNow: p.target.symbols[p.target.idx] }])) };
    },
    rect(id) { const r = $(id).getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, dpr: window.devicePixelRatio }; },
    setView(yaw, pitch = 0, roll = 0) { need(); Object.assign(testView, { yaw, pitch, roll }); return true; },
    async lookAtDoor(to) { need(); const d = doorOf(to); if (!d) return false; viewTo(d.mesh); await frame(); await frame(); return !!G.aimed && G.aimed.to === to; },
    async lookAt(name) { need(); viewTo(meshOf(thing(name))); await frame(); await frame(); return !!G.aimed && G.aimed.mesh === meshOf(thing(name)); },
    async lookAtClue(k) { need(); viewTo(G.puzzle.clueOf[k]); await frame(); await frame(); return true; },
    async lookAtValve(k, which = 'target') { return this.lookAt((which === 'target' ? 'valve' : 'decoy') + k); },
    async turnThing(name, symbol) { // roll the (injected) phone clockwise until the dial shows `symbol`, then hold
      need(); const v = thing(name);
      const steps = ((v.symbols.indexOf(symbol) - v.idx) + 4) % 4;
      for (let a = 0; a <= steps * 90; a += 5) { testView.roll = a; await frame(); }
      await wait((G.HOLD_SEC + 0.6) * 1000);
      const res = { idx: v.idx, symbolNow: v.symbols[v.idx], result: v.kind === 'valve' ? (G.valveOwner(v) || {}).result ?? null : !!v.ok, phase: G.puzzle.phase };
      testView.pitch = -80; await wait(500); testView.roll = 0; await frame(); return res; // let go, then straighten the phone
    },
    // hold the phone rolled by `deg` (clockwise) on whatever is aimed at, without letting go: for the turning screenshots
    async rollBy(deg) { need(); testView.roll = deg; for (let i = 0; i < 20; i++) await frame();
      const e = new THREE.Euler().setFromQuaternion(G.camera.quaternion, 'YXZ'), v = G.grabbed && G.grabbed.wheel ? G.grabbed : null;
      return { grabbedDial: !!v, viewRollDeg: THREE.MathUtils.radToDeg(e.z), viewLevel: G.viewLevel, wheelDeg: v ? -THREE.MathUtils.radToDeg(v.wheel.rotation.z) : null, idx: v ? v.idx : null,
        turnHint: (h => h && h.classList.contains ? h.classList.contains('show') : null)(document.getElementById('turnHint')) }; },
    async turnTo(k, symbol, which = 'target') { return this.turnThing((which === 'target' ? 'valve' : 'decoy') + k, symbol); },
    async hold(name, ms) { need(); viewTo(meshOf(thing(name))); await wait(ms); testView.pitch = -80; await wait(400); return G.puzzle.codePlayed; },
    async faceWall(k, ms) { need(); testView.yaw = THREE.MathUtils.radToDeg(faceYaw(k)); testView.pitch = 0; testView.roll = 0; await wait(ms); return players[G.cur].thrust; },
    // walk through the door to `to` (aims at it first), as a player tapping the door would
    async walkTo(to) { need(); const d = doorOf(to); if (!d) return false; viewTo(d.mesh); await frame(); await frame(); if (!G.aimed || G.aimed.to !== to) return false;
      G.goThrough(to); await wait(700); return players[G.cur].room === to; },
    asPlayer(k) { need(); G.showPlayer(k, false); return G.cur; },
    newPuzzle(seed) { need(); $('done').style.display = 'none'; G.newPuzzle(seed); return true; },
    // online lobby (works without test mode: these are the same as pressing the lobby buttons)
    net: { create: () => G.netCreate(), join: c => { G.netJoin(String(c)); return true; },
           info: () => { const NET = G.NET; return { on: NET.on, role: NET.role, code: NET.code, partner: NET.partner, started: NET.started, seed: G.puzzle && G.puzzle.seed }; } },
  };
}
