// Same shape as the Claude "room" capability, over PeerJS (no account needed): join(code, role) -> {presence, onPeers, leave}
// A hosts the id PREFIX+code; B connects to it. Each side sends its whole presence object whenever it changes.
const PREFIX = 'yuto-seikan-tsuyaku-';
let libP = null;
const lib = () => libP || (libP = window.Peer ? Promise.resolve(window.Peer) : new Promise((res, rej) => {
  const s = document.createElement('script'); s.src = './peerjs.min.js'; s.onload = () => res(window.Peer); s.onerror = () => { libP = null; rej(new Error('peerjs')); }; document.head.appendChild(s); }));
export async function peerRoom(code, role, onStatus = () => {}) {
  const Peer = await lib();
  let mine = null, theirs = null, cb = () => {}, conn = null, peer = null, closed = false, retryT = 0, delay = 1500;
  const fire = () => cb([{ you: true, presence: mine }].concat(theirs ? [{ you: false, presence: theirs }] : []));
  const send = () => { try { if (conn && conn.open && mine) conn.send({ t: 'p', p: mine }); } catch (e) {} };
  const attach = c => {
    c.on('open', () => { delay = 1500; onStatus('open'); send(); });
    c.on('data', m => { if (m && m.t === 'p' && m.p && typeof m.p === 'object' && (m.p.role === 'A' || m.p.role === 'B') && m.p.role !== role) { theirs = m.p; fire(); } });
    c.on('close', () => { if (conn === c) { conn = null; theirs = null; fire(); onStatus('lost'); if (role === 'B') again(); } });
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
        if (conn && conn.open) { c.on('open', () => { try { c.send({ t: 'full' }); } catch (e) {} setTimeout(() => c.close(), 300); }); return; }   // a third phone is turned away
        conn = c; attach(c); });
      peer.on('disconnected', again);
      peer.on('error', e => { if (e && e.type === 'unavailable-id') { try { peer.destroy(); } catch (x) {} peer = null; onStatus('busy'); again(); } else if (e && (e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error')) again(); });
    } else {
      const go = () => { if (closed || (conn && conn.open)) return; const c = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' }); conn = c; attach(c);
        setTimeout(() => { if (conn === c && !c.open) { try { c.close(); } catch (e) {} conn = null; again(); } }, 8000); };
      if (!peer || peer.destroyed) { peer = new Peer(undefined, { debug: 0 }); peer.on('open', go); peer.on('disconnected', again);
        peer.on('error', e => { if (e && e.type === 'peer-unavailable') onStatus('noroom'); conn = null; again(); }); }
      else if (peer.disconnected) { try { peer.reconnect(); } catch (e) {} again(); }
      else go();
    }
  }
  start();
  addEventListener('online', () => { delay = 1500; start(); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { delay = 1500; if (!(conn && conn.open)) start(); } });
  setInterval(send, 4000);   // keep the partner's copy fresh even if a message was lost
  return { presence(p) { mine = p; send(); fire(); }, onPeers(f) { cb = f; fire(); }, emit() {}, on() {}, leave() { closed = true; try { conn && conn.close(); } catch (e) {} try { peer && peer.destroy(); } catch (e) {} } };
}
