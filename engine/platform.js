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
}
