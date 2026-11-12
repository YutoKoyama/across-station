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
  const { $, fmt, UI, players, valves } = G;
  const asked = new URLSearchParams(location.search || '').get('net');
  const mode = asked === 'peer' || asked === 'relay' ? asked : (!G.native && location.protocol === 'https:' ? 'peer' : 'relay');
  const NET = G.NET = { on: false, mode, base: location.port === '8787' ? location.origin : 'http://localhost:8787', code: null, role: null,
    id: Math.random().toString(36).slice(2, 8), es: null, partner: false, seed: null, started: false };

  // ---- relay transport (PC) ----
  const relay = {
    connect(code) {
      NET.es = new EventSource(`${NET.base}/room/${code}/events?id=${NET.id}`);
      NET.es.onmessage = e => { try { onNet(JSON.parse(e.data)); } catch (err) { console.warn('net', err); } };
      NET.es.onerror = () => { $('onlineMsg').textContent = UI.onlineRelayDown; };
    },
    async create() { const r = await fetch(`${NET.base}/room/new`); const { code } = await r.json(); return code; },
    async join(code) { netSend({ t: 'join' }); },
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
    c.on('data', d => { try { onNet(typeof d === 'string' ? JSON.parse(d) : d); } catch (err) { console.warn('net', err); } });
    c.on('close', () => onNet({ t: 'peer-left' }));
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
          peer.on('connection', c => { attach(c); c.on('open', () => onNet({ t: 'peer-joined' })); });
          peer.on('error', () => { if (!NET.partner) $('onlineMsg').textContent = UI.onlineNoBroker; });
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
  function startOnline(seed) {
    if (NET.started) return; NET.started = true;
    G.newPuzzle(seed);
    G.showPlayer(NET.role, false);
    $('btnPlayer').style.display = 'none'; $('btnStamp').style.display = 'block';
    G.startGame();
  }
  function onNet(m) {
    const other = NET.role === 'A' ? 'B' : 'A';
    switch (m.t) {
      case 'join': case 'peer-joined':
        NET.partner = true;
        if (NET.role === 'A') { netSend({ t: 'init', seed: NET.seed }); startOnline(NET.seed); }
        break;
      case 'init': if (NET.role === 'B') { NET.partner = true; startOnline(m.seed); } break;
      case 'peer-left': NET.partner = false; G.notice(fmt(UI.noticePeerLeft, { other })); break;
      default: if (!NET.started) return;
    }
    switch (m.t) {
      case 'room': players[m.who].room = m.room; G.updateMap(); G.updatePartner(); break;
      case 'dial': { const v = valves[m.i]; if (!v) break; G.setValveIdx(v, m.idx); G.setLamp(v, false); if (v.kind === 'code') v.ok = false;
        const owner = G.valveOwner(v); if (owner && owner.result !== null) { owner.result = null; G.updateStatus(); } break; }
      case 'judge': { const v = valves[m.i]; if (!v) break; G.setValveIdx(v, m.idx); G.applyJudge(v, m.ok, false); break; }
      case 'code': G.puzzle.codePlayed = Math.max(G.puzzle.codePlayed, m.n || 1); G.updatePartner(); break;
      case 'thrust': { const p = players[m.who]; p.holding = !!m.holding; if (m.done) { p.thrust = true; G.updateStatus(); if (players.A.thrust && players.B.thrust) G.completeStep('thrust'); } G.updatePartner(); break; }
      case 'look': players[m.who].yaw = m.yaw; if (m.pitch !== undefined) players[m.who].pitch = m.pitch; if (G.onPartnerLook) G.onPartnerLook(); if (G.onPartnerMoved) G.onPartnerMoved(); break;
      case 'stamp': G.partnerStamp = { text: m.text, until: performance.now() + STAMP_SHOW_MS }; G.shownPartner = null; G.updatePartner(); G.haptic('tick'); break;
    }
  }
  // quick messages (定型文スタンプ) for players who cannot talk
  G.partnerStamp = null;
  function sendStamp(text) { netSend({ t: 'stamp', text }); $('stampMenu').style.display = 'none'; G.notice(fmt(UI.noticeSent, { text }), true); }
  // the lobby's first line depends on the way of connecting
  const intro = $('onlineIntro'); if (intro) intro.textContent = mode === 'peer' ? UI.onlineIntroPeer : UI.onlineIntroRelay;
  Object.assign(G, { netSend, netCreate, netJoin, sendStamp });
}
