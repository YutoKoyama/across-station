// ---------- platform: phone app (Capacitor) or web browser ----------
// The same www/ runs in the Android app and in a phone's browser (GitHub Pages). When Capacitor is not there,
// the engine falls back to web-standard APIs on its own:
//   vibration  Capacitor Haptics -> navigator.vibrate (Android Chrome) -> none (iPhone Safari): flash + beep instead
//   tilt       iPhone Safari asks first: DeviceOrientationEvent.requestPermission() inside a tap
//   screen on  the app keeps it on natively; the web asks the Wake Lock API while playing
export function installPlatform(G) {
  const cap = window.Capacitor;
  G.native = !!(cap && (typeof cap.isNativePlatform === 'function' ? cap.isNativePlatform() : (cap.platform && cap.platform !== 'web')));
  G.publicWeb = !!window.__PUBLIC_WEB__; // set only in the published web build (tools/build_web.mjs): test hooks off
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const webVibrate = typeof nav.vibrate === 'function';
  G.canVibrate = !!G.P.Haptics || webVibrate;
  // one vibration pulse; false = this device cannot vibrate (the caller shows / sounds it instead)
  G.vibrate = ms => {
    if (G.P.Haptics) { try { G.P.Haptics.vibrate({ duration: ms }); return true; } catch (e) {} }
    if (webVibrate) { try { return nav.vibrate(ms) !== false; } catch (e) {} }
    return false;
  };
  // iPhone Safari: the tilt sensor needs a permission asked from inside a tap (start / create room / join)
  G.sensorPermission = 'not-needed';
  G.askSensorPermission = async () => {
    const D = window.DeviceOrientationEvent;
    if (!D || typeof D.requestPermission !== 'function' || G.sensorPermission === 'granted') return G.sensorPermission;
    try { G.sensorPermission = await D.requestPermission(); } catch (e) { G.sensorPermission = 'denied'; }
    return G.sensorPermission;
  };
  // keep the screen on while playing (web only; re-asked when the page comes back to the front)
  let lock = null, wanted = false;
  G.keepAwake = async () => {
    wanted = true;
    if (G.native || !nav.wakeLock) return;
    try { lock = await nav.wakeLock.request('screen'); } catch (e) {}
  };
  if (document.addEventListener) document.addEventListener('visibilitychange', () => { if (!document.hidden && wanted && lock !== null) G.keepAwake(); });

  // ---------- portrait only (2026-11-12) ----------
  // Turning the phone like a steering wheel (the dials) made the browser flip the page to landscape.
  // 1) Android Chrome: a tap asks for full screen and then locks the screen to portrait (the browser allows the lock only in full screen).
  // 2) Anywhere the lock is not possible (iPhone Safari, lock refused): when the browser turns the page to landscape, the whole page
  //    (3D view + UI) is turned back by CSS so it stays portrait on the phone, and the sensor math treats the screen as portrait.
  const mm = q => { try { return !!(window.matchMedia && window.matchMedia(q).matches); } catch (e) { return false; } };
  G.phoneWeb = !G.native && mm('(pointer: coarse)');
  G.rot = 0; // 0 / 90 / 270: how far the browser has turned the page (only while we turn it back)
  const SO = () => (typeof screen !== 'undefined' && screen.orientation) || null;
  const angle = () => { const so = SO(); const a = (so && so.angle) ?? window.orientation ?? 0; return ((+a % 360) + 360) % 360 || 0; };
  G.viewW = () => G.rot ? innerHeight : innerWidth;
  G.viewH = () => G.rot ? innerWidth : innerHeight;
  G.screenAngle = () => G.rot ? 0 : angle(); // for the tilt sensor: the page we show is always portrait while turned back
  G.toContentDelta = (dx, dy) => G.rot === 90 ? [-dy, dx] : G.rot === 270 ? [dy, -dx] : [dx, dy];
  function keepPortrait() {
    const a = angle(), b = document.body; if (!b || !b.style) return;
    G.rot = G.phoneWeb && (a === 90 || a === 270) ? a : 0;
    try { document.documentElement.dataset.rot = String(G.rot); } catch (e) {}
    if (G.rot) {
      Object.assign(b.style, { width: innerHeight + 'px', height: innerWidth + 'px', transformOrigin: '0 0',
        transform: G.rot === 90 ? 'rotate(-90deg) translateX(-100%)' : 'rotate(90deg) translateY(-100%)' });
    } else Object.assign(b.style, { width: '', height: '', transformOrigin: '', transform: '' });
  }
  G.keepPortrait = keepPortrait;
  if (typeof addEventListener === 'function') {
  addEventListener('resize', keepPortrait); // registered before the renderer's resize handler, so it sees the new G.rot
  addEventListener('orientationchange', () => { keepPortrait(); setTimeout(() => dispatchEvent(new Event('resize')), 250); });
  }
  keepPortrait();
  G.lockPortrait = () => { // call inside a tap
    if (G.native || !G.phoneWeb) return;
    const el = document.documentElement, so = SO();
    if (!so || typeof so.lock !== 'function') return;
    const lock = () => so.lock('portrait').catch(() => {});
    if (document.fullscreenElement) { lock(); return; }
    if (el.requestFullscreen) el.requestFullscreen({ navigationUI: 'hide' }).then(lock).catch(() => {});
  };
}
