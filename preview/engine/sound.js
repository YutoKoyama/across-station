// ---------- Sound (engine side, used by themes that list "sfx") ----------
// One-shot sounds and loops from CC0 files (decoded once audio is unlocked by a tap) + a synthesized
// air-conditioning bed (filtered noise + low mains hum). Everything goes through one master gain so pause = silence.
export async function createSound(base, files, ambience) {
  const raw = {}; // name -> [ArrayBuffer]
  await Promise.all(Object.entries(files).map(async ([k, list]) => {
    raw[k] = (await Promise.all(list.map(async f => { try { const r = await fetch(base + f); return r.ok ? await r.arrayBuffer() : null; } catch (e) { return null; } }))).filter(Boolean);
  }));
  let played = 0, ctx = null, master = null, air = null, hum = null, buf = {}, amb = null, wantAmb = null, paused = false;
  const loops = {};
  let duckK = 1; const DUCK = 0.25; // ambience level while the vibration code plays (focus on the hands)
  let volume = 1, ambOn = true; // player settings: master volume 0..1, room hum / air conditioning on or off (P16)
  const now = () => ctx.currentTime;
  const ramp = (g, v, s = 0.6) => { g.gain.cancelScheduledValues(now()); g.gain.setValueAtTime(g.gain.value, now()); g.gain.linearRampToValueAtTime(v, now() + s); };

  async function unlock(c) {
    if (ctx || !c) return; ctx = c;
    master = ctx.createGain(); master.gain.value = paused ? 0 : volume; master.connect(ctx.destination);
    // air conditioning: looping noise through a low-pass, plus a quiet 50/100 Hz hum
    const n = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = n.getChannelData(0);
    let b = 0; for (let i = 0; i < d.length; i++) { b = (b + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = b * 3.5; } // brown-ish noise
    const ns = ctx.createBufferSource(); ns.buffer = n; ns.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 520; lp.Q.value = 0.4;
    air = ctx.createGain(); air.gain.value = 0; ns.connect(lp); lp.connect(air); air.connect(master); ns.start();
    hum = ctx.createGain(); hum.gain.value = 0; hum.connect(master);
    for (const [f, v] of [[50, 1], [100, 0.5], [150, 0.15]]) { const o = ctx.createOscillator(); o.frequency.value = f; const g = ctx.createGain(); g.gain.value = v; o.connect(g); g.connect(hum); o.start(); }
    await Promise.all(Object.entries(raw).map(async ([k, list]) => {
      buf[k] = (await Promise.all(list.map(a => ctx.decodeAudioData(a.slice(0)).catch(() => null)))).filter(Boolean);
    }));
    if (wantAmb !== null) ambienceSet(wantAmb);
  }
  function play(name, o = {}) {
    if (!ctx || paused) return;
    const list = buf[name]; if (!list || !list.length) return;
    const s = ctx.createBufferSource(); s.buffer = list[Math.floor(Math.random() * list.length)];
    s.playbackRate.value = (o.rate || 1) * (1 + (Math.random() - 0.5) * (o.vary ?? 0.06)); // small variation = less robotic
    const g = ctx.createGain(); g.gain.value = o.vol ?? 0.6; s.connect(g); g.connect(master);
    const t = now() + (o.delay || 0); s.start(t); played++;
    if (o.dur) { g.gain.setValueAtTime(o.vol ?? 0.6, t + o.dur - 0.15); g.gain.linearRampToValueAtTime(0, t + o.dur); s.stop(t + o.dur + 0.02); }
  }
  function loopSrc(name) {
    const list = buf[name]; if (!list || !list.length) return null;
    const s = ctx.createBufferSource(); s.buffer = list[0]; s.loop = true; s.loopStart = 0.05; s.loopEnd = Math.max(0.1, s.buffer.duration - 0.05);
    const g = ctx.createGain(); g.gain.value = 0; s.connect(g); g.connect(master); s.start(); return { s, g };
  }
  function loop(name, on, vol = 0.4) { // e.g. the thruster while the thrust is held
    if (!ctx) return;
    if (on) { if (!loops[name]) loops[name] = loopSrc(name); if (loops[name]) ramp(loops[name].g, vol, 0.35); }
    else if (loops[name]) { const l = loops[name]; ramp(l.g, 0, 0.4); loops[name] = null; setTimeout(() => { try { l.s.stop(); } catch (e) {} }, 600); }
  }
  function ambienceSet(key) {
    wantAmb = key; if (!ctx) return;
    const A = (key && ambience[key]) || { air: 0, hum: 0 }, k = duckK * (ambOn ? 1 : 0);
    ramp(air, (A.air || 0) * k, 1.2); ramp(hum, (A.hum || 0) * k, 1.2);
    if (amb && amb.key === A.loop) { ramp(amb.g, (A.loopVol || 0) * k, 1.0); return; }
    if (amb) { const old = amb; ramp(old.g, 0, 1.0); setTimeout(() => { try { old.s.stop(); } catch (e) {} }, 1200); amb = null; }
    if (A.loop) { const l = loopSrc(A.loop); if (l) { amb = { ...l, key: A.loop }; ramp(amb.g, (A.loopVol || 0.15) * k, 1.5); } }
  }
  function duck(on) { const k = on ? DUCK : 1; if (k === duckK) return; duckK = k; if (ctx && wantAmb !== null) ambienceSet(wantAmb); }
  function pause(p) { paused = p; if (ctx) ramp(master, p ? 0 : volume, 0.25); }
  // settings: volume applies to everything (operation sounds too); ambience off stops only the room hum / air (not sfx)
  function setVolume(v) { volume = Math.max(0, Math.min(1, v)); if (ctx && !paused) ramp(master, volume, 0.15); }
  function setAmbience(on) { ambOn = !!on; if (ctx && wantAmb !== null) ambienceSet(wantAmb); }
  // a soft beep of `ms` (stands in for a vibration pulse on devices that cannot vibrate)
  function beep(ms) {
    if (!ctx || paused) return;
    const o = ctx.createOscillator(), g = ctx.createGain(), t = now(), d = ms / 1000;
    o.type = 'triangle'; o.frequency.value = 520; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.18, t + 0.01);
    g.gain.setValueAtTime(0.18, t + Math.max(0.01, d - 0.02)); g.gain.linearRampToValueAtTime(0, t + d); o.connect(g); g.connect(master); o.start(t); o.stop(t + d + 0.02);
  }
  const stats = () => ({ unlocked: !!ctx, state: ctx ? ctx.state : 'none', decoded: Object.values(buf).reduce((n, l) => n + l.length, 0), played, ambience: amb ? amb.key : null,
    volume, ambienceOn: ambOn, master: master ? +master.gain.value.toFixed(3) : null, ambienceLevel: amb ? +amb.g.gain.value.toFixed(3) : 0 });
  return { unlock, play, loop, ambience: ambienceSet, pause, duck, setVolume, setAmbience, beep, stats, get ready() { return !!ctx; } };
}
