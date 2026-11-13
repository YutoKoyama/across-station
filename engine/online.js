// ---------- online co-op (⑦) ----------
// Two ways to connect, same game messages:
//   peer  (web, https e.g. GitHub Pages): PeerJS. The free public PeerJS broker only introduces the two players
//         (no account); the game messages then go directly between the two browsers (WebRTC).
//   relay (phone app / local tests): tools/relay_server.mjs on the PC, reached over USB (adb reverse) or http://localhost:8787
// Choice: ?net=peer|relay in the URL, else peer on an https page outside the app, relay otherwise.
const STAMP_SHOW_MS = 8000;
const PEER_PREFIX = 'yuto-across-ss-'; // + the 4-digit room code = the host's id at the broker
const JOIN_TIMEOUT_MS = 15000, CODE_TRIES = 5;

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
    async join(code) { if (NET.esOpen) await NET.esOpen; netSend({ t: 'join' }); },
    send(msg) { fetch(`${NET.base}/room/${NET.code}/send?id=${NET.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(msg) }).catch(() => {}); },
  };
  // ---- peer transport (PeerJS, internet) ----
  async function peerLib() {
    if (window.Peer) return window.Peer;
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/peerjs.min.js'; s.onload = res; s.onerror = () => rej(new Error('peerjs')); document.head.appendChild(s); });
    return window.Peer;
  }
  const peerOpts = () => Object.assign({ debug: 1 }, window.__PEER_OPTS__ || {});
  let peer = null, conn = null;
  function attach(c) {
    conn = c;
    c.on('data', d => { if (conn !== c) return; try { onNet(typeof d === 'string' ? JSON.parse(d) : d); } catch (err) { console.warn('net', err); } });
    c.on('close', () => { if (conn === c) onNet({ t: 'peer-left' }); });
  }
  const peerT = {
    async create() {
      const Peer = await peerLib();
      for (let i = 0; i < CODE_TRIES; i++) {
        const code = String(1000 + Math.floor(Math.random() * 9000));
        const res = await new Promise(done => {
          peer = new Peer(PEER_PREFIX + code, peerOpts());
          peer.on('open', () => done(true));
          peer.on('error', e => done(e && e.type === 'unavailable-id' ? false : e));
        });
        if (res === true) {
          peer.on('connection', c => {
            // only 2 players: while the partner's connection is alive, any further connection is turned away (review 1 M4)
            if (conn && conn.open && NET.partner) { c.on('open', () => { try { c.send({ t: 'full' }); } catch (e) {} setTimeout(() => { try { c.close(); } catch (e) {} }, 300); }); return; }
            attach(c); c.on('open', () => onNet({ t: 'peer-joined' }));
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
      throw new Error('no free room code');
    },
    async join(code) {
      const Peer = await peerLib();
      peer = new Peer(undefined, peerOpts());
      await new Promise((res, rej) => { peer.on('open', res); peer.on('error', rej); });
      const c = peer.connect(PEER_PREFIX + code, { reliable: true, serialization: 'json' });
      attach(c);
      await new Promise((res, rej) => {
        const t = setTimeout(() => rej(new Error('timeout')), JOIN_TIMEOUT_MS);
        c.on('open', () => { clearTimeout(t); res(); });
        peer.on('error', e => { clearTimeout(t); rej(e); });
      });
      c.send({ t: 'join' });
    },
    send(msg) { if (conn && conn.open) conn.send(msg); },
  };
  const tr = mode === 'peer' ? peerT : relay;

  function netSend(msg) { if (NET.on) tr.send(msg); }
  async function netCreate() { // player A makes a room and decides the puzzle
    NET.seed = Math.floor(Math.random() * 2 ** 31);
    const code = await tr.create();
    Object.assign(NET, { on: true, code, role: 'A' });
    if (mode === 'relay') relay.connect(code);
    $('onlineMsg').textContent = fmt(UI.onlineWaiting, { code });
    return code;
  }
  async function netJoin(code) {
    Object.assign(NET, { on: true, code, role: 'B' });
    $('onlineMsg').textContent = fmt(UI.onlineJoining, { code });
    if (mode === 'relay') relay.connect(code);
    try { await tr.join(code); }
    catch (e) { NET.on = false; $('onlineMsg').textContent = e && e.type === 'peer-unavailable' ? UI.onlineNoRoom : UI.onlineNoBroker; }
  }
  function startOnline(seed, resume) {
    if (NET.started) return; NET.started = true;
    G.newPuzzle(seed);
    if (resume) applyResume(resume);
    G.showPlayer(NET.role, false);
    $('btnPlayer').style.display = 'none'; $('btnStamp').style.display = 'block';
    G.startGame();
    if (resume) { netSend({ t: 'room', who: NET.role, room: players[NET.role].room }); G.notice(UI.noticeResumed || '', true); }
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
      case 'init': return Number.isInteger(m.seed);
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
        if (NET.role !== 'A') break;
        NET.partner = true; if (from) NET.partnerId = from;
        if (NET.started) netSend({ t: 'init', seed: NET.seed, resume: snapshot(), to: from || undefined }); // B came back: continue from here
        else { netSend({ t: 'init', seed: NET.seed, to: from || undefined }); startOnline(NET.seed); }
        break;
      case 'init': if (NET.role === 'B' && (!m.to || m.to === NET.id)) { NET.partner = true; if (m.from) NET.partnerId = m.from; startOnline(m.seed, m.resume); } break;
      case 'full': if (NET.role === 'B' && !NET.started && (!m.to || m.to === NET.id)) { NET.on = false; try { if (NET.es) NET.es.close(); } catch (e) {} $('onlineMsg').textContent = UI.onlineFull || ''; } return;
      case 'peer-left': NET.partner = false; NET.partnerId = null; players[other].gazing = false; if (NET.started) G.notice(fmt((NET.role === 'A' ? UI.noticePeerLeftA : UI.noticePeerLeftB) || UI.noticePeerLeft, { other, code: NET.code })); break;
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
  Object.assign(G, { netSend, netCreate, netJoin, sendStamp });
}
