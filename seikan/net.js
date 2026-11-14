// Two phones in one "room" (Claude artifact room capability). Everything travels in presence:
// each player publishes {role, name, scene, x, z, ry, acts:[...]} and the host (A) also publishes the whole game state.
// Presence works for every viewer, and a newcomer gets it at once, so a reload or a late join just resyncs.
import { apply } from './logic.js';
import { peerRoom } from './peerroom.js';

export function makeNet(onChange) {
  const N = { mode: 'off', role: 'A', code: '', room: null, peers: [], state: null, partner: null, seq: 0, acts: [], lastSeen: 0, me: {}, solo: false };
  let pushT = 0, lastPush = 0, roomApi = null;
  const publish = (force) => {
    if (!N.room) return; const now = performance.now();
    if (!force && now - lastPush < 160) { clearTimeout(pushT); pushT = setTimeout(() => publish(true), 170); return; }
    lastPush = now;
    const p = { role: N.role, name: N.me.name || '', scene: N.me.scene || '', x: +(N.me.x || 0).toFixed(2), z: +(N.me.z || 0).toFixed(2), ry: +(N.me.ry || 0).toFixed(2), acts: N.acts.slice(-12) };
    if (N.role === 'A' && N.state) p.state = N.state;
    try { N.room.presence(p); } catch (e) {}
  };
  const handlePeers = list => {
    N.peers = list || [];
    const others = N.peers.filter(p => !p.you && p.presence && p.presence.role).map(p => p.presence);
    N.partner = others.find(p => p.role !== N.role) || null;
    if (N.role === 'B') { const host = others.find(p => p.role === 'A' && p.state); if (host && (!N.state || host.state.v !== N.state.v || host.state.seed !== N.state.seed)) N.state = host.state; }
    if (N.role === 'A' && N.partner && N.state) {
      let changed = false;
      for (const a of (N.partner.acts || [])) if (a.n > N.lastSeen) { N.lastSeen = a.n; if (apply(N.state, a)) changed = true; }
      if (changed) publish(true);
    }
    onChange();
  };
  N.available = async () => { try { roomApi = roomApi || await Promise.race([window.claude?.use?.('room'), new Promise(r => setTimeout(() => r(null), 10000))]); } catch (e) { roomApi = null; } return !!roomApi; };
  N.status = '';
  N.join = async (code, role) => {
    N.code = code; N.role = role;
    if (window.claude && (await N.available())) { N.mode = 'room'; N.room = roomApi.join('stk-' + code); }
    else { N.mode = 'peer'; N.room = await peerRoom(code, role, st => { N.status = st; onChange(); }); }
    N.room.onPeers(handlePeers);
    publish(true);
  };
  N.leave = () => { try { N.room && N.room.leave(); } catch (e) {} N.room = null; N.mode = 'off'; };
  N.startSolo = () => { N.mode = 'solo'; N.solo = true; N.role = 'A'; };
  // an action: the host applies it at once; B sends it through its presence
  N.act = a => {
    a = { ...a, role: a.role || N.role, n: Date.now() * 100 + (++N.seq % 100) };
    if (N.role === 'A' || N.solo) { if (N.state && apply(N.state, a)) publish(true); onChange(); return; }
    N.acts.push(a); publish(true); onChange();
  };
  N.setState = s => { N.state = s; publish(true); onChange(); };
  N.publish = () => publish(true);
  N.move = (scene, x, z, ry) => { const m = N.me; if (m.scene === scene && Math.abs(m.x - x) < 0.05 && Math.abs(m.z - z) < 0.05 && Math.abs(m.ry - ry) < 0.05) return; Object.assign(m, { scene, x, z, ry }); publish(false); };
  N.setName = n => { N.me.name = n; publish(true); };
  return N;
}
