// Same shape as the Claude "room" capability, over PeerJS (no account needed): join(code, role) -> {presence, onPeers, leave}
// A hosts the id PREFIX+code; B connects to it. Each side sends its whole presence object whenever it changes,
// and again every BEAT ms as a heartbeat.
//
// A data channel on a phone can die without a 'close' event (the tab went to the background, the network switched).
// Then one side keeps the partner's last presence forever (it "sees" the partner standing still) while the other
// sees nobody, and the host turned B's reconnect away as "a third phone". So:
//  - each side drops a connection that has been silent for DEAD ms, and B dials again;
//  - the host takes a new connection in place of one that has gone quiet (only a live one turns a newcomer away).
const PREFIX = 'yuto-seikan-tsuyaku-';
export const BEAT = 2000, DEAD = 9000, QUIET = 5000;
let libP = null;
const lib = () => libP || (libP = window.Peer ? Promise.resolve(window.Peer) : new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = './peerjs.min.js'; s.onload = () => res(window.Peer); s.onerror = () => { libP = null; rej(new Error('peerjs')); }; document.head.appendChild(s); }));
export async function peerRoom(code, role, onStatus = () => {}, opt = {}) {
  const Peer = opt.Peer || await lib(), now = opt.now || (() => Date.now());
  let mine = null, theirs = null, cb = () => {}, conn = null, peer = null, closed = false, retryT = 0, delay = 1500, heard = 0;
  const fire = () => cb([{ you: true, presence: mine }].concat(theirs ? [{ you: false, presence: theirs }] : []));
  const send = () => { try { if (conn && conn.open && mine) conn.send({ t: 'p', p: mine }); } catch (e) {} };
  const drop = (c, why) => {      // forget a connection: the partner is gone until they are heard again
    if (conn !== c) return; conn = null; theirs = null; fire(); onStatus(why || 'lost');
    try { c.close(); } catch (e) {}
    if (role === 'B') again();
  };
  const attach = c => {
    c.on('open', () => { if (conn !== c) return; delay = 1500; heard = now(); onStatus('open'); send(); });
    c.on('data', m => {
      if (conn !== c) return; heard = now();
      if (m && m.t === 'full' && role === 'B') { onStatus('full'); return; }
      if (m && m.t === 'p' && m.p && typeof m.p === 'object' && (m.p.role === 'A' || m.p.role === 'B') && m.p.role !== role) { theirs = m.p; fire(); } });
    c.on('close', () => drop(c));
    c.on('error', () => {});
  };
  const again = () => { if (closed) return; clearTimeout(retryT); retryT = setTimeout(start, delay); delay = Math.min(delay * 1.6, 12000); };
  function start() {
    if (closed) return;
    if (role === 'A') {
      if (peer && !peer.destroyed) { if (peer.disconnected) try { peer.reconnect(); } catch (e) {} return; }
      peer = new Peer(PREFIX + code, { debug: 0 });
      peer.on('open', () => onStatus('host'));
      peer.on('connection', c => {
        if (conn && conn.open && now() - heard < QUIET) {      // a live partner is here: a third phone is turned away
          c.on('open', () => { try { c.send({ t: 'full' }); } catch (e) {} setTimeout(() => { try { c.close(); } catch (e) {} }, 300); }); return; }
        const old = conn; conn = c; heard = now(); attach(c);   // B came back (the old line had gone quiet): the new one replaces it
        if (old) try { old.close(); } catch (e) {}
      });
      peer.on('disconnected', again);
      peer.on('error', e => { if (e && e.type === 'unavailable-id') { try { peer.destroy(); } catch (x) {} peer = null; onStatus('busy'); again(); } else if (e && (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error')) again(); });
    } else {
      const go = () => { if (closed || conn) return; const c = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' }); conn = c; attach(c);
        setTimeout(() => { if (conn === c && !c.open) { conn = null; try { c.close(); } catch (e) {} again(); } }, 8000); };
      if (!peer || peer.destroyed) { peer = new Peer(undefined, { debug: 0 }); peer.on('open', go); peer.on('disconnected', again);
        peer.on('error', e => { if (e && e.type === 'peer-unavailable') onStatus('noroom'); conn = null; again(); }); }
      else if (peer.disconnected) { try { peer.reconnect(); } catch (e) {} again(); }
      else go();
    }
  }
  // heartbeat: send our presence, and drop a line that has been silent too long
  const beat = () => { if (closed) return; if (conn && conn.open && now() - heard > DEAD) { drop(conn, 'lost'); return; } send(); };
  const wake = () => { if (closed) return; delay = 1500;
    if (conn && conn.open && now() - heard > QUIET) drop(conn, 'lost');      // back from the background: a quiet line is probably dead
    else if (!conn) start(); else send(); };
  start();
  const iv = setInterval(beat, BEAT);
  const onOnline = () => wake(), onVis = () => { if (!document.hidden) wake(); };
  addEventListener('online', onOnline); document.addEventListener('visibilitychange', onVis);
  return { presence(p) { mine = p; send(); fire(); }, onPeers(f) { cb = f; fire(); }, emit() {}, on() {},
    _tick: beat, _wake: wake,
    leave() { closed = true; clearInterval(iv); clearTimeout(retryT); removeEventListener('online', onOnline); document.removeEventListener('visibilitychange', onVis);
      try { conn && conn.close(); } catch (e) {} try { peer && peer.destroy(); } catch (e) {} } };
}
