// ---------- HUD: top band, partner line, notices, buttons, settings, start / pause screens ----------
const NOTICE_AUTO_HIDE_MS = 12000; // story notices fade away by themselves; warnings (rest, no sensor) stay until closed
const REST_AFTER_MS = 15 * 60 * 1000;   // spec 4-7: suggest a break after ~15 minutes
const SENSOR_WAIT_MS = 3000;            // if no orientation data by then, offer the touch-look mode

export function installHud(G) {
  const { $, T, UI, fmt, STAGE, ROOMS, roomById, players, camera } = G;
  const LOOK = G.LOOK;
  function updateMap() { if (G.drawMap) G.drawMap(); } // the map itself: engine/map.js
  // "いまやること": one concrete next action for the player on screen, from the step and where they are (never the answer)
  function todoLine() {
    const TD = T.todo || {}; if (!G.puzzle) return '';
    const me = players[G.cur], here = me.room, home = roomById[me.start].name;
    const PL = STAGE.placement, cmd = roomById[PL.commRoom].name, tbl = roomById[PL.codeTableRoom].name;
    if (G.isStep('crossValves')) return me.result === true ? TD.valveDone : TD.valve;
    if (G.isStep('vibrationCode')) {
      if (!G.puzzle.codePlayed) return here === PL.commRoom ? TD.codeAtPanel : fmt(TD.codeGo, { cmd });
      return fmt(TD.codeHeard, { cmd, tbl });
    }
    if (G.isStep('thrust')) return me.thrust ? TD.thrustDone : here !== me.start ? fmt(TD.thrustGo, { cmd, home }) : TD.thrustAt;
    return TD.end || '';
  }
  G.shownTodo = null;
  function updateTodo() { const t = todoLine() || ''; if (t === G.shownTodo) return; G.shownTodo = t; $('todo').textContent = t; measureTop(); }
  // the band's height changes with the text: keys and notices below it follow (CSS var --topH)
  function measureTop() { try { const h = $('top').offsetHeight; if (h) document.documentElement.style.setProperty('--topH', h + 'px'); } catch (e) {} }
  if (typeof addEventListener === 'function') addEventListener('resize', () => setTimeout(measureTop, 50));
  const ROLE = Object.fromEntries(Object.entries(STAGE.roles).map(([k, r]) => [k, r.label]));
  // partner bubble: shows what the OTHER crew member is doing (their state only; never the answer).
  // In the online version (⑦) this is where the partner's quick messages appear.
  function partnerLine() {
    const ps = G.partnerStamp;
    if (ps && performance.now() < ps.until) return `${G.NET.role === 'A' ? 'B' : 'A'}：「${ps.text}」`;
    const o = G.cur === 'A' ? 'B' : 'A', p = players[o], room = roomById[p.room].name;
    if (!G.puzzle) return '';
    const P = T.partner, st = k => players[k].thrust ? P.thrustDone : players[k].thrustT > 0 || players[k].holding ? P.thrustHolding : P.thrustWaiting;
    if (G.isStep('crossValves')) return fmt(p.result ? P.valveDone : P.valveNotYet, { o, room });
    if (G.isStep('vibrationCode')) return fmt(P.inRoom, { o, room }) + (G.puzzle.codePlayed ? P.codeHeard : '');
    if (G.isStep('thrust')) return fmt(P.thrust, { a: st('A'), b: st('B') });
    return P.end;
  }
  G.shownPartner = null;
  function updatePartner() {
    const t = partnerLine(); if (t === G.shownPartner) return; G.shownPartner = t;
    $('partnerText').textContent = t; $('partnerAv').textContent = G.puzzle && G.reached('thrust') ? '★' : (G.cur === 'A' ? 'B' : 'A');
  }
  function updateStatus() {
    const s = r => r === true ? '●' : r === false ? '×' : '…';
    const m = k => G.puzzle && G.reached('thrust') ? (players[k].thrust ? '◆' : '…') : s(players[k].result);
    $('btnPlayer').textContent = `${G.cur}⇄${G.cur === 'A' ? 'B' : 'A'}`;
    $('btnPlayer').title = `A${m('A')} B${m('B')}`;
    $('who').textContent = fmt(UI.youAre || '{role}', { role: ROLE[G.cur] });
    updateMap(); updatePartner(); updateTodo();
  }
  // gentle notices (not blocking the game)
  let noticeTimer = null;
  function notice(text, autoHide = false) {
    $('noticeText').textContent = G.clean(text); $('notice').style.display = 'block';
    clearTimeout(noticeTimer); if (autoHide) noticeTimer = setTimeout(() => { $('notice').style.display = 'none'; }, NOTICE_AUTO_HIDE_MS);
  }
  Object.assign(G, { updateMap, updatePartner, updateStatus, updateTodo, notice });

  // ---------- buttons and screens ----------
  { // art guide: own line icons instead of emoji (stroke 1.75, square caps)
    const svg = p => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square">${p}</svg>`;
    $('btnPause').innerHTML = svg('<path d="M9 6v12M15 6v12"/>');
    $('btnSettings').innerHTML = svg('<circle cx="12" cy="12" r="6.5"/><path d="M12 5.5v4M12 2.5v1.5M12 20v1.5M2.5 12H4M20 12h1.5"/>');
    $('btnStamp').innerHTML = svg('<path d="M4 5h16v11H11l-4 3v-3H4z"/><path d="M8 10.5h8"/>');
    $('pause').firstElementChild.textContent = UI.pauseTitle;
  }
  // ---------- player settings, saved on this phone (P16): volume 0-100 for every sound, room ambience on / off ----------
  // Ambience off silences only the room hum and the air conditioning; operation sounds and vibration stay.
  const SETTINGS_KEY = 'ss_settings', SETTINGS_DEFAULT = { volume: 100, ambience: true };
  G.settings = (() => { try { return Object.assign({}, SETTINGS_DEFAULT, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { return { ...SETTINGS_DEFAULT }; } })();
  const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(G.settings)); } catch (e) {} };
  const applySettings = () => { LOOK.setVolume(G.settings.volume / 100); LOOK.setAmbience(G.settings.ambience); };
  {
    const row = document.createElement('div'); row.className = 'row'; row.id = 'volRow';
    row.innerHTML = '<span id="volLabel"></span><input id="vol" type="range" min="0" max="100" step="5"><span id="volVal"></span>';
    $('btnSettingsClose').before(row);
    const amb = document.createElement('button'); amb.id = 'btnAmbience';
    $('btnSettingsClose').before(amb);
    const show = () => {
      $('volLabel').textContent = UI.volumeLabel; $('vol').value = String(G.settings.volume); $('volVal').textContent = G.settings.volume + '%';
      amb.textContent = fmt(UI.ambienceLabel, { v: G.settings.ambience ? UI.on : UI.off }); amb.classList.toggle('on', G.settings.ambience);
    };
    $('vol').oninput = e => { G.settings.volume = Math.max(0, Math.min(100, Math.round(+e.target.value))); applySettings(); saveSettings(); show(); };
    $('vol').onchange = () => G.sfx('dial', { vol: 0.6 }); // a sample at the new volume
    amb.onclick = () => { G.settings.ambience = !G.settings.ambience; applySettings(); saveSettings(); show(); };
    if (!LOOK.hasSound) amb.style.display = 'none'; // a theme without a sound set has no room ambience
    show(); applySettings();
  }
  addEventListener('click', e => { if (e.target.closest && e.target.closest('button')) G.sfx('ui', { vol: 0.45 }); }, true); // a soft key click on every button
  $('btnRecenter').onclick = () => G.recenter();
  $('btnTouch').onclick = () => G.setTouchMode(!G.touchMode);
  G.starDrift = true;
  $('btnStars').onclick = e => { G.starDrift = !G.starDrift; e.target.textContent = fmt(UI.starsLabel, { v: G.starDrift ? UI.on : UI.off }); e.target.classList.toggle('on', G.starDrift); };
  $('btnPlayer').onclick = () => G.showPlayer(G.cur === 'A' ? 'B' : 'A');
  $('btnSettings').onclick = () => { $('settings').style.display = 'flex'; };
  $('btnSettingsClose').onclick = () => { $('settings').style.display = 'none'; };
  $('btnPause').onclick = () => { G.paused = true; G.hq.length = 0; G.codePlaying = false; if (G.SOUND()) LOOK.duck(false); $('pause').style.display = 'flex'; LOOK.pause(true); LOOK.loop('thrust', false); };
  $('btnResume').onclick = () => { G.paused = false; $('pause').style.display = 'none'; LOOK.pause(false); G.sfx('ui', { vol: 0.5 }); };
  $('btnAgain').onclick = () => { $('done').style.display = 'none'; G.newPuzzle(); };
  $('fov').oninput = e => { camera.fov = +e.target.value; camera.updateProjectionMatrix(); $('fovVal').textContent = e.target.value + '°'; };
  $('noticeClose').onclick = () => { $('notice').style.display = 'none'; };
  let playStart = null, restShown = false;
  // taps that start play also unlock what browsers keep locked until a tap: sound, the iPhone tilt sensor, screen-on
  const unlockByTap = () => { G.askSensorPermission(); G.unlockAudio(); G.keepAwake(); G.lockPortrait(); };
  $('btnStart').onclick = () => { unlockByTap(); startGame(); };
  async function startGame() {
    $('start').style.display = 'none';
    G.unlockAudio(); G.keepAwake();
    try { if (G.P.ScreenOrientation) await G.P.ScreenOrientation.lock({ orientation: 'portrait' }); } catch (err) {}
    G.recenterPending = true; G.haptic('tick');
    playStart = performance.now();
    if (G.maybeGuide) G.maybeGuide(); // first time on this phone: what each part of the screen is
    setTimeout(() => { if (!G.gotSensor && !G.touchMode) { G.setTouchMode(true); notice(UI.noticeNoSensor); } }, SENSOR_WAIT_MS);
  }
  G.startGame = startGame;
  if (G.publicWeb) { const a = document.querySelector && document.querySelector('a[href="sensor-test.html"]'); if (a) a.style.display = 'none'; }
  $('btnHost').onclick = () => { unlockByTap(); G.netCreate().catch(() => { $('onlineMsg').textContent = G.NET.mode === 'peer' ? UI.onlineNoBroker : UI.onlineRelayDown; }); };
  $('btnJoin').onclick = () => { unlockByTap(); const c = $('joinCode').value.trim(); if (!/^\d{4}$/.test(c)) { $('onlineMsg').textContent = UI.onlineNeedCode; return; } G.netJoin(c); };
  $('btnStamp').onclick = () => { const m = $('stampMenu'); m.style.display = m.style.display === 'flex' ? 'none' : 'flex'; };
  $('stampMenu').innerHTML = STAGE.stamps.map((t, i) => `<button data-i="${i}">${t}</button>`).join('');
  $('stampMenu').onclick = e => { const i = e.target.dataset && e.target.dataset.i; if (i !== undefined) G.sendStamp(STAGE.stamps[+i]); };
  // leaving the app (home button / another app): silence the station hum; coming back: sound again
  if (document.addEventListener) document.addEventListener('visibilitychange', () => {
    if (!G.audioCtx) return;
    try { if (document.hidden) G.audioCtx.suspend(); else G.audioCtx.resume(); } catch (e) {}
  });
  setInterval(() => {
    if (playStart === null || restShown || document.hidden) return;
    if (performance.now() - playStart >= REST_AFTER_MS) { restShown = true; notice(UI.noticeRest); }
  }, 10000);
}
