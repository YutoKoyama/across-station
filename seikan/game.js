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
function shrink(el, availW, availH, min = 0.74) {
  if (!el) return 1; el.style.zoom = 1;
  const w = el.scrollWidth, h = el.scrollHeight; if (!w || !h) return 1;
  const z = Math.max(min, Math.min(1, availW / w, availH / h)); el.style.zoom = z < 0.995 ? z.toFixed(3) : 1; return z;
}
function fitAll() {
  if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName) && frame.classList.contains('working')) return;   // the keyboard is up: keep the layout, let it scroll
  const W = frame.clientWidth, H = frame.clientHeight, tb = $('topbar');
  if (tb.offsetParent) { tb.style.zoom = 1; const avail = tb.clientWidth; const need = [...tb.children].reduce((a, c) => a + (c.id === 'goal' ? 210 : c.scrollWidth) + 8, 0);
    tb.style.zoom = need > avail ? Math.max(0.8, avail / need).toFixed(3) : 1; }
  if (tb.offsetParent) { const r = tb.getBoundingClientRect(); frame.style.setProperty('--wt', Math.round((window.__rotated ? r.width : r.height) + 12) + 'px'); }
  for (const id of ['wl', 'wr']) { const pane = $(id), f = pane.firstElementChild; if (pane.offsetParent && f) shrink(f, pane.clientWidth, pane.clientHeight - 2); }
  const eb = $('endbody'); if (eb.offsetParent && eb.firstElementChild) shrink(eb.firstElementChild, eb.clientWidth, eb.clientHeight - 2, 0.66);
  const lb = $('lobby'); if (lb.offsetParent) { lb.style.zoom = 1; const z = Math.min(1, (H - 16) / lb.offsetHeight, (W * 0.52) / lb.offsetWidth); lb.style.zoom = z < 0.995 ? Math.max(0.6, z).toFixed(3) : 1; }
  const lg = $('logo'); if (lg.offsetParent) { lg.style.zoom = 1; const lbr = lb.getBoundingClientRect(), lgr = lg.getBoundingClientRect(), room = (window.__rotated ? lbr.top - lgr.top : lbr.left - lgr.left) - 14; const z = Math.min(1, room / lg.scrollWidth); lg.style.zoom = z < 0.995 ? z.toFixed(3) : 1; }
  const bx = $('brief').querySelector('.box'); if (bx && $('brief').classList.contains('on')) shrink(bx, W * 0.92, H - 16, 0.6);
  const st = $('intro').querySelector('.stage'); if ($('intro').classList.contains('on')) { $('intro').style.zoom = 1; const z = Math.min(1, (H - 8) / 380, (W - 16) / 520); $('intro').style.zoom = z < 0.995 ? z.toFixed(3) : 1; }
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
  walked: false, walk0: null, sceneAt: 0, lastSig: '', lastChange: 0 };
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
$('introGo').addEventListener('click', () => { clearInterval(introT); $('intro').classList.remove('on'); local.introSeen = true; });

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
  if (sceneName === 'kousin') return j.stage === 0 ? (me === 'A' ? '2つの言葉の意味を、相棒に聞こう' : 'しぐさを伝え、返事の言葉を教えよう') : (me === 'A' ? '相棒と解読して、返事を3語で組もう' : 'しぐさと返事の内容を、相棒に伝えよう');
  if (sceneName === 'bunki') return '案内人に聞き、相棒と同じ安全な扉を選ぼう';
  if (sceneName === 'kaigi') { const st = L.KAIGI[j.step]; return me === L.hearerOf(st) ? '発言の本当の意味を、相棒に声で伝えよう' : '聞いた意味を、禁句を使わずに訳そう'; }
  return '';
}
const BADGE = { ans: 'あなたが答える', sup: '相棒をサポート', both: 'ふたりで答える' };
function roleOf(s, me) {
  if (sceneName === 'office') { const T = s.tut; if (T.step >= 2) return null;
    return me === L.tutViewer(T.step) ? { k: 'sup', t: '相棒に「封筒は何色？」が出ている。色を教えよう' } : { k: 'ans', t: '問題：封筒は何色？ 相棒に聞いて、同じ色を押そう' }; }
  const j = s.jobs[sceneName]; if (!j || j.status !== 'todo' || !partnerHere()) return null;
  if (sceneName === 'kousin') return me === 'A' ? { k: 'ans', t: j.stage === 0 ? '問題：使者への返事は、2つの言葉のどっち？' : '問題：使者の問いかけに、3語で返事を組もう' }
    : { k: 'sup', t: j.stage === 0 ? '相棒が返事の言葉を選ぶ。しぐさと返事の意味を教えよう' : '相棒が返事を組む。返事の中身としぐさを教えよう' };
  if (sceneName === 'bunki') return { k: 'both', t: '問題：安全な扉は1〜3番のどれ？ 案内人に聞いて、同じ扉を選ぼう' };
  if (sceneName === 'kaigi') { const st = L.KAIGI[j.step];
    return me === L.writerOf(st) ? { k: 'ans', t: `問題：${L.CULTURE[st.from].boss}の発言を、${L.CULTURE[st.to].name}を怒らせずに訳そう` } : { k: 'sup', t: `相棒が訳を書く。${L.CULTURE[st.from].boss}の発言の意味を教えよう` }; }
  return null;
}
const HINT = {
  kousin0: { A: '相棒に「1つ目と2つ目のしぐさは？」と聞いてみよう', B: 'しぐさを順に読み上げ、「返事は何番目の言葉」と伝えよう' },
  kousin1: { A: '2つの文に出てくる同じ言葉を探し、相棒のしぐさと比べよう', B: '同じしぐさが出てくる文を伝えよう。相棒の言葉にも同じ語があるはず' },
  bunki0: { A: '案内人に「安全な扉は？」と聞き、答えを相棒に伝えよう', B: '案内人に「安全な扉は？」と聞き、答えを相棒に伝えよう' },
  bunki1: { A: '4人全員に扉を聞こう。答えが割れたら、相棒が決まりで見分ける', B: '4人の答えを集めよう。ずれ方の決まりで、どちらが本当か分かる' },
  kaigiH: 'メモで言い回しを読み替えて、意味をふつうの言葉で伝えよう', kaigiW: '相棒から聞いた意味を、赤い禁句を使わずに書こう',
};
function hintText(s, me) {
  const j = s.jobs[sceneName]; if (!j || j.status !== 'todo' || !partnerHere()) return '';
  if (sceneName === 'kaigi') return me === L.hearerOf(L.KAIGI[j.step]) ? HINT.kaigiH : HINT.kaigiW;
  return HINT[sceneName + j.stage]?.[me] || '';
}

// ---------------------------------------------------------------- render
let lastKey = '';
function toast(t, ms = 2600) { const e = $('toast'); e.textContent = t; e.classList.add('on'); clearTimeout(toast.t); toast.t = setTimeout(() => e.classList.remove('on'), ms); }
function render(force) {
  const s = net.state, me = net.role, now = performance.now();
  const sig = [s?.v, s?.seed, sceneName, me, partnerHere()].join('|'); if (sig !== local.lastSig) { local.lastSig = sig; local.lastChange = now; }
  const stuck = now - local.lastChange > 30000;
  const ended = !!s && s.phase === 'end' && sceneName !== 'title';
  const working = !!s && !ended && ['office', 'kousin', 'bunki', 'kaigi'].includes(sceneName);
  const coach = sceneName === 'plaza' ? (!local.walked ? 1 : now - local.walkedAt < 6000 ? 2 : 0) : 0;
  const key = JSON.stringify([s?.v, s?.seed, me, sceneName, partnerHere(), net.partner?.scene, net.partner?.name, lobby, local.reply, local.busy, local.survey, ended, local.asking, local.listening, !!dictApi, local.tab, local.briefSeen, local.help, stuck, coach, local.other]);
  if (!force && key === lastKey) return; lastKey = key;
  if (working && !frame.classList.contains('working')) workSince = now;
  frame.classList.toggle('working', working); frame.classList.toggle('ended', ended); window.__freeze = working || ended;
  if (sceneName === 'title') { renderLobby(); fitAll(); return; }
  if (!s) return;
  // top bar
  $('role').innerHTML = `<i style="background:${ROLE[me].css}">${me}</i>あなた＝${esc(nameOf(s, me))}`;
  const ro = working ? roleOf(s, me) : null, gl = $('goal');
  gl.className = 'plate ' + (ro ? ro.k : '');
  const hint = working && stuck && sceneName !== 'office' ? hintText(s, me) : '';
  gl.innerHTML = ro ? `<span class="badge ${ro.k}">${BADGE[ro.k]}</span><span><span class="gt">${esc(ro.t)}</span>${hint ? `<span class="hintline">ヒント：${esc(hint)}</span>` : ''}</span>` : `<small>いまの目標</small><span>${esc(ended ? 'おつかれさまでした' : goalText(s, me))}</span>`;
  const other = me === 'A' ? 'B' : 'A', p = net.partner;
  const chip = net.solo ? `<button class="btn" data-a="swap">${other}の画面を見る</button>` : `<i style="background:${ROLE[other].css}">${other}</i>${esc(nameOf(s, other))}<em>${p ? NAMES[p.scene] || '' : '未接続'}</em>`;
  let tr = chip;
  if (sceneName === 'plaza' && nextJob(s)) tr += `<button class="btn" data-a="warp">歩かずに入る</button>`;
  if (working && sceneName !== 'office') tr = (sceneName === 'kaigi' && s.jobs.kaigi.status === 'todo' && !L.KAIGI[s.jobs.kaigi.step].practice ? `<span>緊張度 ${s.jobs.kaigi.tension}%</span><span class="bar"><i style="width:${s.jobs.kaigi.tension}%"></i></span>` : '') + (net.solo ? chip : '') + `<button class="btn" data-a="help">？</button><button class="btn" data-a="plaza">広場へ</button>`;
  $('tr').innerHTML = tr;
  const co = $('coach'); co.classList.toggle('on', coach > 0); co.textContent = coach === 1 ? '← なぞって歩く' : 'なぞって見回す'; $('stick').classList.toggle('guide', coach === 1);
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
      <button class="btn main ${lr ? '' : 'guide'}" data-l="create">部屋をつくる</button>
      <div class="row"><input id="code" inputmode="numeric" maxlength="4" placeholder="コード4桁"><button class="btn" data-l="join">参加する</button></div>
      <button class="btn sm" data-l="solo">ひとりで試す</button>
      ${lobby.err ? `<div class="msg bad">${esc(lobby.err)}</div>` : `<div class="note">通話しながら遊びます</div>`}`;
  } else { const p = net.partner;
    el.innerHTML = `<div class="note">${net.role === 'A' ? 'このコードを相手に伝えよう' : '参加しました'}</div><div class="code">${esc(net.code)}</div>
      <div class="msg ${p ? 'ok' : net.status === 'noroom' || net.status === 'busy' ? 'bad' : 'wait'}">${p ? `${esc(p.name || '相手')}さんが来ました` : net.status === 'noroom' ? 'その部屋が見つかりません。コードを確かめよう（自動で探し続けます）' : net.status === 'busy' ? '部屋を準備しています…' : '相手を待っています…'}</div>
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

// ---------------------------------------------------------------- work screens (full-screen 2D)
// what to do first + the rules, shown when you first walk into a base (and again from "？")
const BRIEF = {
  kousin: { goal: '使者の言葉を解読して、正しく返事をする',
    A: { k: 'ans', first: ['使者の言葉（あなたにだけ聞こえる）を見る', '相棒に、しぐさと返事の中身を聞く', '言葉を選んで「返事する」'] },
    B: { k: 'sup', first: ['使者のしぐさ（あなたにだけ見える）を見る', 'しぐさと、返事の中身を相棒に話す', '相棒が正しく返事できたら成功'] },
    rules: ['言葉が聞こえるのは片方、しぐさが見えるのはもう片方', '同じ言葉は、同じしぐさと同じ意味', '返事を決めて押すのは回答役だけ'],
    prac: 'まず練習：2つの言葉から1つ選ぶだけ' },
  bunki: { goal: 'ふたりで同じ「安全な扉」を選んで、次の階へ',
    A: { k: 'both', first: ['案内人（ペロ・ミミ）に「安全な扉は？」と聞く', '答えを相棒に伝え、相棒の答えも聞く', 'ふたりで同じ扉を押す'] },
    B: { k: 'both', first: ['案内人（ゴウ・ナナ）に「安全な扉は？」と聞く', '答えを相棒に伝え、相棒の答えも聞く', 'ふたりで同じ扉を押す'] },
    rules: ['案内人は4人。半分ずつ、別々の人に質問できる', '本番の階には、うそつきがいる', 'うその見分け方は、ゴウ・ナナ側の画面にだけ出る'],
    prac: 'まず練習：うそつきのいない階で、扉を選ぶ' },
  kaigi: { goal: '両族の発言を訳して、会談をまとめる',
    A: { k: 'swap', first: ['発言の主と同じ族の人が、意味を説明する（サポート役）', 'もう片方が、相手の族向けに訳を書く（回答役）', '議題ごとに役が交代する'] },
    B: { k: 'swap', first: ['発言の主と同じ族の人が、意味を説明する（サポート役）', 'もう片方が、相手の族向けに訳を書く（回答役）', '議題ごとに役が交代する'] },
    rules: ['言い回しの意味を知っているのはサポート役だけ', '禁句を知っているのは回答役だけ。訳に入れると怒る', '伝わらないと緊張度が上がり、100%で決裂'],
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
  const B = BRIEF[sceneName], show = B && s.jobs[sceneName].status === 'todo' && partnerHere() && (local.help || !local.briefSeen[sceneName]), br = $('brief');
  br.classList.toggle('on', !!show);
  if (show) { const M = B[me], rb = RB[M.k];
    br.innerHTML = `<div class="box plate"><h2>${NAMES[sceneName]}　${JOBSUB[sceneName]}</h2><p>目標：${B.goal}</p>
      <div class="cols"><div><span class="rb ${rb[0]}">${rb[1]}</span><h3>まずやること</h3><ol>${M.first.map(x => `<li>${x}</li>`).join('')}</ol></div>
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
const lives = n => `<span class="lives">${'●'.repeat(3 - n)}${'○'.repeat(n)}</span>`;
function kousinWork(s, me) {
  const j = s.jobs.kousin, p = L.kousinNow(s), w = k => p.words[k];
  const known = {}; if (j.stage === 1) for (const k of p.teach.order) known[w(k)] = L.CONCEPTS[k].ja;
  const memo = x => known[x] || local.dict[x] || '';
  const al = k => `<span class="alien" style="display:inline-block;margin-right:14px">${w(k)}<small>${esc(memo(w(k))) || '　'}</small></span>`;
  if (j.stage === 0) {
    const fb = j.last === 'teach_miss' ? `<div class="msg bad">使者は首をかしげた。相棒にもう一度聞こう</div>` : '';
    if (me === 'A') return { L: card('mine', MINE + '：使者の言葉', rows(p.teach.order.map(k => `<span class="alien">${w(k)}</span>`))),
      R: fb + card('q', '<span class="pbadge">練習</span>問題：使者への返事は、どっちの言葉？', `<div class="tiles">${p.teach.order.map(k => `<button class="tile ${local.reply[0] === k ? 'on' : local.reply.length ? '' : 'guide'}" data-tile="${k}"><span class="alien">${w(k)}</span></button>`).join('')}</div>`) + `<button class="btn main ${local.reply.length === 1 ? 'guide' : ''}" data-a="ksend" ${local.reply.length === 1 ? '' : 'disabled'}>返事する</button>` };
    return { L: card('mine', MINE + '：使者のしぐさ', rows(p.teach.order.map(k => L.CONCEPTS[k].gesture))),
      R: fb + card('sup', 'あなたはサポート役', `相棒が、返事の言葉を2つから選ぶ。<br>返事は<b>「${L.CONCEPTS[p.teach.target].ja}」</b>の言葉。<b>何番目か</b>教えよう`) };
  }
  const fb = j.last === 'teach_ok' ? `<div class="msg ok">通じた！ 次は3語で返事</div>` : j.last === 'miss' ? `<div class="msg bad">通じなかった。並べ方を確かめよう</div>` : j.last === 'reset' ? `<div class="msg bad">使者が交代した。言葉も新しくなった</div>` : '';
  const left = j.misses % 3;
  if (me === 'A') {
    const uniq = [...new Set(p.lines.flat().concat(p.question).map(w))].filter(x => !known[x]);
    const tabs = '', head = (t, other) => `<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><small style="flex:1;font-size:12px;font-weight:800;color:var(--amber)">${t}</small><button class="btn sm" data-tab="${other}">${other === 'memo' ? '意味メモ' : '返事にもどる'}</button></div>`;
    const body = local.tab === 'memo'
      ? card('q', '', head('意味のメモ（自分用）', 'reply') + `<div class="dictrow">${uniq.map(x => `<span class="alien">${x}</span><select data-dict="${x}"><option value="">？</option>${Object.values(L.CONCEPTS).map(c => `<option ${local.dict[x] === c.ja ? 'selected' : ''}>${c.ja}</option>`).join('')}</select>`).join('')}</div>`)
      : card('q', '', head(`問題：3語で返事　のこり ${lives(left)}`, 'memo') + `<div class="tiles">${p.tiles.map(k => `<button class="tile ${local.reply.includes(k) ? 'on' : ''}" data-tile="${k}"><span class="alien">${w(k)}<small>${esc(memo(w(k))) || '　'}</small></span></button>`).join('')}</div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:8px"><span class="alien" style="flex:1;color:var(--amber);font-size:17px">${local.reply.map(w).join(' ') || '返事：……'}</span><button class="btn sm" data-a="kclear">消す</button><button class="btn main sm ${local.reply.length === 3 ? 'guide' : ''}" data-a="ksend" ${local.reply.length === 3 ? '' : 'disabled'}>伝える</button></div>`);
    return { L: card('mine', MINE + '：使者の言葉', '' + p.lines.map((l, i) => `<div class="rowline"><b>${i + 1}</b><span>${l.map(al).join('')}</span></div>`).join('') + `<div class="rowline"><b style="background:var(--amber);color:#1a1300">問</b><span>${p.question.map(al).join('')}</span></div>`), R: fb + tabs + body };
  }
  return { L: card('mine', MINE + '：使者のしぐさ（順番はバラバラ）', '' + p.gestures.slice(0, 3).map((g, i) => `<div class="rowline"><b>${i + 1}</b><span>${g.map(k => L.CONCEPTS[k].gesture).join('　／　')}</span></div>`).join('') + `<div class="rowline"><b style="background:var(--amber);color:#1a1300">問</b><span>${p.gestures[3].map(k => L.CONCEPTS[k].gesture).join('　／　')}</span></div>`),
    R: fb + card('sup', `あなたはサポート役　（相棒ののこり ${lives(left)}）`, `相棒が返事を3語で組む。教えること：<br>① 返事の中身は<b>「わたし」「食べ物」「あげる」</b><br>② 左のしぐさで、言葉の意味と並び順`) };
}

// 分岐路 ---------------------------------------------------------------
function bunkiWork(s, me) {
  const j = s.jobs.bunki, p = L.bunkiNow(s), o = me === 'A' ? 'B' : 'A';
  const names = a => a.map(g => L.GUIDES[g].name).join('と');
  const fb = !j.last ? '' : j.last.k === 'teach_ok' ? `<div class="msg ok">開いた！ 次の階は、うそつきがいる</div>` : j.last.k === 'teach_miss' ? `<div class="msg bad">行き止まり。答えを確かめよう</div>`
    : j.last.k === 'miss' ? `<div class="msg bad">行き止まり。うそつきは${names(j.last.liars)}、正解は${j.last.safe}番だった。新しい階へ</div>` : '';
  let Lh = '';
  for (const g of Object.keys(L.GUIDES).filter(g => L.GUIDES[g].who === me)) {
    const asked = j.asked[g] || [], left = 3 - asked.length, others = Object.keys(L.GUIDES).filter(x => x !== g), sel = local.other[g] || others[0];
    Lh += card('mine', `${L.GUIDES[g].name}に質問（のこり${left}回）`,
      asked.map(a => `<div class="rowline"><b>答</b><span>${esc(a.ans)}</span></div>`).join('') + (local.asking === g ? `<div class="msg wait">考えています…</div>` : '')
      + (left > 0 ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px"><button class="btn sm ${asked.length ? '' : 'guide'}" data-ask="${g}|door">安全な扉は？</button>${j.stage === 1 ? `<span style="display:inline-flex;gap:4px"><select data-other="${g}">${others.map(x => `<option value="${x}" ${x === sel ? 'selected' : ''}>${L.GUIDES[x].name}</option>`).join('')}</select><button class="btn sm" data-ask="${g}|honest">は正直？</button></span>` : ''}</div>` : ''));
  }
  const v = j.votes, allAsked = Object.keys(L.GUIDES).filter(g => L.GUIDES[g].who === me).every(g => (j.asked[g] || []).length);
  const Rh = fb + (me === 'B' ? card('sup', MINE + '：この階の決まり（相棒にも教えよう）', L.BUNKI_RULE(p)) : card('wait', '', '<b>うその決まり</b>は相棒が知っている。聞いてみよう'))
    + card('q', `${j.stage === 0 ? '<span class="pbadge">練習</span>' : ''}問題：安全な扉は？（ふたりが同じ扉で決定）`, `<div class="grid3">${[1, 2, 3].map(n => `<button class="btn ${v[me] === n ? 'on' : allAsked && !v[me] ? 'guide' : ''}" data-door="${n}">扉 ${n}</button>`).join('')}</div>
      <div style="margin-top:6px;font-size:14px;color:var(--mut)">${net.solo ? `${o}の選択：${v[o] ? '扉' + v[o] : 'まだ'}` : `${esc(nameOf(s, o))}：${v[o] ? '扉' + v[o] + 'を選んでいる' : 'まだ選んでいない'}`}</div>`);
  return { L: Lh, R: Rh };
}

// 和平会議 -------------------------------------------------------------
function kaigiWork(s, me) {
  const j = s.jobs.kaigi, st = L.KAIGI[j.step], hearer = L.hearerOf(st), cult = Object.values(L.CULTURE).find(c => c.side === me), from = L.CULTURE[st.from], to = L.CULTURE[st.to];
  const hist = j.history.filter(x => !x.broken), last = j.history[j.history.length - 1];
  const res = !last ? '' : last.broken ? `<div class="msg bad">会談が決裂した……。最初の議題からやり直し</div>`
    : `<div class="msg ${last.pass ? 'ok' : 'bad'}">${last.pass ? '伝わった' : '伝わらなかった・もう一度'}（緊張度 ${last.d > 0 ? '+' : ''}${last.d}）<br><span style="font-weight:500">${esc(last.judge.reason || '')}　${esc(last.judge.reaction || '')}</span></div>`;
  const step = `<div style="font-size:12px;color:var(--mut)">${st.practice ? '<span class="pbadge">練習</span>緊張度は上がらない' : `議題 ${j.step} / ${L.KAIGI.length - 1}（緊張度100%で決裂）`}</div>`;
  if (me === hearer) return {
    L: card('mine', `${MINE}：${from.boss}の発言`, `「${esc(st.text)}」`) + card('mine', `${MINE}：言い回しメモ`, cult.idioms.map(([a, b]) => `<div class="rowline"><span>「${a}」＝ <b style="all:unset;font-weight:800;color:var(--mine)">${b}</b></span></div>`).join('')),
    R: res + step + card('sup', 'あなたはサポート役', `相棒が${to.name}向けに訳を書く。<br>左のメモで読み解いて、発言の<b>本当の意味</b>をふつうの言葉で教えよう`) };
  return {
    L: card('q', '問題', `${from.boss}の発言を、${to.name}を怒らせない言葉に訳そう。<br><span style="font-size:14px;color:var(--mut)">発言の意味は相棒が知っている。聞いてみよう</span>`) + card('warn', `${MINE}：${cult.name}の禁句`, `<span style="font-size:26px;font-weight:800;color:var(--red);letter-spacing:.3em">${cult.taboo.join(' ')}</span><br>訳に入れると怒る`),
    R: res + step + `<div style="font-size:13px;font-weight:800;color:var(--amber)">あなたの答え（訳）</div><div style="display:flex;gap:8px;align-items:stretch">${dictApi && !local.noMic ? `<button class="btn ${local.listening ? 'teal' : ''}" data-a="mic" style="flex:none">${local.listening ? '話し終えた' : '声で入力'}</button>` : ''}<textarea id="kt" class="${local.kaigiText ? '' : 'guide'}" rows="2" maxlength="80" placeholder="${cult.name}への訳" style="flex:1"></textarea></div>
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
  if (d.ask) { if (local.asking) return; const [g, q] = d.ask.split('|'), arg = q === 'honest' ? (local.other[g] || Object.keys(L.GUIDES).find(x => x !== g)) : null;
    const fact = L.bunkiFact(L.bunkiNow(s), g, q, arg); let say = null;
    if (sampleApi) { local.asking = g; render(true);
      try { const r = await Promise.race([sampleApi(L.guidePrompt(g, q, arg, fact), { modelTier: 'quick' }), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 5000))]);
        const t = String(r?.text || '').trim().replace(/^「|」$/g, ''); if (t && L.factOk(t, fact)) say = t.slice(0, 80); } catch (err) {}
      local.asking = ''; }
    net.act({ t: 'bunki_ask', guide: g, q, arg, role: me, say }); return; }
  if (d.door) { net.act({ t: 'bunki_vote', door: Number(d.door), role: me }); return; }
  if (d.a === 'mic') { if (local.listening) { try { await dictApi.stop(); } catch (err) {} return; }
    dictApi.start().catch(err => { if (err && err.code === 'not_granted') local.noMic = true; toast('声の入力が使えません。キーボードのマイクか文字で入力してください'); render(true); }); return; }
  if (d.a === 'ksubmit') { if (local.listening) { try { await dictApi.stop(); } catch (err) {} }
    const text = (local.kaigiText || '').trim().slice(0, 80); if (text.length < 2) { toast('訳を書いてください'); return; }
    const j = s.jobs.kaigi, st = L.KAIGI[j.step], step = j.step, to = L.CULTURE[st.to];
    // step 1: the game's own rule (taboo letters). step 2: only then ask the AI whether the meaning got across, with a time limit.
    const taboo = L.tabooIn(st, text); let judge = null;
    if (taboo.length) judge = { ok: false, taboo, reason: `禁句「${taboo.join('」「')}」が入っている`, reaction: `${to.boss}の顔色が変わった！`, by: 'rule' };
    else { local.busy = true; render(true);
      try { if (sampleApi) { const v = await Promise.race([sampleApi.json(L.judgePrompt(st, text), { modelTier: 'quick' }), new Promise((_, rej) => setTimeout(() => rej(new Error('slow')), 6000))]);
          if (v && typeof v.ok === 'boolean') judge = { ok: v.ok, reason: String(v.reason || '').slice(0, 30), reaction: String(v.reaction || '').slice(0, 40), by: 'ai' }; } } catch (err) { judge = null; }
      if (!judge) judge = L.fallbackJudge(st, text);
      local.busy = false; }
    local.kaigiText = ''; net.act({ t: 'kaigi_submit', step, text, judge, role: L.writerOf(st) }); return; }
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
    <div style="color:var(--mut);margin-bottom:6px">${esc(s.names.A)} と ${esc(s.names.B)}　・　${mmss(s.finishedAt - s.startedAt)}</div>
    ${card('', '', `交信室：${res('kousin')}（失敗 ${J.kousin.misses}回）<br>分岐路：${res('bunki')}（失敗 ${J.bunki.misses}回）<br>和平会議：${res('kaigi')}（言い直し ${J.kaigi.fails}回・最終緊張度 ${J.kaigi.tension}%）`)}
    <div style="height:6px"></div>${card('', 'かかった時間（開始からの経過）', s.log.map(x => `${LOGN[x.k] || x.k} ${mmss(x.t)}`).join('　→　'))}
    ${me === 'A' || net.solo ? '<button class="btn" style="margin-top:8px" data-q="again-run">新しい業務で、もう一度</button>' : ''}</div><div>
    ${card('', 'ひとことアンケート', Q.map(([k, q]) => `<div>${q}</div><div class="ans">${['はい', 'いいえ'].map(a => `<button class="btn sm ${mine[k] === a ? 'on' : ''}" data-q="${k}|${a}">${a}</button>`).join('')}</div>`).join('')
      + `<div>いちばん面白かった仕事は？</div><div class="ans">${L.JOBS.map(k => `<button class="btn sm ${mine.best === k ? 'on' : ''}" data-q="best|${k}">${NAMES[k]}</button>`).join('')}</div>`)}`;
  if (s.survey.A && s.survey.B) h += `<div class="msg ok" style="margin-top:6px">ふたりとも回答しました。この画面をスクショして送ってください。</div>` + ['A', 'B'].map(r => `<div style="font-size:13px">${esc(s.names[r])}：また遊びたい ${s.survey[r].again || '－'}／楽しい ${s.survey[r].talk || '－'}／疲れた ${s.survey[r].tired || '－'}／一番 ${NAMES[s.survey[r].best] || '－'}</div>`).join('');
  $('endbody').innerHTML = `<div class="fit">${h}</div></div></div>`;
}
$('endbody').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const d = b.dataset.q; if (!d) return;
  if (d === 'again-run') { net.act({ t: 'again' }); local.briefSeen = {}; local.dict = {}; window.__goScene('office'); return; }
  const [k, a] = d.split('|'), r = net.role, cur = { ...(net.state.survey[r] || local.survey), [k]: a };
  local.survey = cur; net.act({ t: 'survey', ans: cur, role: r });
});

// ---------------------------------------------------------------- loop
const step = controls(frame, cam, () => sc, view);
const clock = new THREE.Clock(); let last = 0;
function tick() {
  const t = clock.getElapsedTime(), dt = Math.min(0.05, t - last), s = net.state; last = t;
  if (sceneName === 'title') view.yaw = 0.9 + t * 0.03;
  const hidden3d = (frame.classList.contains('working') && performance.now() - workSince > 1400) || frame.classList.contains('ended');
  sc.update(t); step(dt, t); view.apply();
  if (marker && s) { const n = nextJob(s), j = n && plaza.JOBS.find(j => j.key === n); marker.visible = !!j;
    if (j) { marker.position.set(Math.cos(j.ang) * 15.4, 0, Math.sin(j.ang) * 15.4); marker.userData.cone.position.y = 4.2 + Math.sin(t * 4) * 0.4; marker.rotation.y = t; } }
  if (!hidden3d) { R.render(S, cam); tags(); }
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
