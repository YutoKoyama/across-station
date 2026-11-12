// ---------- engine entry: builds the game from the content pack, then runs the render loop ----------
// Files (one role each):
//   content.js  pack + look loading, screen wording       world.js    renderer, camera, rooms, labels
//   feedback.js vibration, sound, 演出 (cues)               puzzle.js   dials, panels, steps, the vibration code
//   aim.js      aiming, dial turning, the thrust           view.js     orientation -> camera, touch, moving rooms
//   online.js   online co-op through the PC relay         hud.js      top band, notices, buttons, screens
//   testhooks.js automated device-test hooks              look.js / sound.js  the engine-side theme (art, sound)
// All parts share one game object G (state + functions), so each file only needs what it uses.
import * as THREE from '../vendor/three.module.js';
import { loadContent } from './content.js';
import { installWorld } from './world.js';
import { installFeedback } from './feedback.js';
import { installPuzzle } from './puzzle.js';
import { installAim } from './aim.js';
import { installView } from './view.js';
import { installOnline } from './online.js';
import { installHud } from './hud.js';
import { installMap } from './map.js';
import { installPartner } from './partner.js';
import { installGuide } from './guide.js';
import { installTestHooks } from './testhooks.js';
import { installPlatform } from './platform.js';

// adaptive resolution: lower it when fps stays low, and raise it again once fps has been stable for a while
const FPS_LOW = 50, FPS_GOOD = 58, LOW_SECS = 2, GOOD_SECS = 10, RATIO_MIN = 1, RATIO_MAX = 1.5, RATIO_STEP = 0.25;

export async function start() {
  // the PC simulation tests swap in a fake renderer and a fake theme loader here (globalThis.__SIM__); the app never sets it
  const SIM = globalThis.__SIM__ || {};
  const lookModule = SIM.lookModule ? await SIM.lookModule() : await import('./look.js');
  const G = { P: (window.Capacitor && window.Capacitor.Plugins) || {}, $: id => document.getElementById(id), paused: false };
  installPlatform(G);
  await loadContent(G, THREE, lookModule);
  installWorld(G, SIM.Renderer || THREE.WebGLRenderer, lookModule.createLook);
  installFeedback(G);
  installPuzzle(G);
  installAim(G);
  installView(G);
  installOnline(G);
  installHud(G);
  installMap(G);
  installPartner(G);
  installGuide(G);
  if (!G.publicWeb) installTestHooks(G); // the published web build has no test hooks

  // ---------- loop ----------
  const { renderer, scene, camera, $ } = G;
  let lowCount = 0, goodCount = 0, lastAction = null, raiseBlocked = false;
  function applyRatio(cap) { G.pixelRatioCap = cap; renderer.setPixelRatio(Math.min(window.devicePixelRatio, cap)); renderer.setSize(G.viewW(), G.viewH()); }
  function adaptResolution(fps) {
    lowCount = fps < FPS_LOW ? lowCount + 1 : 0;
    goodCount = fps >= FPS_GOOD ? goodCount + 1 : 0;
    if (lowCount >= LOW_SECS && G.pixelRatioCap > RATIO_MIN) {
      if (lastAction === 'raise') raiseBlocked = true; // raising made it slow again: stop trying (avoids flicker back and forth)
      applyRatio(Math.max(RATIO_MIN, G.pixelRatioCap - RATIO_STEP)); lowCount = 0; goodCount = 0; lastAction = 'lower';
    } else if (!raiseBlocked && goodCount >= GOOD_SECS && G.pixelRatioCap < RATIO_MAX) {
      applyRatio(Math.min(RATIO_MAX, G.pixelRatioCap + RATIO_STEP)); goodCount = 0; lastAction = 'raise';
    }
  }
  G.adaptResolution = adaptResolution;
  let frames = 0, t0 = performance.now(), prev = performance.now();
  G.gameClock = 0; G.lastLoopReal = 0; G.loopCount = 0; // game time (sum of frame dt) - test hooks wait on this, not on the wall clock (P11)
  function loop(now) {
    const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
    if (G.paused) { requestAnimationFrame(loop); return; }
    G.gameClock += dt; G.lastLoopReal = performance.now();
    G.updateCamera(dt); G.updateAim(dt); G.loopCount++;
    G.LOOK.update(dt, G.starDrift);
    G.tickMap(); G.tickPartner(dt);
    renderer.render(scene, camera);
    frames++;
    if (now - t0 >= 1000) {
      const fps = frames * 1000 / (now - t0); frames = 0; t0 = now;
      $('fps').textContent = fps.toFixed(0) + ' fps';
      adaptResolution(fps);
      G.updatePartner(); G.updateTodo();
      $('res').textContent = '解像度×' + renderer.getPixelRatio().toFixed(2);
      $('info').textContent = `${G.cur}：${G.roomById[G.players[G.cur].room].name}\n` + (G.touchMode ? '指で見回し' : (G.gotSensor ? 'センサー' : 'センサー待ち'));
    }
    requestAnimationFrame(loop);
  }

  G.newPuzzle();
  requestAnimationFrame(loop);
  window.__appStage = 'ready';
  window.__appReady = true;
  return G;
}
