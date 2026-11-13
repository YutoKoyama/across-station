// ---------- feedback: vibration, sound, and the pack's 演出 (cues) ----------
// "cues": { "<event>": [ {"at": ms, "do": "light|flash|haptic|sfx|notice|story|ending", ...}, ... ] }
// events: step:<name> (a gimmick step begins), solve, end. Camera never moves on its own (motion sickness): effects are light, screen, sound, touch.

export const sleep = ms => new Promise(r => setTimeout(r, ms));

export function installFeedback(G) {
  const $ = G.$;
  // ---------- sound ----------
  G.audioCtx = null;
  function unlockAudio() {
    try { G.audioCtx = G.audioCtx || new (window.AudioContext || window.webkitAudioContext)(); G.audioCtx.resume && G.audioCtx.resume(); } catch (e) {}
    if (G.audioCtx) Promise.resolve(G.LOOK.audio(G.audioCtx)).then(() => G.LOOK.enterRoom(G.roomById[G.players[G.cur].room])).catch(e => console.warn('sound', e));
  }
  // textured sounds from the theme's sound set
  const SOUND = () => G.LOOK.hasSound;
  function sfx(name, o) { if (SOUND()) G.LOOK.sfx(name, o); }
  function setLight(color, ms) { // room light tint; ms > 0 = return to normal after ms
    G.hemi.color.set(color); G.LOOK.setTint(color);
    if (ms > 0) setTimeout(() => { G.hemi.color.copy(G.hemiBase); G.LOOK.setTint(null); }, ms);
  }

  // ---------- haptics: one at a time ----------
  function flash(ms) { const f = $('flash'); f.style.opacity = '0.35'; setTimeout(() => { f.style.opacity = '0'; }, ms); }
  const HAPTIC = { tick: [25], notch: [30], door: [25], correct: [80, 120, 80], wrong: [600], allDone: [80, 100, 80, 100, 500], phase: [200, 150, 200], second: [60], thrustOk: [450] };
  if (G.THEME.haptics) for (const [k, v] of Object.entries(G.THEME.haptics)) if (Array.isArray(v)) HAPTIC[k] = v; // the look tunes the feel
  const hq = []; let hBusy = false;
  // one pulse: vibrate if the device can; otherwise (iPhone browser, PC) the screen flashes and a soft beep of the same
  // length plays, so the vibration code (short / long) can still be told apart
  function pulse(ms) { if (!G.vibrate(ms)) { flash(ms); if (G.LOOK.beep) G.LOOK.beep(ms); } }
  async function runHaptics() {
    if (hBusy) return; hBusy = true;
    while (hq.length) { const p = hq.shift();
      if (typeof p === 'function') { p(); continue; }
      for (let i = 0; i < p.length; i++) { if (i % 2 === 0 && p[i] > 0 && !G.paused) pulse(p[i]); await sleep(p[i]); }
      await sleep(120); }
    hBusy = false;
  }
  // light taps (tick / notch) never queue up behind other vibrations
  function haptic(name) { if ((name === 'tick' || name === 'notch') && (hBusy || hq.length)) return; hq.push(HAPTIC[name]); runHaptics(); }

  // ---------- cues ----------
  const CUE_ACTIONS = {
    light: a => setLight(a.color, a.ms || 0),
    flash: a => { const f = $('flash'); f.style.background = a.color || '#fff'; f.style.opacity = '0.45'; setTimeout(() => { f.style.opacity = '0'; f.style.background = '#fff'; }, a.ms || 200); },
    haptic: a => { hq.push(a.pattern || HAPTIC[a.name] || HAPTIC.tick); runHaptics(); },
    sfx: a => sfx(a.name, a),
    notice: a => G.notice(a.text || '', a.autoHide !== false),
    story: () => { const t = G.T.story[G.stepNow()]; if (t) G.notice(t, true); },
    ending: () => { $('done').style.display = 'flex'; },
    sea: () => { if (G.LOOK.showSea) G.LOOK.showSea(true); },
  };
  const cueLog = [];
  function cue(name) {
    const list = (G.STAGE.cues || {})[name];
    cueLog.push(name);
    if (!list) return false;
    for (const a of list) { const run = CUE_ACTIONS[a.do]; if (run) setTimeout(() => { if (!G.paused || a.do === 'ending') run(a); }, a.at || 0); }
    return true;
  }
  Object.assign(G, { unlockAudio, SOUND, sfx, setLight, flash, HAPTIC, hq, runHaptics, haptic, cue, cueLog });
}
