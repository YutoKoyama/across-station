// ---------- online co-op (⑦) ----------
// Two ways to connect, same game messages:
//   peer  (web, https e.g. GitHub Pages): PeerJS. The free public PeerJS broker only introduces the two players
//         (no account); the game messages then go directly between the two browsers (WebRTC).
//   relay (phone app / local tests): tools/relay_server.mjs on the PC, reached over USB (adb reverse) or http://localhost:8787
// Choice: ?net=peer|relay in the URL, else peer on an https page outside the app, relay otherwise.
const STAMP_SHOW_MS = 8000;
const PEER_PREFIX = 'yuto-across-ss-'; // + the 4-digit room code = the host's id at the broker
const JOIN_TIMEOUT_MS = 15000, CODE_TRIES = 5;
// coming back to the same room (2026-11-13): the room (code, role, seed) is kept on this phone for 2 hours
const SAVE_KEY = 'ss_online_room', SAVE_TTL_MS = 2 * 60 * 60 * 1000, SAVE_REFRESH_MS = 60 * 1000;
const REOPEN_WAIT_MS = [0, 2000, 4000, 6000, 8000, 10000, 10000, 10000, 10000]; // A takes its room id back (the broker may still hold the old one)
const ANSWER_MS = 10000; // B waits this long for A's answer to a join, then knocks again
const RECONNECT_FIRST_MS = 3000, RECONNECT_STEP_MS = 3000, RECONNECT_MAX_MS = 15000; // B knocks again: 3 s, 6 s, ... 15 s

export function installOnline(G) {
  const { $, fmt, UI, players, valves, roomById } = G;
  const asked = new URLSearchParams(location.search || '').get('net');
  const mode = asked === 'peer' || asked === 'relay' ? asked : (!G.native && location.protocol === 'https:' ? 'peer' : 'relay');
  const NET = G.NET = { on: false, mode, base: location.port === '8787' ? location.origin : 'http://localhost:8787', code: null, role: null,
    id: Math.random().toString(36).slice(2, 8), es: null, partner: false, seed: null, started: false };

  // ---- relay transport (PC) ----
  const relay = {
    connect(code) {
      NET.es = new EventSource(`${NET.base}/room/${code}/events?id=${NET.id}`);
      NET.esOpen = new Promise(res => { NET.es.onopen = () => res(); setTimeout(res, 2000); }); // join only once we can hear the answer (review 1 S11)
      NET.es.onmessage = e => { try { onNet(JSON.parse(e.data)); } catch (err) { console.warn('net', err); } };
      NET.es.onerror = () => { $('onlineMsg').textContent = UI.onlineRelayDown; };
    },
    async create() { const r = await fetch(`${NET.base}/room/new`); const { code } = await r.json(); return code; },
    async join(code) { if (NET.esOpen) await NET.esOpen; netSend(joinMsg()); },
    send(msg) { fetch(`${NET.base}/room/${NET.code}/send?id=${NET.id}`, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) }).catch(() => {}); },
  };
  // ---- peer transport (PeerJS, internet) ----
  async function peerLib() {
    if (window.Peer) return window.Peer;
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/peerjs.min.js'; s.onload = res; s.onerror = () => rej(new Error('peerjs')); document.head.appendChild(s); });
    return window.Peer;
  }
  const peerOpts = () => Object.assign({ debug: 1 }, window.__PEER_OPTS__ || {});
  let peer = null, conn = null;
  const parse = d => (typeof d === 'string' ? JSON.parse(d) : d);
  // use c as THE link; an older link is closed (review 5 M1: two links from one phone left both sides stuck)
  function attach(c) {
    const old = conn; conn = c;
    if (old && old !== c) { try { old.close(); } catch (e) {} }
    if (c.__ssAttached) return; c.__ssAttached = true;
    c.on('data', d => { if (conn !== c) return; try { onNet(parse(d)); } catch (err) { console.warn('net', err); } });
    c.on('close', () => { if (conn === c) { conn = null; onNet({ t: 'peer-left' }); } });
  }
  // A: an incoming link waits until its "join" says who it is (review 5 S1). Only then does it become THE link:
  // the same game's B (seed) replaces an older link of B; anyone else is told 'gone' / 'full' on that link and closed.
  function hostLink(c) {
    const turnAway = kind => { try { c.send({ t: kind }); } catch (e) {} setTimeout(() => { try { c.close(); } catch (e) {} }, 300); };
    c.on('data', d => {
      if (c === conn || c.__ssAttached) return; // THE link: handled by attach()
      let m; try { m = parse(d); } catch (e) { return; }
      if (!m || m.t !== 'join' || !valid(m, 'B')) return; // nothing else counts before the join
      const verdict = joinVerdict(m, conn && conn.open && NET.partner);
      if (verdict !== 'ok') return turnAway(verdict);
      if (conn && conn !== c) NET.partner = false; // the same B on a new link (or B's seat was free)
      attach(c); onNet(m);
    });
    setTimeout(() => { if (c !== conn && c.open && !c.closed) { try { c.close(); } catch (e) {} } }, JOIN_TIMEOUT_MS); // never said join
  }
  const peerT = {
    async create(fixed = null) { // fixed: A coming back takes the same code (= the same id at the broker) again
      const Peer = await peerLib();
      const WAITS = (G.netLimits && G.netLimits.reopenWaitMs) || REOPEN_WAIT_MS, tries = fixed ? WAITS.length : CODE_TRIES;
      for (let i = 0; i < tries; i++) {
        if (fixed && WAITS[i]) { $('onlineMsg').textContent = fmt(UI.onlineReopening || '', { code: fixed, n: i + 1 }); await sleep(WAITS[i]); }
        const code = fixed || String(1000 + Math.floor(Math.random() * 9000));
        const res = await new Promise(done => {
          peer = new Peer(PEER_PREFIX + code, peerOpts());
          peer.on('open', () => done(true));
          peer.on('error', e => done(e && e.type === 'unavailable-id' ? false : e));
        });
        if (res === true) {
          peer.on('connection', c => {
            // only 2 players: a link becomes the partner's only after a right "join" (hostLink); others are turned away there
            hostLink(c);
          });
          peer.on('error', () => { if (!NET.partner) $('onlineMsg').textContent = UI.onlineNoBroker; });
          // the phone slept / the network blinked: get the room id back at the broker so B can join again (review 2 S2)
          // back off 1s -> 30s so an offline phone does not hammer the broker (review 3 S1)
          let backoff = 1000, retryT = 0;
          const retry = (now) => { clearTimeout(retryT); retryT = 0; try { if (peer && peer.disconnected && !peer.destroyed) peer.reconnect(); } catch (e) {} };
          peer.on('open', () => { backoff = 1000; });
          peer.on('disconnected', () => { if (retryT || peer.destroyed) return; retryT = setTimeout(retry, backoff); backoff = Math.min(backoff * 2, 30000); });
          const kick = () => { if (peer && peer.disconnected && !peer.destroyed) { backoff = 1000; retry(); } };
          if (document.addEventListener) document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
          if (typeof window !== 'undefined' && window.addEventListener) window.addEventListener('online', kick);
          return code;
        }
        try { peer.destroy(); } catch (e) {}
        if (res !== false) throw res;
      }
      throw new Error(fixed ? 'room id still taken' : 'no free room code');
    },
    async join(code) { await peerConnect(code); },
    send(msg) { if (conn && conn.open) conn.send(msg); },
  };
  // B: (re)connect to A's room id and say "join" (with this phone's game state when it has one)
  // one 'error' / 'open' listener per peer object, pointed at the attempt in progress (review 4 S1: they used to pile up per knock)
  let curErr = null, curOpen = null;
  function hookPeer(p) { if (p.__ssHooked) return; p.__ssHooked = true; p.on('error', e => { const f = curErr; if (f) f(e); }); p.on('open', () => { const f = curOpen; if (f) f(); }); }
  async function peerConnect(code) {
    const Peer = await peerLib();
    if (!peer || peer.destroyed) { peer = new Peer(undefined, peerOpts()); hookPeer(peer); await new Promise((res, rej) => { curOpen = res; curErr = rej; }).finally(() => { curOpen = curErr = null; }); }
    else if (peer.disconnected) { hookPeer(peer); try { peer.reconnect(); } catch (e) {} await new Promise(res => { curOpen = res; setTimeout(res, 4000); }).finally(() => { curOpen = null; }); }
    hookPeer(peer);
    const c = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
    attach(c);
    try {
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout')), JOIN_TIMEOUT_MS);
        c.on('open', () => { clearTimeout(t); res(); });
        const bad = e => { clearTimeout(t); rej(e); };
        curErr = bad; if (c.on) c.on('error', bad);
        if (c.on) c.on('close', () => bad(new Error('closed'))); // a link closed before it opened (e.g. replaced by a second tap) never opens: fail now (review 6 M1)
      }).finally(() => { curErr = null; });
    } catch (e) { if (conn === c) conn = null; try { c.close(); } catch (e2) {} throw e; } // a failed knock leaves no half-open link
    c.send(joinMsg());
    // no answer to the join (no init / full / gone) within ANSWER_MS: drop this link and knock again (review 5 S1)
    if (NET.keepTrying || NET.started) setTimeout(() => {
      if (conn !== c || NET.partner || !NET.on) return;
      conn = null; try { c.close(); } catch (e) {} if (!NET.started) $('onlineMsg').textContent = fmt(UI.onlineRejoinWait || '', { code: NET.code, other: 'A' });
      scheduleReconnect();
    }, (G.netLimits && G.netLimits.answerMs) || ANSWER_MS);
  }
  const tr = mode === 'peer' ? peerT : relay;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // join: a phone that has the game sends it; a phone coming back from its saved room sends the saved seed (= which room it means)
  const joinMsg = () => NET.started ? { t: 'join', seed: NET.seed, resume: snapshot() } : NET.expectSeed != null ? { t: 'join', seed: NET.expectSeed } : { t: 'join' };

  function netSend(msg) { if (NET.on) tr.send(msg); }
  async function netCreate() { // player A makes a room and decides the puzzle
    NET.seed = Math.floor(Math.random() * 2 ** 31);
    const code = await tr.create();
    Object.assign(NET, { on: true, code, role: 'A' });
    if (mode === 'relay') relay.connect(code);
    $('onlineMsg').textContent = fmt(UI.onlineWaiting, { code });
    return code;
  }
  let joinGen = 0;
  async function netJoin(code, keepTrying = false) { // keepTrying: coming back from the title screen (A may not be back yet)
    const gen = ++joinGen;
    Object.assign(NET, { on: true, code, role: 'B', keepTrying });
    if (!keepTrying) NET.expectSeed = null;
    $('onlineMsg').textContent = fmt(UI.onlineJoining, { code });
    if (mode === 'relay' && !(NET.es && NET.es.readyState !== 2 && NET.esCode === code)) { relay.connect(code); NET.esCode = code; }
    try { await tr.join(code); return true; }
    catch (e) {
      if (gen !== joinGen || NET.partner || NET.started || (keepTrying && knocking)) return true; // a newer knock (2nd press) replaced this one // an older attempt failing after a newer one took over: leave the live link alone (review 6 M1)
      if (keepTrying && mode === 'peer') { $('onlineMsg').textContent = fmt(UI.onlineRejoinWait || '', { code, other: 'A' }); scheduleReconnect(); return true; }
      NET.on = false; $('onlineMsg').textContent = e && e.type === 'peer-unavailable' ? UI.onlineNoRoom : UI.onlineNoBroker; return false;
    }
  }
  // back to the saved room in the saved role. A opens the same code again; B joins it (and keeps knocking until A is there)
  // Returns false when it failed and the button may be pressed again (review 4 M2).
  async function netRejoin(rec) {
    if (!rec || NET.started) return false;
    NET.expectSeed = rec.seed; resetReconnect();
    if (rec.role === 'B') {
      if (NET.on && NET.role === 'B' && NET.code === rec.code) { kickReconnect(); return true; } // already knocking: knock now
      return netJoin(rec.code, true);
    }
    if (NET.reopening) return true;
    Object.assign(NET, { on: true, code: rec.code, role: 'A', seed: rec.seed, reopening: true });
    $('onlineMsg').textContent = fmt(UI.onlineReopening || '', { code: rec.code, n: 1 });
    try { if (mode === 'relay') { if (!NET.es || NET.es.readyState === 2) relay.connect(rec.code); } else if (!peer || peer.destroyed || !peer.__ssHost) { await peerT.create(rec.code); peer.__ssHost = true; } }
    catch (e) { NET.on = false; NET.reopening = false; $('onlineMsg').textContent = fmt(UI.onlineReopenFailed || UI.onlineNoBroker, { code: rec.code }); return false; }
    NET.reopening = false;
    $('onlineMsg').textContent = fmt(UI.onlineWaitingBack || UI.onlineWaiting, { code: rec.code, other: 'B' });
    return true;
  }
  // the saved room turned out to be someone else's now (another seed): forget it, stop, say so
  function roomGone() {
    clearRoom(); NET.on = false; NET.expectSeed = null; resetReconnect(); clearTimeout(reconTimer); reconTimer = 0;
    try { if (conn && conn.close) conn.close(); } catch (e) {} try { if (NET.es) NET.es.close(); } catch (e) {}
    $('onlineMsg').textContent = UI.onlineRoomGone || ''; if (G.onRoomGone) G.onRoomGone();
  }
  // ---- B keeps knocking on A's room while A is away (PeerJS; on the relay, A's coming back is announced by the relay) ----
  // It stops after NET_LIMITS (review 4 S1); then the banner (in the game) or the title button lets the player try again.
  let reconTimer = 0, reconDelay = RECONNECT_FIRST_MS, reconTries = 0, reconSince = 0, knocking = false;
  const NET_LIMITS = G.netLimits = { maxTries: 120, maxMs: 30 * 60 * 1000 };
  function resetReconnect() { reconDelay = RECONNECT_FIRST_MS; reconTries = 0; reconSince = 0; NET.gaveUp = false; }
  function scheduleReconnect() {
    if (mode !== 'peer' || NET.role !== 'B' || !NET.on || NET.partner || NET.bye || NET.gaveUp || reconTimer) return;
    if (!reconSince) reconSince = Date.now();
    if (reconTries >= NET_LIMITS.maxTries || Date.now() - reconSince > NET_LIMITS.maxMs) return giveUp();
    reconTimer = setTimeout(async () => {
      reconTimer = 0; if (NET.partner || !NET.on || NET.gaveUp) return;
      reconTries++; knocking = true;
      try { await peerConnect(NET.code); } // got through: the answer (init / full / gone) decides what next; the delay is reset only when paired
      catch (e) { reconDelay = Math.min(reconDelay + RECONNECT_STEP_MS, RECONNECT_MAX_MS); knocking = false; scheduleReconnect(); return; }
      knocking = false;
    }, reconDelay);
  }
  // pressed again while waiting: knock soon (a knock already on its way is left alone: no second link, review 5 M1)
  function kickReconnect() { if (knocking || NET.partner) return; clearTimeout(reconTimer); reconTimer = 0; reconDelay = Math.min(reconDelay, 1000); NET.gaveUp = false; NET.on = true; scheduleReconnect(); reconDelay = RECONNECT_FIRST_MS; }
  function giveUp() {
    NET.gaveUp = true;
    if (NET.started) setBanner(fmt(UI.bannerGaveUp || '', { code: NET.code, other: 'A' }));
    else { $('onlineMsg').textContent = fmt(UI.onlineGaveUp || '', { code: NET.code }); if (G.onRejoinFailed) G.onRejoinFailed(); }
  }
  G.netReconnectDelay = () => reconDelay; // (tests)
  // ---- the saved room on this phone ----
  function saveRoom() { if (!NET.started || !NET.code) return; try { localStorage.setItem(SAVE_KEY, JSON.stringify({ code: NET.code, role: NET.role, seed: NET.seed, mode, t: Date.now() })); } catch (e) {} }
  function clearRoom() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }
  function savedRoom(now = Date.now()) {
    let r = null; try { r = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null'); } catch (e) { r = null; }
    const ok = r && typeof r === 'object' && /^\d{4}$/.test(String(r.code)) && (r.role === 'A' || r.role === 'B') && Number.isInteger(r.seed)
      && Number.isFinite(r.t) && now - r.t >= 0 && now - r.t < SAVE_TTL_MS && (!r.mode || r.mode === mode);
    if (!ok) { if (r) clearRoom(); return null; }
    return r;
  }
  setInterval(() => { if (NET.started && G.puzzle && !G.isStep('end')) saveRoom(); }, SAVE_REFRESH_MS);
  { const prev = G.onPhase; G.onPhase = step => { if (prev) prev(step); if (NET.started) { if (step === 'end') clearRoom(); else saveRoom(); } }; } // finished: nothing to come back to
  // ---- "相手が抜けました" stays on screen (inside the top band) until they are back ----
  // a strip of its own just under the top band; the map and the side keys move down with it (hud.js measureTop adds its height)
  const banner = document.createElement('div'); banner.id = 'netBanner';
  banner.style.cssText = 'display:none;position:fixed;left:8px;right:8px;top:calc(max(8px, env(safe-area-inset-top)) + var(--bandH, 60px) + 4px);z-index:12;'
    + 'padding:6px 10px;background:rgba(16,20,31,.92);border:1px solid rgba(242,162,58,.65);color:#F2C27A;font-size:12px;line-height:1.5';
  if (document.body && document.body.appendChild) document.body.appendChild(banner);
  banner.onclick = () => { if (NET.gaveUp && NET.started) { resetReconnect(); setBanner(fmt(UI.bannerLeftB, { other: 'A', code: NET.code })); scheduleReconnect(); } };
  function setBanner(text) { banner.textContent = text || ''; banner.style.display = text ? 'block' : 'none'; if (G.measureTop) G.measureTop(); }
  G.netBannerText = () => (banner.style.display === 'none' ? '' : banner.textContent);
  // newDevice: someone came in with the room code only (no saved game): maybe B on another browser, maybe not (review 5 S2)
  function partnerBack(other, newDevice = false) { if (!NET.wasAway) return; NET.wasAway = false; setBanner('');
    G.notice(fmt((newDevice ? UI.noticeNewDevice : UI.noticePartnerBack) || '{other}が戻りました', { other }), !newDevice); }
  // leave the room on purpose: tell the partner, forget the room, back to the title
  function leaveRoom() { if (NET.on) netSend({ t: 'bye' }); clearRoom(); NET.on = false; setTimeout(() => { try { if (location.reload) location.reload(); } catch (e) {} }, 400); } // 0.4 s for the bye to go out (review 4 S2)
  function startOnline(seed, resume) {
    if (NET.started) return; NET.started = true; NET.seed = seed;
    G.newPuzzle(seed);
    if (resume) applyResume(resume);
    saveRoom();
    G.showPlayer(NET.role, false);
    $('btnPlayer').style.display = 'none'; $('btnStamp').style.display = 'block';
    G.startGame();
    if (resume) { netSend({ t: 'room', who: NET.role, room: players[NET.role].room }); G.notice(UI.noticeResumed || '', true); }
    else if (NET.expectSeed != null) G.notice(UI.noticeRestarted || '', false); // came back, but nobody kept the game (both had left): from the start
    NET.expectSeed = null; resetReconnect();
  }
  // ---- rejoining (review 1 M4): A (the room's owner) keeps the game; when B joins again, A sends where the game is ----
  // Valves are rebuilt in the same order from the seed, so their index is the same on both phones.
  function snapshot() {
    const pz = G.puzzle, pl = k => { const p = players[k]; return { room: p.room, result: p.result, thrust: !!p.thrust }; };
    return { phase: pz.phase, codePlayed: pz.codePlayed || 0, heartPlayed: pz.heartPlayed || 0, players: { A: pl('A'), B: pl('B') }, valves: valves.map(v => [v.idx, !!v.ok]) };
  }
  function applyResume(r) {
    if (!r || typeof r !== 'object') return;
    const pz = G.puzzle, steps = G.STAGE.steps || [];
    (Array.isArray(r.valves) ? r.valves : []).forEach((x, i) => { const v = valves[i]; if (!v || !Array.isArray(x) || !okIdx(x[0])) return; G.setValveIdx(v, x[0]); v.ok = !!x[1]; G.setLamp(v, v.ok); });
    for (const k of ['A', 'B']) { const q = r.players && r.players[k]; if (!q) continue; const p = players[k];
      if (roomById[q.room]) p.room = q.room; p.result = q.result === true ? true : q.result === false ? false : null; p.thrust = !!q.thrust; }
    pz.codePlayed = Math.max(0, r.codePlayed | 0); pz.heartPlayed = Math.max(0, r.heartPlayed | 0);
    const n = r.phase | 0; if (n > 1 && n <= steps.length + 1) G.setPhase(n, true); // straight to that step (doors follow the phase)
  }
  // A: may this join take B's seat? 'gone' = another game (seed), 'full' = the seat is taken / kept for our own B
  function joinVerdict(m, seatTaken) {
    if ('seed' in m && m.seed !== NET.seed) return 'gone';
    if (!NET.started && NET.expectSeed != null && !('seed' in m)) return 'full';
    if (seatTaken && !('seed' in m)) return 'full'; // only the same game's B (it knows the seed) may replace a live link
    return 'ok';
  }
  // turn a joiner away (A): 'gone' = this is not your game (other seed), 'full' = this seat is kept for our own B
  function refuse(kind, to) {
    netSend({ t: kind, to: to || undefined });
    if (mode === 'peer') { const c = conn; setTimeout(() => { try { if (c && c.close) c.close(); } catch (e) {} }, 300); }
  }
  // both phones kept the game but the link was down for a while: move on to the further step of the two
  function catchUp(r) { const n = r && (r.phase | 0); if (G.puzzle && n > G.puzzle.phase && n <= (G.STAGE.steps || []).length + 1) G.setPhase(n, true); }
  // ---- what the partner sends is checked before it is used (review 1 S6): a bad message is dropped, never thrown in the loop ----
  const okIdx = x => Number.isInteger(x) && x >= 0 && x < 4;
  function valid(m, other) {
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return false;
    if ('who' in m && m.who !== other) return false; // only the partner's own state
    switch (m.t) {
      case 'room': return m.who === other && !!roomById[m.room];
      case 'dial': return Number.isInteger(m.i) && !!valves[m.i] && okIdx(m.idx);
      case 'judge': return Number.isInteger(m.i) && !!valves[m.i] && okIdx(m.idx) && typeof m.ok === 'boolean';
      case 'code': return Number.isInteger(m.n) && m.n >= 0 && m.n < 1000;
      case 'done': return typeof m.step === 'string' && (G.STAGE.steps || []).includes(m.step);
      case 'thrust': case 'gaze': return m.who === other && ['holding', 'done', 'on'].every(k => !(k in m) || typeof m[k] === 'boolean');
      case 'look': return m.who === other && Number.isFinite(m.yaw) && (m.pitch === undefined || Number.isFinite(m.pitch));
      case 'stamp': return typeof m.text === 'string' && m.text.length <= 60;
      case 'init': return Number.isInteger(m.seed) && (!m.resume || typeof m.resume === 'object');
      case 'gone': case 'full': return !('to' in m) || typeof m.to === 'string';
      case 'join': return (!('seed' in m) || Number.isInteger(m.seed)) && (!m.resume || typeof m.resume === 'object');
      default: return true;
    }
  }
  function onNet(m) {
    const other = NET.role === 'A' ? 'B' : 'A';
    if (!valid(m, other)) return;
    // relay: messages carry the sender's id. Once paired, only the partner is listened to; a 3rd player is told the room is full
    const from = m.from || (m.t === 'peer-joined' || m.t === 'peer-left' ? m.id : null);
    if (mode === 'relay' && from && NET.partnerId && from !== NET.partnerId) {
      if (m.t === 'peer-left') return;
      if (NET.partner) { if ((m.t === 'join' || m.t === 'peer-joined') && NET.role === 'A') netSend({ t: 'full', to: from }); return; }
    }
    switch (m.t) {
      case 'join': case 'peer-joined':
        if (NET.role !== 'A') { // B: on the relay, A coming back shows up as a new member -> say join again (with this phone's state)
          if (m.t === 'peer-joined' && mode === 'relay' && NET.on && !NET.partner && !NET.bye) netSend(joinMsg());
          break;
        }
        if (m.t === 'peer-joined') break; // wait for B's own "join": it says which game (seed) and may carry B's state (review 4 M1)
        // only this game's B: a join for another seed is told the room is gone; while this A is coming back, a join without a seed waits
        { const v = joinVerdict(m, false); if (v !== 'ok') { refuse(v, from); break; } }
        NET.partner = true; if (from) NET.partnerId = from;
        if (!NET.started && m.resume && m.seed === NET.seed) startOnline(NET.seed, m.resume); // A came back: B kept the game, continue from B's state
        else if (NET.started && m.resume && m.seed === NET.seed) catchUp(m.resume); // both kept it (only the link broke): take the further step
        if (NET.started) netSend({ t: 'init', seed: NET.seed, resume: snapshot(), to: from || undefined }); // B came back: continue from here
        else { netSend({ t: 'init', seed: NET.seed, to: from || undefined }); startOnline(NET.seed); }
        partnerBack(other, NET.started && !('seed' in m));
        break;
      case 'init':
        if (NET.role !== 'B' || (m.to && m.to !== NET.id)) break;
        if (!NET.started && NET.expectSeed != null && m.seed !== NET.expectSeed) { roomGone(); break; } // the code is someone else's room now
        if (NET.started) { // A is back (or answered again): same game -> just pair again
          if (m.seed !== NET.seed) break;
          NET.partner = true; if (m.from) NET.partnerId = m.from; if (m.resume) catchUp(m.resume); clearTimeout(reconTimer); reconTimer = 0; resetReconnect(); partnerBack(other); break;
        }
        NET.partner = true; if (m.from) NET.partnerId = m.from; startOnline(m.seed, m.resume); break;
      case 'full': case 'gone': {
        if (NET.role !== 'B' || (m.to && m.to !== NET.id)) return;
        if (m.t === 'gone') { if (NET.started) { NET.bye = true; clearTimeout(reconTimer); reconTimer = 0; setBanner(fmt(UI.bannerRoomGone || '', { code: NET.code, other })); } else roomGone(); return; }
        if (NET.started) { reconDelay = RECONNECT_MAX_MS; setBanner(fmt(UI.bannerTaken || '', { code: NET.code, other })); return; } // someone else is in B's seat: knock slowly
        if (NET.keepTrying) { $('onlineMsg').textContent = fmt(UI.onlineRejoinWait || '', { code: NET.code, other }); reconDelay = Math.max(reconDelay, RECONNECT_FIRST_MS); scheduleReconnect(); return; } // coming back: the old link may still look open on A's side
        NET.on = false; clearTimeout(reconTimer); reconTimer = 0; try { if (NET.es) NET.es.close(); } catch (e) {} $('onlineMsg').textContent = UI.onlineFull || ''; return;
      }
      case 'bye': NET.bye = true; // fall through: the partner left on purpose (will not come back)
      case 'peer-left': {
        const was = NET.partner; NET.partner = false; NET.partnerId = null; players[other].gazing = false;
        if (NET.started && (was || m.t === 'bye')) {
          NET.wasAway = !NET.bye;
          setBanner(fmt(NET.bye ? UI.bannerBye : NET.role === 'A' ? UI.bannerLeftA : UI.bannerLeftB, { other, code: NET.code }));
        }
        if (NET.started) scheduleReconnect();
        else if (mode === 'relay' && NET.role === 'B' && NET.keepTrying && NET.on) netSend(joinMsg()); // relay: a seat may have freed up
        return;
      }
      default: if (!NET.started) return;
    }
    switch (m.t) {
      case 'room': players[m.who].room = m.room; G.updateMap(); G.updatePartner(); break;
      case 'dial': { const v = valves[m.i]; if (!v) break; G.setValveIdx(v, m.idx); G.setLamp(v, false); if (v.kind === 'code') v.ok = false;
        if (v.kind === 'lock') v.ok = false; const owner = G.valveOwner(v); if (owner && owner.result !== null) { owner.result = null; G.updateStatus(); } break; }
      case 'judge': { const v = valves[m.i]; if (!v) break; G.setValveIdx(v, m.idx); G.applyJudge(v, m.ok, false); break; }
      case 'code': G.puzzle.codePlayed = Math.max(G.puzzle.codePlayed, m.n || 1); G.updatePartner(); break;
      case 'thrust': { const p = players[m.who]; p.holding = !!m.holding; if (m.done) { p.thrust = true; G.updateStatus(); if (players.A.thrust && players.B.thrust) G.completeStep('thrust'); } G.updatePartner(); break; }
      case 'done': G.completeStep(m.step); break;
      case 'gaze': players[m.who].gazing = !!m.on; break;
      case 'heart': if (G.puzzle) G.puzzle.heartPlayed = (G.puzzle.heartPlayed || 0) + 1; break;
      case 'look': players[m.who].yaw = m.yaw; if (m.pitch !== undefined) players[m.who].pitch = m.pitch; if (G.onPartnerLook) G.onPartnerLook(); if (G.onPartnerMoved) G.onPartnerMoved(); break;
      case 'stamp': G.partnerStamp = { text: m.text, until: performance.now() + STAMP_SHOW_MS }; G.shownPartner = null; G.updatePartner(); G.notice(fmt(UI.noticeStamp || '{other}：「{text}」', { other, text: m.text }), true); G.haptic('tick'); break;
    }
  }
  // quick messages (定型文スタンプ) for players who cannot talk
  G.partnerStamp = null;
  function sendStamp(text) { netSend({ t: 'stamp', text }); $('stampMenu').style.display = 'none'; G.notice(fmt(UI.noticeSent, { text }), true); }
  // the lobby's first line depends on the way of connecting
  const intro = $('onlineIntro'); if (intro) intro.textContent = mode === 'peer' ? UI.onlineIntroPeer : UI.onlineIntroRelay;
  Object.assign(G, { netSend, netCreate, netJoin, netRejoin, sendStamp, savedRoom, clearRoom, leaveRoom, kickReconnect });
}
