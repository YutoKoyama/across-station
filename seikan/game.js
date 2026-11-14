import { THREE, renderer, orbitCam, tagger, C, glow, put } from './kit.js';
import * as plaza from './plaza.js';
import * as rooms from './rooms.js';
import { controls } from './move.js';
import * as L from './logic.js';
import { makeNet } from './net.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const frame = $('frame');
const NAMES = { title: '星間通訳局', office: '執務室', plaza: '中央広場', kousin: '交信室', bunki: '分岐路', kaigi0: '和平会議の練習', kaigi: '和平会議' };
const JOBSUB = { kousin: '言葉を訳す', bunki: 'うそを見抜く', kaigi: '怒らせずに訳す' };
const ROLE = { A: { col: C.amber, css: 'var(--amber)' }, B: { col: C.teal, css: 'var(--teal)' } };
const MINE = 'あなただけに見える', TELL = '声で伝える';
const card = (kind, label, body) => `<div class="card ${kind}">${label ? `<small>${label}</small>` : ''}${body}</div>`;
const rows = list => list.map((x, i) => `<div class="rowline"><b>${i + 1}</b><span>${x}</span></div>`).join('');

// ---------------------------------------------------------------- layout: always landscape, full screen
// shrink a box's content (not below min) until it fits its space, so nothing is ever cut off
// Buttons are given min-height 44px / zoom (--bz), so after the shrink they are still 44px on the screen. A few passes, because bigger buttons shrink it a bit more.
function shrink(el, availW, availH, min = 0.9) {
  if (!el) return 1; el.style.setProperty('--bz', 1); let z = 1;
  for (let i = 0; i < 4; i++) { el.style.zoom = 1;
    const w = el.scrollWidth, h = el.scrollHeight; if (!w || !h) return 1;
    const z2 = Math.max(min, Math.min(1, availW / w, availH / h)); if (Math.abs(z2 - z) < 0.004 && i) break; z = z2; el.style.setProperty('--bz', (1 / z).toFixed(3)); }
  el.style.zoom = z < 0.995 ? z.toFixed(3) : 1; if (z >= 0.995) el.style.setProperty('--bz', 1); return z;
}
function fitAll() {
  if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && frame.classList.contains('working')) return;   // the keyboard is up: keep the layout, let it scroll
  const W = frame.clientWidth, H = frame.clientHeight, tb = $('topbar');
  if (tb.offsetParent) { tb.style.zoom = 1; const avail = tb.clientWidth; const need = [...tb.children].reduce((a, c) => a + (c.id === 'goal' ? 210 : c.scrollWidth) + 8, 0);
    const tz = need > avail ? Math.max(0.9, avail / need) : 1; tb.style.zoom = tz < 0.995 ? tz.toFixed(3) : 1; tb.style.setProperty('--bz', (1 / tz).toFixed(3)); }
  if (tb.offsetParent) { const r = tb.getBoundingClientRect(); frame.style.setProperty('--wt', Math.round((window.__rotated ? r.width : r.height) + 12) + 'px'); }
  for (const id of ['wl', 'wr']) { const pane = $(id), f = pane.firstElementChild; if (pane.offsetParent && f) shrink(f, pane.clientWidth, pane.clientHeight - 2); }
  const eb = $('endbody'); if (eb.offsetParent && eb.firstElementChild) shrink(eb.firstElementChild, eb.clientWidth, eb.clientHeight - 2, 0.9);
  const lb = $('lobby'); if (lb.offsetParent) { lb.style.setProperty('--bz', 1); let z = 1;
    for (let i = 0; i < 3; i++) { lb.style.zoom = 1; z = Math.max(0.6, Math.min(1, (H - 16) / lb.offsetHeight, (W * 0.52) / lb.offsetWidth)); lb.style.setProperty('--bz', (1 / z).toFixed(3)); }
    lb.style.zoom = z < 0.995 ? z.toFixed(3) : 1; if (z >= 0.995) lb.style.setProperty('--bz', 1); }
  const lg = $('logo'); if (lg.offsetParent) { lg.style.zoom = 1; const lbr = lb.getBoundingClientRect(), lgr = lg.getBoundingClientRect(), room = (window.__rotated ? lbr.top - lgr.top : lbr.left - lgr.left) - 14; const z = Math.min(1, room / lg.scrollWidth); lg.style.zoom = z < 0.995 ? z.toFixed(3) : 1; }
  const bx = $('brief').querySelector('.box'); if (bx && $('brief').classList.contains('on')) shrink(bx, W * 0.92, H - 16, 0.6);
  const st = $('intro').querySelector('.stage'); if ($('intro').classList.contains('on')) { const it = $('intro'); it.style.zoom = 1; let z = 1;
    for (let i = 0; i < 3; i++) { const extra = Math.max(0, 46 / z - 46); z = Math.min(1, (H - 8) / (380 + extra), (W - 16) / 520); }
    it.style.setProperty('--iz', z.toFixed(3)); it.style.zoom = z < 0.995 ? z.toFixed(3) : 1; }
}
function layout() {
  const vw = innerWidth, vh = innerHeight, up = vh > vw; window.__rotated = up;
  const W = up ? vh : vw, H = up ? vw : vh;
  Object.assign(frame.style, { width: W + 'px', height: H + 'px', transformOrigin: '0 0', transform: up ? `translate(${vw}px,0) rotate(90deg)` : 'none' });
  frame.classList.toggle('rot', up); frame.classList.toggle('compact', H < 400 || W < 700);
  size(); requestAnimationFrame(fitAll);
}
document.addEventListener('touchmove', e => { if (!e.target.closest('.pane,#endbody')) e.preventDefault(); }, { passive: false });

// ---------------------------------------------------------------- 3D
const R = renderer($('c'));
const cam = new THREE.PerspectiveCamera(48, 844 / 390, 0.1, 500);
let S = null, sc = null, sceneName = '', tags = () => {}, marker = null, workSince = 0;
const view = orbitCam(frame, cam, { yaw: 0, pitch: 0.3, dist: 10, target: new THREE.Vector3(), look: new THREE.Vector3() });
function size() { const w = frame.clientWidth, h = frame.clientHeight; if (!w) return; R.setSize(w, h, false); cam.aspect = w / h; cam.clearViewOffset(); if (sceneName === 'title') cam.setViewOffset(w, h, w * 0.2, -h * 0.16, w, h); cam.updateProjectionMatrix(); }
addEventListener('resize', layout);
function disposeScene(s) { if (!s) return; s.traverse(o => { o.geometry?.dispose?.(); const m = o.material; if (m) (Array.isArray(m) ? m : [m]).forEach(x => x.dispose?.()); }); }
function loadScene(name, from) {
  disposeScene(S); S = new THREE.Scene(); sceneName = name; marker = null;
  sc = name === 'title' ? plaza.build(S, { title: true }) : name === 'plaza' ? plaza.build(S) : name === 'office' ? rooms.office(S, { col: ROLE[net.role].col }) : rooms[name](S);
  if (net.role === 'B' && sc.other) [sc.player, sc.other] = [sc.other, sc.player];
  if (sc.other) sc.other.visible = false;
  Object.assign(view, { yaw: sc.cam.yaw, pitch: sc.cam.pitch, dist: sc.cam.dist }); view.target.copy(sc.cam.target); view.look.copy(sc.cam.look || new THREE.Vector3());
  if (name === 'plaza') {
    const j = plaza.JOBS.find(j => j.key === from);
    if (j) { const r = 14.2; sc.player.position.set(Math.cos(j.ang) * r, 0.16, Math.sin(j.ang) * r); sc.player.userData.y = undefined;
      sc.player.rotation.y = Math.atan2(-Math.cos(j.ang), -Math.sin(j.ang)); view.yaw = Math.atan2(Math.cos(j.ang), Math.sin(j.ang)); view.pitch = 0.32; }
    // a bouncing arrow and a ring of light over the entrance of the next job: "go here"
    marker = new THREE.Group(); S.add(marker);
    const cone = put(marker, new THREE.ConeGeometry(0.7, 1.3, 24), glow('#ffcf7a', 2.2), 0, 4.2, 0, false); cone.rotation.x = Math.PI; marker.userData.cone = cone;
    put(marker, new THREE.TorusGeometry(1.9, 0.09, 10, 64), glow('#ffcf7a', 2), 0, 0.3, 0, false).rotation.x = Math.PI / 2;
    marker.add(new THREE.PointLight('#ffcf7a', 5, 9, 2)); marker.children[2].position.y = 2;
  }
  tags = tagger(frame, cam, sc.tags || []);
  frame.classList.toggle('title', name === 'title'); frame.classList.toggle('nomove', !sc.player);
  local.walk0 = sc.player ? sc.player.position.clone() : null; local.sceneAt = performance.now();
  size(); render(true);
}
window.__goScene = name => { if (name === 'office' && net.state && net.state.tut.step === 0 && !local.introSeen) playIntro(); loadScene(name, sceneName); net.move(name, sc.player?.position.x || 0, sc.player?.position.z || 0, 0); };
window.__guide = () => {};

// ---------------------------------------------------------------- network + state
const net = makeNet(() => { saveHost(); render(); });
const KEY = 'stk-proto-';
function saveHost() { try { if (net.role === 'A' && net.state && net.code) localStorage.setItem(KEY + net.code, JSON.stringify(net.state)); } catch (e) {} }
function loadHost(code) { try { const s = JSON.parse(localStorage.getItem(KEY + code) || 'null'); return s && s.tut ? s : null; } catch (e) { return null; } }
const lastRoom = () => { try { const r = JSON.parse(localStorage.getItem(KEY + 'last') || 'null'); return r && Date.now() - r.t < 3 * 3600e3 ? r : null; } catch (e) { return null; } };
const saveRoom = (code, role) => { try { localStorage.setItem(KEY + 'last', JSON.stringify({ code, role, t: Date.now() })); } catch (e) {} };
let myName = (() => { try { return localStorage.getItem(KEY + 'name') || ''; } catch (e) { return ''; } })();
let lobby = { step: 'start', err: '' };
const local = { dict: {}, reply: [], kaigiText: '', busy: false, survey: {}, other: {}, asking: '', listening: false, noMic: false, tab: 'reply', briefSeen: {}, help: false,
  walked: false, walk0: null, sceneAt: 0, lastSig: '', lastChange: 0, seedSeen: undefined, khLen: 0 };
let sampleApi = null, dictApi = null;
(async () => { try { sampleApi = window.claude ? await window.claude.use('sample') : null; } catch (e) { sampleApi = null; } })();
function webSpeech() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition; if (!SR) return null;
  let rec = null, fin = () => {}, part = () => {}, st = () => {};
  return { onFinal(f) { fin = f; }, onPartial(f) { part = f; }, onState(f) { st = f; },
    start() { rec = new SR(); rec.lang = 'ja-JP'; rec.interimResults = true; rec.continuous = false;
      rec.onresult = e => { const r = e.results[e.results.length - 1]; if (r.isFinal) fin({ text: r[0].transcript }); else part({ text: r[0].transcript }); };
      rec.onend = () => st({ state: 'idle' }); rec.onerror = ev => st({ state: 'idle', reason: ev.error });
      rec.start(); st({ state: 'listening' }); return Promise.resolve(); },
    stop() { try { rec && rec.stop(); } catch (e) {} return Promise.resolve(); } };
}
(async () => { try { dictApi = (window.claude ? await window.claude.use('dictation') : null) || webSpeech(); } catch (e) { dictApi = webSpeech(); }
  if (dictApi) { dictApi.onPartial(({ text }) => { const t = $('kt'); if (t) t.value = (local.kaigiText + ' ' + text).trim(); });
    dictApi.onFinal(({ text }) => { local.kaigiText = (local.kaigiText + ' ' + text).trim().slice(0, 80); const t = $('kt'); if (t) t.value = local.kaigiText; });
    dictApi.onState(({ state }) => { local.listening = state === 'listening'; render(true); }); } render(true); })();

// ---------------------------------------------------------------- intro: three rules as a 7-second animation, then the mini game
const INTRO = [['ふたりの画面は、ちがう', '同じ部屋にいても、見えているものが違います'],
  ['サポート役には、ヒントが見える', '答えの手がかりは、サポート役の画面だけに出ます'],
  ['声で、相棒に伝える', '通話で話そう。画面を見せ合うのはナシ'],
  ['回答役は、聞いて答えを押す', '問題が出ている人が回答役。役は交代していきます']];
let introT = 0;
function playIntro() { const el = $('intro'); let i = 0; el.classList.add('on');
  const show = () => { el.classList.remove('s1', 's2', 's3', 's4'); el.classList.add('s' + (i + 1)); $('introCap').textContent = INTRO[i][0]; $('introSub').textContent = INTRO[i][1]; el.querySelectorAll('.dots i').forEach((d, k) => d.classList.toggle('on', k === i)); $('introGo').classList.toggle('guide', i === INTRO.length - 1); };
  show(); fitAll(); clearInterval(introT); introT = setInterval(() => { i = (i + 1) % INTRO.length; show(); }, 3200); }
$('introGo').addEventListener('click', () => { clearInterval(introT); $('intro').classList.remove('on'); local.introSeen = true; render(true); });

// ---------------------------------------------------------------- what to do now (one line, always in the same place)
const partnerHere = () => net.solo || (net.partner && net.partner.scene === sceneName);
const nextJob = s => L.JOBS.find(k => s.jobs[k].status === 'todo');
const nameOf = (s, r) => s?.names?.[r] || (r === net.role ? myName : net.partner?.name) || '通訳官' + r;
function goalText(s, me) {
  if (!s) return '';
  if (sceneName === 'office') { if (s.tut.step >= 2) return '中央広場へ出よう';
    return me === L.tutViewer(s.tut.step) ? '封筒の色を、相棒に声で伝えよう' : '相棒に色を聞いて、同じ色を押そう'; }
  if (sceneName === 'plaza') { const n = nextJob(s); if (!n) return '';
    const there = !net.solo && net.partner && L.JOBS.includes(net.partner.scene) && s.jobs[net.partner.scene].status === 'todo' ? net.partner.scene : n;
    return `光っている「${NAMES[there]}」へ歩き、入口で「入る」`; }
  const j = s.jobs[sceneName]; if (!j) return '';
  if (j.status !== 'todo') return '完了！ 中央広場へ戻ろう';
  if (!partnerHere()) return '相棒が来るのを待とう（通話で呼ぼう）';
  if (sceneName === 'kousin') return j.stage === 0 ? (me === 'A' ? '2つの文を、相棒のしぐさと照らし合わせよう' : 'しぐさが出る文を伝え、返事の言葉を探そう') : (me === 'A' ? '相棒と解読して、返事を3語で組もう' : 'しぐさと返事の内容を、相棒に伝えよう');
  if (sceneName === 'bunki') return '案内人に聞き、相棒と同じ安全な扉を選ぼう';
  if (sceneName === 'kaigi') { const st = L.KAIGI[j.step], hear = me === L.hearerOf(st);
    if (j.pending) return hear ? '相棒の訳を読んで、伝わったか判定しよう' : '相棒が判定中。少し待とう';
    return hear ? '発言の本当の意味を、相棒に声で伝えよう' : '聞いた意味を、使えない言葉を避けて訳そう'; }
  return '';
}
const BADGE = { ans: 'あなたが答える', sup: '相棒をサポート', both: 'ふたりで答える' };
function roleOf(s, me) {
  if (sceneName === 'office') { const T = s.tut; if (T.step >= 2) return null;
    return me === L.tutViewer(T.step) ? { k: 'sup', t: '相棒に「封筒は何色？」が出ている。色を教えよう' } : { k: 'ans', t: '問題：封筒は何色？ 相棒に聞いて、同じ色を押そう' }; }
  const j = s.jobs[sceneName]; if (!j || j.status !== 'todo' || !partnerHere()) return null;
  if (sceneName === 'kousin') return me === 'A' ? { k: 'ans', t: j.stage === 0 ? '問題：2つの文を照らし合わせて、返事の言葉を選ぼう' : '問題：使者の問いかけに、3語で返事を組もう' }
    : { k: 'sup', t: j.stage === 0 ? '相棒が返事の言葉を選ぶ。しぐさが出る文を教えよう' : '相棒が返事を組む。返事の中身としぐさを教えよう' };
  if (sceneName === 'bunki') return { k: 'both', t: '問題：安全な扉は1〜3番のどれ？ 案内人に聞いて、同じ扉を選ぼう' };
  if (sceneName === 'kaigi') { const st = L.KAIGI[j.step], wr = me === L.writerOf(st);
    if (j.pending) return wr ? { k: 'ans', t: '相棒が、訳が伝わったか判定している' } : { k: 'sup', t: '相棒の訳が届いた。伝わったか判定しよう' };
    return wr ? { k: 'ans', t: `問題：${L.CULTURE[st.from].boss}の発言を、${L.CULTURE[st.to].name}を怒らせずに訳そう` } : { k: 'sup', t: `相棒が訳を書く。${L.CULTURE[st.from].boss}の発言の意味を教えよう` }; }
  return null;
}
const HINT = {
  kousin0: { A: '2つの文に共通する言葉を探し、相棒に「両方の文に出るしぐさは？」と聞こう', B: '返事のしぐさが出る文はどっちか、相棒に伝えよう' },
  kousin1: { A: '2つの文に出てくる同じ言葉を探し、相棒のしぐさと比べよう', B: '同じしぐさが出てくる文を伝えよう。相棒の言葉にも同じ語があるはず' },
  bunki0: { A: '案内人に「安全な扉は？」と聞き、答えを相棒に伝えよう', B: '案内人に「安全な扉は？」と聞き、答えを相棒に伝えよう' },
  bunki1: { A: '4人全員に扉を聞こう。答えが割れたら、相棒が決まりで見分ける', B: '4人の答えを集めよう。ずれ方の決まりで、どちらが本当か分かる' },
  kaigiH: 'メモで言い回しを読み替えて、意味をふつうの言葉で伝えよう', kaigiW: '相棒から聞いた意味を、赤い禁句と使えない言葉を避けて書こう',
};
function hintText(s, me) {
  const j = s.jobs[sceneName]; if (!j || j.status !== 'todo' || !partnerHere()) return '';
  if (sceneName === 'kaigi') return j.pending ? '' : me === L.hearerOf(L.KAIGI[j.step]) ? HINT.kaigiH : HINT.kaigiW;
  return HINT[sceneName + j.stage]?.[me] || '';
}

// ---------------------------------------------------------------- success moment: a stamp in the middle of both screens (+ a short buzz where the phone has one)
let seen = null, popT = 0;
const progress = s => ({ tut: s.tut.step, kousin: s.jobs.kousin.stage + (s.jobs.kousin.status === 'done' ? 1 : 0), bunki: s.jobs.bunki.stage + (s.jobs.bunki.status === 'done' ? 1 : 0), kaigi: s.jobs.kaigi.step });
function celebrateText(a, b, s) {   // what just got better, as a short stamp
  if (b.tut > a.tut) return b.tut >= 2 ? '研修クリア！' : '正解！';
  if (b.kousin > a.kousin) return s.jobs.kousin.status === 'done' ? '返事が通じた！' : '通じた！';
  if (b.bunki > a.bunki) return '扉が開いた！';
  if (b.kaigi > a.kaigi) return s.jobs.kaigi.status === 'done' ? '合意した！' : '伝わった！';
  return '';
}
function celebrate(s, show) {
  const now = progress(s), t = seen && show ? celebrateText(seen, now, s) : ''; seen = now;
  if (!t) return;
  const e = $('pop'); e.innerHTML = `<span>${t}</span>`; e.classList.remove('on'); void e.offsetWidth; e.classList.add('on');
  clearTimeout(popT); popT = setTimeout(() => e.classList.remove('on'), 950);
  try { navigator.vibrate && navigator.vibrate(30); } catch (err) {}
}

// ---------------------------------------------------------------- render
let lastKey = '';
// things that live only on this phone, kept in step with the shared state
function syncLocal(s) {
  if (local.seedSeen !== s.seed) {      // a new run ("もう一度" on either phone, or a fresh room): start both phones clean
    const first = local.seedSeen === undefined; local.seedSeen = s.seed;
    if (!first) { Object.assign(local, { survey: {}, reply: [], kaigiText: '', tab: 'reply', dict: {}, briefSeen: {}, help: false, asking: '', busy: false, other: {}, khLen: 0 });
      talk.key = ''; seen = null; lastKey = ''; if (sceneName !== 'title') setTimeout(() => window.__goScene('office'), 0); } }
  const j = s.jobs.kaigi, n = j.history.length;
  if (n !== local.khLen) { local.khLen = n;      // a translation that failed comes back into the box, so it can be fixed instead of typed again
    const e = [...j.history].reverse().find(x => !x.broken);
    if (e && !e.pass && e.who === net.role && e.step === j.step && j.status === 'todo' && !j.pending && !local.kaigiText) local.kaigiText = e.text; }
}
function toast(t, ms = 2600) { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), ms); }
function render(force) {
  const s = net.state, me = net.role, now = performance.now(); if (s) syncLocal(s);
  const sig = [s?.v, s?.seed, sceneName, me, partnerHere()].join('|'); if (sig !== local.lastSig) { local.lastSig = sig; local.lastChange = now; }
  const stuck = now - local.lastChange > 30000;
  const ended = !!s && s.phase === 'end' && sceneName !== 'title';
  const working = !!s && !ended && ['office', 'kousin', 'bunki', 'kaigi'].includes(sceneName);
  const coach = sceneName === 'plaza' ? (!local.walked ? 1 : now - local.walkedAt < 6000 ? 2 : 0) : 0;
  const key = JSON.stringify([s?.v, s?.seed, me, sceneName, partnerHere(), net.partner?.scene, net.partner?.name, lobby, local.reply, local.busy, local.survey, ended, local.asking, local.listening, !!dictApi, local.tab, local.briefSeen, local.help, stuck, coach, local.other]);
  if (!force && key === lastKey) return; lastKey = key;
  if (working && !frame.classList.contains('working')) workSince = now;
  frame.classList.toggle('working', working); frame.classList.toggle('ended', ended); window.__freeze = working || ended;
  if (s) celebrate(s, working || ended);
  if (sceneName === 'title') { renderLobby(); fitAll(); return; }
  if (!s) return;
  // top bar
  $('role').innerHTML = `<i style="background:${ROLE[me].css}">${me}</i>あなた＝${esc(nameOf(s, me))}`;
  const ro = working ? roleOf(s, me) : null, gl = $('goal');
  const hint = working && stuck && sceneName !== 'office' && !talkNeeded(s) ? hintText(s, me) : '', hintOn = !!hint;
  gl.className = 'plate ' + (ro ? ro.k : '') + (ro && working && stuck && hintOn ? ' hinted' : '');
  gl.innerHTML = ro ? `<span class="badge ${ro.k}">${BADGE[ro.k]}</span><span><span class="gt">${esc(ro.t)}</span>${hint ? `<span class="hintline">ヒント：${esc(hint)}</span>` : ''}</span>` : `<small>いまの目標</small><span>${esc(ended ? 'おつかれさまでした' : goalText(s, me))}</span>`;
  const other = me === 'A' ? 'B' : 'A', p = net.partner;
  const chip = net.solo ? `<button class="btn" data-a="swap">${other}の画面を見る</button>` : `<i style="background:${ROLE[other].css}">${other}</i>${esc(nameOf(s, other))}<em>${p ? NAMES[p.scene] || '' : '未接続'}</em>`;
  let tr = chip;
  if (sceneName === 'plaza' && nextJob(s)) tr += `<button class="btn" data-a="warp">歩かずに入る</button>`;
  if (working && sceneName !== 'office') tr = (sceneName === 'kaigi' && s.jobs.kaigi.status === 'todo' && !L.KAIGI[s.jobs.kaigi.step].practice ? `<span>緊張度 ${s.jobs.kaigi.tension}%</span><span class="bar"><i style="width:${s.jobs.kaigi.tension}%"></i></span>` : '') + (net.solo ? chip : '') + `<button class="btn" data-a="help">？</button><button class="btn" data-a="plaza">広場へ</button>`;
  $('tr').innerHTML = tr;
  const co = $('coach'); co.classList.toggle('on', coach > 0); co.textContent = coach === 1 ? '← なぞって歩く' : 'なぞって見回す'; $('stick').classList.toggle('guide', coach === 1);
  const talking = working && talkNeeded(s); frame.classList.toggle('talking', !!talking); if (talking) talkShow(s, me);
  if (working) renderWork(s, me, stuck);
  if (ended) renderEnd();
  fitAll();
}

// ---------------------------------------------------------------- lobby
let lobbyKey = '';
function renderLobby() {
  const el = $('lobby'), s = net.state;
  const k = JSON.stringify([lobby, net.code, net.role, !!net.partner, net.partner?.name, !!s, net.status]); if (k === lobbyKey) return; lobbyKey = k;   // never wipe what is being typed
  if (lobby.step === 'start') { const lr = lastRoom();
    el.innerHTML = `<input id="nm" maxlength="8" placeholder="あなたの名前" value="${esc(myName)}">
      ${lr ? `<button class="btn teal" data-l="rejoin">前の部屋に戻る（${esc(lr.code)}）</button>` : ''}
      <div class="row"><button class="btn main ${lr ? '' : 'guide'}" data-l="create" style="flex:2">部屋をつくる</button><button class="btn sm" data-l="solo">ひとりで試す</button></div>
      <div class="row"><input id="code" inputmode="numeric" maxlength="4" placeholder="コード4桁"><button class="btn" data-l="join">参加する</button></div>
      ${lobby.err ? `<div class="msg bad">${esc(lobby.err)}</div>` : `<div class="note">通話しながら遊びます</div>`}`;
  } else { const p = net.partner;
    el.innerHTML = `<div class="note">${net.role === 'A' ? 'このコードを相手に伝えよう' : '参加しました'}</div><div class="code">${esc(net.code)}</div>
      <div class="msg ${p ? 'ok' : net.status === 'noroom' || net.status === 'busy' || net.status === 'full' ? 'bad' : 'wait'}">${p ? `${esc(p.name || '相手')}さんが来ました` : net.status === 'noroom' ? 'その部屋が見つかりません。コードを確かめよう（自動で探し続けます）' : net.status === 'full' ? 'その部屋には、もう2人います' : net.status === 'busy' ? '部屋を準備しています…' : '相手を待っています…'}</div>
      ${net.role === 'A' ? `<button class="btn main ${p ? 'guide' : ''}" data-l="go" ${p ? '' : 'disabled'}>出勤する</button>` : `<div class="note">相手が「出勤する」を押すと始まります</div>`}
      <button class="btn sm" data-l="back">やめる</button>`; }
}
$('lobby').addEventListener('input', e => { if (e.target.id === 'nm') { myName = e.target.value.trim(); try { localStorage.setItem(KEY + 'name', myName); } catch (x) {} net.setName(myName); } });
$('lobby').addEventListener('click', async e => {
  const b = e.target.closest('[data-l]'); if (!b) return; const l = b.dataset.l;
  if (!myName && l !== 'back' && l !== 'solo') { lobby = { step: 'start', err: '名前を入れてください' }; render(true); return; }
  try {
    if (l === 'create') { const code = String(1000 + Math.floor(Math.random() * 9000)); net.me.name = myName; await net.join(code, 'A'); saveRoom(code, 'A'); lobby = { step: 'wait' }; }
    if (l === 'rejoin') { const lr = lastRoom(); if (lr) { net.me.name = myName; await net.join(lr.code, lr.role); saveRoom(lr.code, lr.role);
        if (lr.role === 'A') { const old = loadHost(lr.code); if (old) { net.setState(old); window.__goScene('office'); return; } } lobby = { step: 'wait' }; } }
    if (l === 'join') { const code = ($('code').value || '').trim(); if (!/^\d{4}$/.test(code)) { lobby = { step: 'start', err: 'コードは4桁の数字です' }; render(true); return; }
      net.me.name = myName; await net.join(code, 'B'); saveRoom(code, 'B'); lobby = { step: 'wait' }; }
    if (l === 'solo') { net.startSolo(); net.state = L.newState(Math.floor(Math.random() * 1e9), { A: myName || 'ユウ', B: 'アヤ' }); window.__goScene('office'); return; }
    if (l === 'go') { net.setState(L.newState(Math.floor(Math.random() * 1e9), { A: myName, B: net.partner?.name || '通訳官B' })); window.__goScene('office'); return; }
    if (l === 'back') { net.leave(); net.state = null; lobby = { step: 'start', err: '' }; }
  } catch (err) { lobby = { step: 'start', err: 'オンラインにつながりませんでした。開き直すか「ひとりで試す」を選んでください。' }; }
  render(true);
});
setInterval(() => { if (sceneName === 'title' && net.state && lobby.step === 'wait') window.__goScene('office'); }, 500);

// ---------------------------------------------------------------- talk: the aliens in each base explain the job in speech bubbles
const SAY = (who, t, al = '') => ({ who, t, al });
const TALK = {
  office: (s, me) => { const see = me === L.tutViewer(0); return { names: ['局長（通信）'], col: ['#7a5cc8'], lines: [
    SAY(-1, '星間通訳局へようこそ。今日から、ふたりは<b>通訳官</b>だ。'),
    SAY(-1, '宇宙人の言葉は、ひとりでは訳せない。<b>見えるものが、ふたりで違う</b>からだ。'),
    SAY(-1, 'だから<b>声で伝え合う</b>。画面は見せ合わないのが決まりだよ。'),
    SAY(-1, see ? 'まずは研修だ。机の上の<b>封筒の色</b>は、あなたにしか見えない。相棒に教えてあげなさい。' : 'まずは研修だ。<b>封筒の色</b>は相棒にしか見えない。何色か聞いて、同じ色を押しなさい。')] }; },
  kousin: (s, me) => { const p = L.kousinNow(s), w = Object.values(p.words); return { names: ['使者ヴェル＝ナ'], col: ['#2fa89a'], lines: [
    SAY(0, 'はじめまして。遠い星から、言葉を届けに来た。', `${w[0]} ${w[1]}！`),
    SAY(0, me === 'A' ? 'わたしの<b>言葉</b>は、あなたにだけ聞こえる。<b>しぐさ</b>は、相棒にだけ見える。' : 'わたしの<b>しぐさ</b>は、あなたにだけ見える。<b>言葉</b>は、相棒にだけ聞こえる。', `${w[2]} ${w[3]}……`),
    SAY(0, '同じ言葉は、いつも同じしぐさ。ふたりで照らし合わせて、わたしの問いに<b>返事</b>をしておくれ。', `${w[1]} ${w[4] || w[0]}`),
    SAY(0, me === 'A' ? '返事の言葉を選ぶのは<b>あなた</b>。相棒に、しぐさの意味を聞くんだよ。' : '返事を選ぶのは相棒。あなたは<b>しぐさと返事の中身</b>を教えてあげて。'),
    SAY(0, 'まずは小手調べ。<b>2つの文</b>を照らし合わせて、返事の言葉を選んでみて。', `${w[0]}？`)] }; },
  bunki: (s, me) => ({ names: ['ペロ', 'ミミ', 'ゴウ', 'ナナ'], col: ['#d9822b', '#c4569a', '#4a7fd0', '#3a9a6a'], lines: [
    SAY(0, 'ようこそ分岐路へ！ 扉は3つ。安全なのは<b>1つだけ</b>だよ。'),
    SAY(1, `わたしとペロには、<b>${me === 'A' ? 'あなた' : '相棒'}</b>が質問できるの。`),
    SAY(2, `オレとナナには、<b>${me === 'B' ? 'あなた' : '相棒'}</b>が質問できる。`),
    SAY(3, `ただし上の階には<b>うそつき</b>が混じってる。見分け方は、${me === 'B' ? 'あなた' : '相棒'}の画面にだけ出るわ。`),
    SAY(0, '聞いた答えを伝え合って、<b>ふたりで同じ扉</b>を押してね。最初は、うそつきのいない階で練習だ！')] }),
  kaigi: (s, me) => { const kr = me === 'A' ? 'あなた' : '相棒', gr = me === 'B' ? 'あなた' : '相棒'; return { names: ['ハサ長老（クリル族）', 'モス議長（グラ族）'], col: ['#d0644a', '#5f9a5c'], lines: [
    SAY(0, '通訳官どの、よく来られた。われらクリル族は、ものを<b>遠回しに言う</b>。', 'カラ…カラ…'),
    SAY(1, 'グラ族もだ。言い回しの意味は、<b>同じ族の側の通訳</b>にしか分からぬ。', 'ズゥゥン'),
    SAY(0, `クリルの言い回しは${kr}、グラの言い回しは${gr}が知っておる。`),
    SAY(1, sampleApi ? '発言した族の側が<b>意味を説明</b>し、もう片方が<b>相手の族向けに訳</b>を書くのだ。' : '発言した族の側が<b>意味を説明</b>し、もう片方が訳を書く。伝わったかは<b>説明した側</b>が見届ける。'),
    SAY(0, 'そして互いに、口にされると怒る<b>禁句</b>がある。議題によっては、<b>使えない言葉</b>もあるぞ。'),
    SAY(1, '場の緊張が<b>100%</b>になれば、会談は決裂だ。……まずは、軽い一言から訳してもらおう。')] }; },
};
const talk = { key: '', i: 0, n: 0, typed: 0, timer: 0, data: null };
function talkNeeded(s) {
  if (!s || !TALK[sceneName] || local.briefSeen[sceneName]) return false;
  if (sceneName === 'office') return s.tut.step === 0 && !$('intro').classList.contains('on');
  return s.jobs[sceneName].status === 'todo' && partnerHere();
}
function talkShow(s, me) {
  const key = sceneName + me; if (talk.key !== key) { talk.key = key; talk.i = 0; talk.data = TALK[sceneName](s, me); talk.n = talk.data.lines.length; talkLine(); }
}
function talkLine() {
  const D = talk.data, ln = D.lines[talk.i], b = $('bub'), who = ln.who < 0 ? 0 : ln.who, last = talk.i === talk.n - 1;
  b.className = 'bub'; void b.offsetWidth;
  b.innerHTML = `<span class="who" style="background:${D.col[who]}">${D.names[who]}</span>${ln.al ? `<div class="al">「${esc(ln.al)}」</div>` : ''}<div class="tx"></div>
    <div class="nav"><span>${talk.i + 1} / ${talk.n}　タップで次へ</span><button class="btn ${last ? 'main' : ''} guide" data-t="next">${last ? 'はじめる' : '次へ ▶'}</button></div>`;
  b.dataset.who = ln.who;
  const tx = b.querySelector('.tx'), full = ln.t; let k = 0; clearInterval(talk.timer);
  const plain = full.replace(/<[^>]+>/g, '');
  talk.timer = setInterval(() => { k += 2; if (k >= plain.length) { clearInterval(talk.timer); tx.innerHTML = full; talk.done = true; return; } tx.textContent = plain.slice(0, k); }, 30); talk.done = false;
  talkPlace();
}
function talkNext(skip) {
  if (!skip && !talk.done) { clearInterval(talk.timer); $('bub').querySelector('.tx').innerHTML = talk.data.lines[talk.i].t; talk.done = true; return; }
  if (!skip && talk.i < talk.n - 1) { talk.i++; talkLine(); return; }
  clearInterval(talk.timer); local.briefSeen[sceneName] = true; talk.key = ''; local.lastChange = performance.now(); render(true);
}
function talkPlace() {   // put the bubble beside whoever is speaking
  if (!frame.classList.contains('talking')) return;
  const b = $('bub'), who = +b.dataset.who, W = frame.clientWidth, H = frame.clientHeight, bw = b.offsetWidth, bh = b.offsetHeight;
  const tg = (sc && sc.tags || [])[who]; let x = W * 0.5 - bw / 2, y = H * 0.3, side = 'n';
  if (tg) { const v = tg.pos.clone(); v.y -= 0.8; v.project(cam); const px = (v.x + 1) / 2 * W, py = (1 - v.y) / 2 * H;
    if (v.z < 1) { side = px < W / 2 ? 'r' : 'l'; x = side === 'r' ? px + 56 : px - 56 - bw; y = py - 40; } }
  x = Math.max(10, Math.min(W - bw - 10, x)); y = Math.max(56, Math.min(H - bh - 50, y));
  b.classList.remove('r', 'l', 'n'); b.classList.add(side); b.style.left = x + 'px'; b.style.top = y + 'px';
}
$('talk').addEventListener('click', e => { const t = e.target.closest('[data-t]'); talkNext(t && t.dataset.t === 'skip'); });

// ---------------------------------------------------------------- work screens (full-screen 2D)
// what to do first + the rules, shown when you first walk into a base (and again from "？")
const BRIEF = {
  kousin: { goal: '使者の言葉を解読して、正しく返事をする',
    A: { k: 'ans', first: ['使者の言葉（あなたにだけ聞こえる）を見る', '相棒に、しぐさと返事の中身を聞く', '同じ言葉が出る文を照らし合わせ、「返事する」'] },
    B: { k: 'sup', first: ['使者のしぐさ（あなたにだけ見える）を見る', 'しぐさと、返事の中身を相棒に話す', '相棒が正しく返事できたら成功'] },
    rules: ['言葉が聞こえるのは片方、しぐさが見えるのはもう片方', '同じ言葉は、同じしぐさと同じ意味', '返事は3語。使者の文と同じ並び順で組む（日本語の順とはちがう）', '返事を決めて押すのは回答役だけ'],
    prac: 'まず練習：2つの文を照らし合わせて、1語を選ぶ' },
  bunki: { goal: 'ふたりで同じ「安全な扉」を選んで、次の階へ',
    A: { k: 'both', first: ['案内人（ペロ・ミミ）に「安全な扉は？」と聞く', '答えを相棒に伝え、相棒の答えも聞く', 'ふたりで同じ扉を押す'] },
    B: { k: 'both', first: ['案内人（ゴウ・ナナ）に「安全な扉は？」と聞く', '答えを相棒に伝え、相棒の答えも聞く', 'ふたりで同じ扉を押す'] },
    rules: ['案内人は4人。半分ずつ、別々の人に質問できる', '本番の階には、うそつきがいる', 'うその見分け方は、ゴウ・ナナ側の画面にだけ出る'],
    prac: 'まず練習：うそつきのいない階で、扉を選ぶ' },
  kaigi: { goal: '両族の発言を訳して、会談をまとめる',
    A: { k: 'swap', first: ['発言の主と同じ族の人が、意味を説明する（サポート役）', 'もう片方が、相手の族向けに訳を書く（回答役）{J}', '議題ごとに役が交代する'] },
    B: { k: 'swap', first: ['発言の主と同じ族の人が、意味を説明する（サポート役）', 'もう片方が、相手の族向けに訳を書く（回答役）{J}', '議題ごとに役が交代する'] },
    rules: ['言い回しの意味を知っているのはサポート役だけ', '禁句と、使えない言葉を知っているのは回答役だけ', '伝わらないと緊張度が上がり、100%でその議題をやり直し'],
    prac: 'まず練習：短い発言を1つ訳す（緊張度は上がらない）' },
};
const RB = { ans: ['ans', 'あなたは回答役'], sup: ['sup', 'あなたはサポート役'], both: ['both', 'ふたりとも答える'], swap: ['sup', '役は交代しながら進む'] };
function renderWork(s, me, stuck) {
  const wl = $('wl'), wr = $('wr'), keep = local.kaigiText, focus = document.activeElement?.id === 'kt', st = [wl.scrollTop, wr.scrollTop];
  let v;
  if (sceneName === 'office') v = tutWork(s, me);
  else { const j = s.jobs[sceneName];
    if (j.status !== 'todo') v = { L: card('', '', `<div class="stamp" style="display:inline-block">${j.status === 'done' ? '業務完了' : 'スキップ'}</div>`), R: `<button class="btn main guide" data-a="plaza">広場へ戻る</button>` };
    else if (!partnerHere()) v = { L: card('wait', '', `相棒を待っています。「<b>${NAMES[sceneName]}</b>に来て」と呼ぼう`), R: '' };
    else v = ({ kousin: kousinWork, bunki: bunkiWork, kaigi: kaigiWork })[sceneName](s, me);
  }
  wl.innerHTML = `<div class="fit">${v.L}</div>`; wr.innerHTML = `<div class="fit">${v.R}</div>`; wl.scrollTop = st[0]; wr.scrollTop = st[1];
  const kt = $('kt'); if (kt) { kt.value = keep; if (focus) kt.focus(); }
  // briefing: once per job, and again from the "？" button
  const B = BRIEF[sceneName], show = B && s.jobs[sceneName].status === 'todo' && partnerHere() && local.help, br = $('brief');
  br.classList.toggle('on', !!show);
  if (show) { const M = B[me], rb = RB[M.k];
    br.innerHTML = `<div class="box plate"><h2>${NAMES[sceneName]}　${JOBSUB[sceneName]}</h2><p>目標：${B.goal}</p>
      <div class="cols"><div><span class="rb ${rb[0]}">${rb[1]}</span><h3>まずやること</h3><ol>${M.first.map(x => `<li>${x.replace('{J}', sampleApi ? '' : '。伝わったかはサポート役が判定')}</li>`).join('')}</ol></div>
      <div><h3 style="margin-top:4px">ルール</h3><ul>${B.rules.map(x => `<li>${x}</li>`).join('')}</ul></div></div>
      <div class="prac">${B.prac}</div>
      <div style="display:flex;gap:8px;margin-top:10px;align-items:center"><span style="flex:1;font-size:13px;color:var(--mut)">画面は見せ合わず、声で伝え合う</span>${local.help ? '<button class="btn sm" data-a="skip">この仕事をスキップ</button>' : ''}<button class="btn main guide" data-a="brief">${local.help ? 'もどる' : 'はじめる'}</button></div></div>`; }
}
const envelope = css => `<svg width="92" height="66" viewBox="0 0 92 66" style="flex:none"><rect x="2" y="2" width="88" height="62" rx="8" fill="${css}" stroke="#fff" stroke-width="3"/><path d="M4 6 L46 38 L88 6" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>`;
function tutWork(s, me) {
  const T = s.tut;
  if (T.step >= 2) return { L: card('', 'この仕事のきまり', rows(['見えているものは、ふたりで違う', '声で伝え合う（画面は見せない）', '決められるのは、どちらか片方'])), R: `<div class="stamp">研修完了</div><button class="btn main guide" data-a="plaza">広場へ出る</button>` };
  const viewer = L.tutViewer(T.step), tgt = L.TUT.find(c => c.k === L.tutTarget(s.seed, T.step));
  const fb = T.last === 'miss' ? `<div class="msg bad">ちがう色。もう一度聞こう</div>` : T.step === 1 ? `<div class="msg ok">正解！ 役を交代</div>` : '';
  if (me === viewer) return { L: card('mine', MINE + '：答えの手がかり', `<div style="display:flex;align-items:center;gap:14px">${envelope(tgt.css)}<div>封筒の色は<b>${tgt.ja}</b></div></div>`), R: fb + card('sup', 'あなたはサポート役', '相棒が「封筒は何色？」に答える。<br><b>この色を声で教えよう</b>') };
  return { L: card('q', '問題', '封筒は何色？<br><span style="font-size:14px;color:var(--mut)">封筒は相棒にだけ見えている。「何色？」と聞こう</span>'), R: fb + `<div style="font-size:13px;font-weight:800;color:var(--amber)">あなたの答え</div><div class="grid2">${L.TUT.map(c => `<button class="swatch guide" style="background:${c.css}" data-tut="${c.k}">${c.ja}</button>`).join('')}</div>` };
}

// 交信室 ---------------------------------------------------------------
const lockSecs = s => { const j = s && s.jobs.kousin; return j && j.status === 'todo' && j.lockUntil ? Math.max(0, Math.ceil((j.lockUntil - Date.now()) / 1000)) : 0; };
let lockLeft = 0;
function lockTick(s) {      // runs every frame: counts the rest down in place, and redraws once when it starts or ends
  const n = net.role === 'A' ? lockSecs(s) : 0; if (n === lockLeft) return; const was = lockLeft; lockLeft = n;
  if (!n || !was) render(true); else document.querySelectorAll('.lockn').forEach(e => { e.textContent = n; });
}
function kousinWork(s, me) {
  const j = s.jobs.kousin, p = L.kousinNow(s), T = p.teach, w = k => p.words[k], G = k => L.CONCEPTS[k].gesture, JA = k => L.CONCEPTS[k].ja;
  const known = {}; if (j.stage === 1) for (const k of T.order) known[w(k)] = JA(k);
  for (const k of (j.reveal || [])) known[w(k)] = JA(k);        // explained by the envoy after misses
  const memo = x => known[x] || local.dict[x] || '';
  const al = k => `<span class="alien" style="display:inline-block;margin-right:14px">${w(k)}<small>${esc(memo(w(k))) || '　'}</small></span>`;
  const plain = k => `<span class="alien" style="display:inline-block;margin-right:14px">${w(k)}</span>`;
  const ro = (l, f) => l.map((x, i) => `<div class="rowline"><b>${i + 1}</b><span>${x.map(f).join('')}</span></div>`).join('');
  if (j.stage === 0) {      // practice: two sentences, one shared word. A has the words, B has the gestures -> match them up
    const fb = j.last === 'teach_miss' ? `<div class="msg bad">使者は首をかしげた。もう一度、照らし合わせよう</div>` : '';
    if (me === 'A') return { L: card('mine', MINE + '：使者の言葉', ro(T.lines, plain)),
      R: fb + card('q', '<span class="pbadge">練習</span>問題：返事の言葉は？', `<div class="tiles">${T.tiles.map(k => `<button class="tile ${local.reply[0] === k ? 'on' : local.reply.length ? '' : 'guide'}" data-tile="${k}"><span class="alien ${w(k).length > 3 ? 'long' : ''}">${w(k)}</span></button>`).join('')}</div>`) + `<button class="btn main ${local.reply.length === 1 ? 'guide' : ''}" data-a="ksend" ${local.reply.length === 1 ? '' : 'disabled'}>返事する</button>` };
    return { L: card('mine', MINE + '：使者のしぐさ（順番はバラバラ）', ro(T.gestures, k => `<span style="margin-right:10px;display:inline-block">${G(k)}</span>`)),
      R: fb + card('sup', 'あなたはサポート役', `相棒が返事の言葉を選ぶ。返事は<b>「${JA(T.target)}」</b>の言葉。<br>「${G(T.target)}」が出る文はどっち？ 相棒に伝えて、言葉と照らし合わせよう`) };
  }
  // after a miss the numbers are for B only: A has to ask. From the 3rd miss the send button rests (the lock is in the state; A is the host, so its clock is the one that counts)
  const miss = j.last === 'miss' && j.hit, lock = lockSecs(s);
  const gaveA = j.gave ? `<br>使者が言い直した：「${w(j.gave)}」＝「${JA(j.gave)}」` : '';
  const fb = j.last === 'teach_ok' ? `<div class="msg ok">通じた！ 次は3語で返事</div>`
    : !miss ? '' : me === 'A' ? `<div class="msg bad">通じなかった。相棒に結果を聞こう${gaveA}</div>`
      : `<div class="msg bad">相棒の返事：合っている言葉 ${j.hit.words}/3・並び順も合っている ${j.hit.pos}/3。相棒に伝えよう${j.gave ? '<br>使者が1語、言い直した（相棒の画面に出る）' : ''}${j.misses >= L.KOUSIN_LOCK_FROM ? '<br>次の返事まで少し待つ' : ''}</div>`;
  if (me === 'A') {
    const uniq = [...new Set(p.lines.flat().concat(p.question).map(w))].filter(x => !known[x]), memoOn = local.tab === 'memo';
    const lhead = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px"><small style="flex:1;margin:0;font-size:13px;font-weight:800;color:var(--mine)">${MINE}：使者の言葉</small><button class="btn sm" data-tab="${memoOn ? 'reply' : 'memo'}">${memoOn ? '返事にもどる' : '意味メモ'}</button></div>`;
    const body = memoOn
      ? card('q', '意味のメモ（自分用）', `<div class="dictrow">${uniq.map(x => `<label><span class="alien ${x.length > 3 ? 'long' : ''}">${x}</span><select data-dict="${x}"><option value="">？</option>${Object.values(L.CONCEPTS).map(c => `<option ${local.dict[x] === c.ja ? 'selected' : ''}>${c.ja}</option>`).join('')}</select></label>`).join('')}</div>`)
      : card('q', '', `<div class="tiles">${p.tiles.map(k => `<button class="tile ${local.reply.includes(k) ? 'on' : ''}" data-tile="${k}"><span class="alien ${w(k).length > 3 ? 'long' : ''}">${w(k)}<small>${esc(memo(w(k))) || '　'}</small></span>${local.reply.includes(k) ? `<i class="ord">${local.reply.indexOf(k) + 1}</i>` : ''}</button>`).join('')}</div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:6px"><button class="btn sm" data-a="kclear" style="flex:1">消す</button><button class="btn main sm ${local.reply.length === 3 && !lock ? 'guide' : ''}" style="flex:2" data-a="ksend" ${local.reply.length === 3 && !lock ? '' : 'disabled'}>${lock ? `あと<span class="lockn">${lock}</span>秒` : '伝える'}</button></div>`);
    return { L: `<div class="card mine">${lhead}<div class="rowline"><b style="background:var(--amber);color:#1a1300">問</b><span>${p.question.map(al).join('')}</span></div>` + p.lines.map((l, i) => `<div class="rowline"><b>${i + 1}</b><span>${l.map(al).join('')}</span></div>`).join('') + '</div>', R: fb + body };
  }
  return { L: card('mine', MINE + '：使者のしぐさ（順番はバラバラ）', `<div class="rowline"><b style="background:var(--amber);color:#1a1300">問</b><span>${p.gestures[3].map(G).join('　／　')}</span></div>` + p.gestures.slice(0, 3).map((g, i) => `<div class="rowline"><b>${i + 1}</b><span>${g.map(G).join('　／　')}</span></div>`).join('')),
    R: fb + card('sup', 'あなたはサポート役', `相棒が返事を3語で組む。教えること：<br>① 返事の中身は<b>「わたし」「食べ物」「あげる」</b><br>② 左のしぐさが、どの文に出るか。相棒の言葉と照らし合わせよう`) };
}

// 分岐路 ---------------------------------------------------------------
function bunkiWork(s, me) {
  const j = s.jobs.bunki, p = L.bunkiNow(s), o = me === 'A' ? 'B' : 'A';
  const names = a => a.map(g => L.GUIDES[g].name).join('と');
  const fb = !j.last ? '' : j.last.k === 'teach_ok' ? `<div class="msg ok">開いた！ 次の階は、うそつきがいる</div>` : j.last.k === 'teach_miss' ? `<div class="msg bad">行き止まり。答えを確かめよう</div>`
    : j.last.k === 'miss' ? `<div class="msg bad">行き止まり。うそつきは${names(j.last.liars)}、正解は${j.last.safe}番。新しい階へ</div>` : '';
  let Lh = '';
  for (const g of Object.keys(L.GUIDES).filter(g => L.GUIDES[g].who === me)) {
    const asked = j.asked[g] || [];
    Lh += card('mine', `${L.GUIDES[g].name}に質問`,
      asked.map(a => `<div class="rowline"><b>答</b><span>${esc(a.ans)}</span></div>`).join('') + (local.asking === g ? `<div class="msg wait">考えています…</div>` : '')
      + (!asked.length && local.asking !== g ? `<button class="btn sm guide" data-ask="${g}|door">安全な扉は？</button>` : ''));
  }
  const v = j.votes, allAsked = Object.keys(L.GUIDES).filter(g => L.GUIDES[g].who === me).every(g => (j.asked[g] || []).length);
  const Rh = fb + (me === 'B' ? card('sup', MINE + '：この階の決まり', L.BUNKI_RULE(p)) : card('wait', '', '<b>うその決まり</b>は相棒が知っている。聞いてみよう'))
    + card('q', `${j.stage === 0 ? '<span class="pbadge">練習</span>' : ''}問題：安全な扉は？（同じ扉で決定）`, `<div class="grid3">${[1, 2, 3].map(n => `<button class="btn ${v[me] === n ? 'on' : allAsked && !v[me] ? 'guide' : ''}" data-door="${n}">扉 ${n}</button>`).join('')}</div>
      <div style="margin-top:6px;font-size:14px;color:var(--mut)">${net.solo ? `${o}の選択：${v[o] ? '扉' + v[o] : 'まだ'}` : `${esc(nameOf(s, o))}：${v[o] ? '扉' + v[o] + 'を選んでいる' : 'まだ選んでいない'}`}</div>`);
  return { L: Lh, R: Rh };
}

// 和平会議 -------------------------------------------------------------
function kaigiWork(s, me) {
  const j = s.jobs.kaigi, st = L.KAIGI[j.step], hearer = L.hearerOf(st), cult = Object.values(L.CULTURE).find(c => c.side === me), from = L.CULTURE[st.from], to = L.CULTURE[st.to], pd = j.pending;
  const last = j.history[j.history.length - 1];
  const res = !last || pd ? '' : last.broken ? `<div class="msg bad">会談が決裂した……。この議題をやり直し（緊張度 ${j.tension}%）</div>`
    : `<div class="msg ${last.pass ? 'ok' : 'bad'}">${last.pass ? '伝わった' : '伝わらなかった・もう一度'}（緊張度 ${last.d > 0 ? '+' : ''}${last.d}）<br><span style="font-weight:500">${esc(last.judge.reason || '')}　${esc(last.judge.reaction || '')}</span></div>`;
  const lastTopic = j.step === L.LAST, enter = lastTopic && last && last.tense && !pd;
  const step = `<div style="font-size:13px;color:var(--mut)">${st.practice ? '<span class="pbadge">練習</span>緊張度は上がらない'
    : enter ? `<b style="color:var(--red);font-size:14px">最後の議題：緊張度 ${L.startTension(L.LAST)}% から</b>`
    : lastTopic ? `最後の議題　緊張度100%でやり直し` : `議題 ${j.step} / ${L.LAST}　緊張度100%でやり直し`}</div>`;
  if (me === hearer) return {
    L: card('mine', `${MINE}：${from.boss}の発言`, `「${esc(st.text)}」`) + card('mine', `${MINE}：言い回しメモ`, cult.idioms.map(([a, b]) => `<div class="rowline"><span>「${a}」＝ <b style="all:unset;font-weight:800;color:var(--mine)">${b}</b></span></div>`).join('')),
    R: pd ? step + card('sup', '相棒の訳', `「${esc(pd.text)}」<br>この訳で、発言の<b>本当の意味</b>は伝わった？`)
        + `<div class="grid2"><button class="btn teal" data-a="kverdict" data-ok="1">伝わった</button><button class="btn" data-a="kverdict" data-ok="0">ずれている</button></div><div style="font-size:13px;color:var(--mut)">判定の目安：言い回しの本当の意味が入っていれば伝わった</div>`
      : res + step + card('sup', 'あなたはサポート役', `相棒が${to.name}向けに訳を書く。<br>左のメモで読み解いて、発言の<b>本当の意味</b>をふつうの言葉で教えよう`) };
  const ban = (st.ban || []).length ? `<br>この議題で言い換え禁止：<b style="color:var(--red);letter-spacing:.2em">${L.banShown(st).join(' ')}</b>（ひらがなでもダメ）` : '';
  return {
    L: card('q', '問題', `${from.boss}の発言を、${to.name}を怒らせない言葉に訳そう。<br><span style="font-size:14px;color:var(--mut)">発言の意味は相棒が知っている。聞いてみよう</span>`) + card('warn', `${MINE}：使えない言葉`, `${cult.name}の禁句：<span style="font-size:24px;font-weight:800;color:var(--red);letter-spacing:.3em">${cult.taboo.join(' ')}</span>${ban}<br><span style="font-size:13px;color:var(--mut)">訳に入れると失敗</span>`),
    R: pd ? step + card('wait', '', `あなたの訳：「${esc(pd.text)}」<br><b>相棒が判定中…</b>`)
      : res + step + `<div style="font-size:13px;font-weight:800;color:var(--amber)">あなたの答え（訳）</div><div style="display:flex;gap:8px;align-items:stretch">${dictApi && !local.noMic ? `<button class="btn ${local.listening ? 'teal' : ''}" data-a="mic" style="flex:none">${local.listening ? '話し終えた' : '声で入力'}</button>` : ''}<textarea id="kt" class="${local.kaigiText ? '' : 'guide'}" rows="2" maxlength="80" placeholder="${cult.name}への訳" style="flex:1"></textarea></div>
      <button class="btn main" data-a="ksubmit" ${local.busy ? 'disabled' : ''}>${local.busy ? to.name + 'が協議中…' : 'この訳を伝える'}</button>` };
}

// ---------------------------------------------------------------- events
async function onAct(e) {
  const b = e.target.closest('button'); if (!b) return; const d = b.dataset, s = net.state, me = net.role; if (!s && !d.a) return;
  if (d.a === 'plaza') { local.help = false; window.__goScene('plaza'); return; }
  if (d.a === 'swap') { net.role = me === 'A' ? 'B' : 'A'; local.reply = []; render(true); return; }
  if (d.a === 'warp') { const n = nextJob(s); if (n) window.__goScene(n); return; }
  if (d.a === 'help') { local.help = true; render(true); return; }
  if (d.a === 'brief') { local.briefSeen[sceneName] = true; local.help = false; render(true); return; }
  if (d.tut) { net.act({ t: 'tut_pick', color: d.tut, role: me }); return; }
  if (d.tab) { local.tab = d.tab; render(true); return; }
  if (d.tile) { const max = s.jobs.kousin.stage === 0 ? 1 : 3, k = d.tile, i = local.reply.indexOf(k);
    if (max === 1) local.reply = [k]; else if (i >= 0) local.reply.splice(i, 1); else if (local.reply.length < max) local.reply.push(k); render(true); return; }
  if (d.a === 'kclear') { local.reply = []; render(true); return; }
  if (d.a === 'ksend') { net.act({ t: 'kousin_reply', ids: local.reply.slice(), role: 'A' }); local.reply = []; local.tab = 'reply'; return; }
  if (d.ask) { if (local.asking) return; const g = d.ask.split('|')[0], fact = L.bunkiFact(L.bunkiNow(s), g); let say = null;
    if (sampleApi) { local.asking = g; render(true);
      try { const r = await Promise.race([sampleApi(L.guidePrompt(g, fact), { modelTier: 'quick' }), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 5000))]);
        const t = String(r?.text || '').trim().replace(/^「|」$/g, ''); if (t && L.factOk(t, fact)) say = t.slice(0, 80); } catch (err) {}
      local.asking = ''; }
    net.act({ t: 'bunki_ask', guide: g, q: 'door', role: me, say }); return; }
  if (d.door) { net.act({ t: 'bunki_vote', door: Number(d.door), role: me, attempt: s.jobs.bunki.attempt, stage: s.jobs.bunki.stage }); return; }
  if (d.a === 'mic') { if (local.listening) { try { await dictApi.stop(); } catch (err) {} return; }
    dictApi.start().catch(err => { if (err && err.code === 'not_granted') local.noMic = true; toast('声の入力が使えません。キーボードのマイクか文字で入力してください'); render(true); }); return; }
  if (d.a === 'kverdict') { net.act({ t: 'kaigi_verdict', step: s.jobs.kaigi.step, ok: d.ok === '1', role: me, pid: s.jobs.kaigi.pending?.id }); return; }
  if (d.a === 'ksubmit') { if (local.listening) { try { await dictApi.stop(); } catch (err) {} }
    const text = (local.kaigiText || '').trim().slice(0, 80); if (text.length < 2) { toast('訳を書いてください'); return; }
    const j = s.jobs.kaigi, st = L.KAIGI[j.step], step = j.step, role = L.writerOf(st), to = L.CULTURE[st.to];
    // 1) the game's own rule (taboo letters, banned words) fails it at once.
    // 2) with an AI: it judges whether the meaning got across. 3) without one (or if it fails): the partner (hearer) judges on their own screen.
    if (L.ruleJudge(st, text) || !sampleApi) { local.kaigiText = ''; net.act({ t: 'kaigi_propose', step, text, role }); return; }   // (a failed text is put back by render)
    local.busy = true; render(true); let judge = null;
    try { const v = await Promise.race([sampleApi.json(L.judgePrompt(st, text), { modelTier: 'quick' }), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 6000))]);
      if (v && typeof v.ok === 'boolean') judge = { ok: v.ok, reason: String(v.reason || '').slice(0, 30), reaction: String(v.reaction || '').slice(0, 40), by: 'ai' }; } catch (err) { judge = null; }
    local.busy = false; local.kaigiText = '';
    net.act(judge ? { t: 'kaigi_submit', step, text, judge, role } : { t: 'kaigi_propose', step, text, role }); return; }
  if (d.a === 'skip') { local.help = false; net.act({ t: 'skip', job: sceneName }); return; }
}
for (const id of ['work', 'brief', 'tr']) $(id).addEventListener('click', onAct);
$('work').addEventListener('input', e => { if (e.target.id === 'kt') local.kaigiText = e.target.value; });
$('work').addEventListener('change', e => { const d = e.target.dataset; if (d.dict !== undefined) local.dict[d.dict] = e.target.value; if (d.other) { local.other[d.other] = e.target.value; } });

// ---------------------------------------------------------------- end + survey
const mmss = ms => `${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
function renderEnd() {
  const s = net.state, me = net.role;
  const LOGN = { tut: '研修', kousin0: '交信室の練習', kousin: '交信室', bunki0: '分岐路の練習', bunki: '分岐路', kaigi0: '和平会議の練習', kaigi: '和平会議' };
  const J = s.jobs, res = k => J[k].status === 'done' ? '完了' : 'スキップ';
  const Q = [['again', 'またこのふたりで遊びたい？'], ['talk', '伝え合うのは楽しかった？'], ['tired', '途中で疲れた・つまらなくなった？']];
  const mine = s.survey[me] || local.survey;
  let h = `<div class="grid2" style="align-items:start"><div><h2>本日の業務、おつかれさまでした</h2>
    <div style="color:var(--mut);margin-bottom:4px">${esc(s.names.A)} と ${esc(s.names.B)}　・　${mmss(s.finishedAt - s.startedAt)}${s.survey.A && s.survey.B ? '　<b style="color:var(--green)">回答がそろいました。スクショしてね</b>' : ''}</div>
    ${card('', '', `交信室：${res('kousin')}（失敗 ${J.kousin.misses}回）<br>分岐路：${res('bunki')}（失敗 ${J.bunki.misses}回）<br>和平会議：${res('kaigi')}（言い直し ${J.kaigi.fails}回）`)}
    <div style="height:4px"></div>${card('', 'かかった時間', s.log.map(x => `${LOGN[x.k] || x.k} ${mmss(x.t)}`).join(' → '))}
    ${me === 'A' || net.solo ? '<button class="btn" style="margin-top:6px" data-q="again-run">新しい業務で、もう一度</button>' : ''}</div><div>
    ${card('', 'ひとことアンケート', Q.map(([k, q]) => `<div class="srow"><span>${q}</span><span class="ans">${['はい', 'いいえ'].map(a => `<button class="btn sm ${mine[k] === a ? 'on' : ''}" data-q="${k}|${a}">${a}</button>`).join('')}</span></div>`).join('')
      + `<div style="font-size:14px;margin-top:4px">いちばん面白かった仕事は？</div><div class="grid3" style="margin-top:3px">${L.JOBS.map(k => `<button class="btn sm ${mine.best === k ? 'on' : ''}" data-q="best|${k}">${NAMES[k]}</button>`).join('')}</div>`)}`;
  $('endbody').innerHTML = `<div class="fit">${h}</div></div></div>`;
}
$('endbody').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const d = b.dataset.q; if (!d) return;
  if (d === 'again-run') { net.act({ t: 'again' }); return; }      // both phones reset themselves when they see the new run (syncLocal)
  const [k, a] = d.split('|'), r = net.role, cur = { ...(net.state.survey[r] || local.survey), [k]: a };
  local.survey = cur; net.act({ t: 'survey', ans: cur, role: r });
});

// ---------------------------------------------------------------- loop
const step = controls(frame, cam, () => sc, view);
const clock = new THREE.Clock(); let last = 0;
function tick() {
  const t = clock.getElapsedTime(), dt = Math.min(0.05, t - last), s = net.state; last = t;
  if (sceneName === 'title') view.yaw = 0.9 + t * 0.03;
  const hidden3d = (frame.classList.contains('working') && !frame.classList.contains('talking') && performance.now() - workSince > 1400) || frame.classList.contains('ended');
  sc.update(t); step(dt, t); view.apply(); lockTick(s);
  if (marker && s) { const n = nextJob(s), j = n && plaza.JOBS.find(j => j.key === n); marker.visible = !!j;
    if (j) { marker.position.set(Math.cos(j.ang) * 15.4, 0, Math.sin(j.ang) * 15.4); marker.userData.cone.position.y = 4.2 + Math.sin(t * 4) * 0.4; marker.rotation.y = t; } }
  if (!hidden3d) { R.render(S, cam); tags(); talkPlace(); }
  if (sc.player) { net.move(sceneName, sc.player.position.x, sc.player.position.z, sc.player.rotation.y);
    if (!local.walked && sceneName === 'plaza' && local.walk0 && sc.player.position.distanceTo(local.walk0) > 2) { local.walked = true; local.walkedAt = performance.now(); } }
  if (sc.other) { const p = net.partner, here = !net.solo && p && p.scene === sceneName;
    sc.other.visible = !!here; if (here) { sc.other.position.x += (p.x - sc.other.position.x) * Math.min(1, dt * 8); sc.other.position.z += (p.z - sc.other.position.z) * Math.min(1, dt * 8);
      const gy = sc.walk?.ground?.(sc.other.position.x, sc.other.position.z); sc.other.position.y = gy ?? sc.other.position.y; sc.other.rotation.y = p.ry; } }
  render(false);
  requestAnimationFrame(tick);
}
layout(); loadScene('title'); tick();
document.fonts && document.fonts.ready.then(() => fitAll());
window.__local = local; window.__fit = fitAll;
window.__net = net; window.__L = L;
