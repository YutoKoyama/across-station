// ---------- first-play guide: points at each part of the screen in turn and says what it is ----------
// Shown once per phone when play starts (saved in localStorage); the "?" key shows it again at any time.
// The steps (target element + text) come from the pack: text.guide = [{ target, text }, ...]; target may be empty (no frame).
const DONE_KEY = 'ss_guide_done';

export function installGuide(G) {
  const { $, T, UI } = G;
  const steps = (T.guide || []).filter(s => s && s.text);
  if (!steps.length || !document.body.appendChild) { G.showGuide = () => {}; return; }
  const box = document.createElement('div'); box.id = 'guide';
  box.innerHTML = `<div id="guideRing"></div><div id="guideCard"><div id="guideCount"></div><div id="guideText"></div>
    <div class="row"><button id="guideSkip"></button><button id="guideNext"></button></div></div>`;
  document.body.appendChild(box);
  const help = document.createElement('button'); help.id = 'btnHelp'; help.className = 'roundBtn'; help.setAttribute('aria-label', UI.guideHelp || '画面の説明');
  help.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="square"><path d="M9 9.2a3 3 0 1 1 4.2 2.8c-.8.4-1.2 1-1.2 1.8v.7"/><path d="M12 17.2v.3"/></svg>';
  document.body.appendChild(help);
  let i = 0;
  function place() {
    const s = steps[i], ring = $('guideRing'), card = $('guideCard');
    // target: one id, or several ids separated by commas (the frame goes around all the visible ones)
    const vis = el => { try { return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'; } catch (e) { return false; } };
    const els = String(s.target || '').split(',').map(t => $(t.trim())).filter(vis);
    $('guideCount').textContent = `${i + 1} / ${steps.length}`;
    $('guideText').textContent = G.clean ? G.clean(s.text) : s.text;
    $('guideNext').textContent = i === steps.length - 1 ? (UI.guideDone || 'はじめよう') : (UI.guideNext || '次へ');
    $('guideSkip').textContent = UI.guideSkip || 'とばす';
    $('guideSkip').style.visibility = i === steps.length - 1 ? 'hidden' : 'visible';
    // a frame around the part being explained (not while the page is turned back to portrait: screen and page coordinates differ)
    if (els.length && !G.rot) {
      const rs = els.map(e => e.getBoundingClientRect()), pad = 6;
      const r = { left: Math.min(...rs.map(x => x.left)), top: Math.min(...rs.map(x => x.top)), right: Math.max(...rs.map(x => x.right)), bottom: Math.max(...rs.map(x => x.bottom)) };
      r.width = r.right - r.left; r.height = r.bottom - r.top;
      Object.assign(ring.style, { display: 'block', left: (r.left - pad) + 'px', top: (r.top - pad) + 'px', width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px' });
      const mid = r.top + r.height / 2, H = G.viewH();
      card.style.top = mid < H * 0.5 ? Math.min(H - 220, r.bottom + 18) + 'px' : '';
      card.style.bottom = mid < H * 0.5 ? '' : Math.max(16, H - r.top + 18) + 'px';
    } else { ring.style.display = 'none'; card.style.top = ''; card.style.bottom = '38%'; }
  }
  function showGuide() { i = 0; box.style.display = 'block'; place(); }
  function close() { box.style.display = 'none'; try { localStorage.setItem(DONE_KEY, '1'); } catch (e) {} }
  $('guideNext').onclick = () => { if (i >= steps.length - 1) close(); else { i++; place(); } };
  $('guideSkip').onclick = close;
  help.onclick = showGuide;
  if (typeof addEventListener === 'function') addEventListener('resize', () => { if (box.style.display === 'block') setTimeout(place, 80); });
  G.showGuide = showGuide;
  G.maybeGuide = () => { let done = false; try { done = localStorage.getItem(DONE_KEY) === '1'; } catch (e) {} if (!done && !G.testMode) setTimeout(showGuide, 700); };
}
