// ---------- content: the pack (story, rooms, wording) + the look (theme) ----------
// The code is the shared engine; a different title = a different pack, same engine (www/packs/<id>/pack.json).
// Fills G with: STAGE, T (pack text), UI (screen wording), THEME (look), fmt, clean.

export const fmt = (s, v) => String(s).replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ''));

// UI wording comes from the pack (text.ui) so a title can reword or translate it; these are only fallbacks for older packs
const UI_FALLBACK = {"hintDoor": "タップで「{room}」へ", "hintTurn": "スマホをハンドルのように回す（いま「{sym}」）", "hintNoPower": "（まだ電源が入っていない）", "hintLocked": "（固定されている）", "noticeNoSensor": "スマホの向きのセンサーから値が届きません。画面をなぞって見回すモードに切り替えました。", "noticeRest": "15分たちました。目や気分が疲れていたら、少し休憩しましょう。", "noticePeerLeft": "{other}との通信が切れました。相手がもう一度参加すると続きから遊べます。", "noticeSent": "送信：「{text}」", "onlineRelayDown": "PCの中継につながりません（06_online_play.cmd を起動しているか確認）", "onlineWaiting": "ルームコード {code}　相手の参加を待っています…", "onlineJoining": "ルーム {code} に参加中…", "onlineNeedCode": "4桁のルームコードを入れてください", "pauseTitle": "一時停止中", "starsLabel": "星の流れ：{v}", "touchLabel": "指で見回す：{v}", "on": "オン", "off": "オフ", "onlineIntroPeer": "オンラインで2人で遊ぶ：片方が「部屋を作る」を押し、表示された4桁のコードをもう片方に伝えて「参加」", "onlineIntroRelay": "オンラインで2人で遊ぶ（PCで 06_online_play.cmd を起動）", "onlineNoBroker": "オンラインの仲介につながりません。ネット接続を確かめて、もう一度試してください", "onlineNoRoom": "そのルームコードの部屋が見つかりません。コードを確かめてください", "volumeLabel": "音量", "ambienceLabel": "環境音（部屋のうなり・空調）：{v}"};

async function loadStage() {
  const id = (new URLSearchParams(location.search).get('pack') || 'shizuku').replace(/[^\w-]/g, '');
  const r = await fetch(`packs/${id}/pack.json?v=202611121553`);
  if (!r.ok) throw new Error('content pack not found: ' + id);
  return r.json();
}

export async function loadContent(G, THREE, lookModule) {
  const STAGE = await loadStage();
  window.__appStage = 'stage loaded';
  const T = STAGE.text;
  // ---------- look: the pack names an engine theme (www/themes/<id>): art, light, UI and sound ----------
  const THEME = await lookModule.loadTheme(THREE, STAGE.theme || 'tomoshibi');
  window.__appStage = 'theme loaded';
  document.body.classList.add('look-new');
  // art guide: no emoji on screen (pack texts may still contain some)
  const clean = s => String(s).replace(/[\u{1F000}-\u{1FAFF}]\uFE0F?|[\u23F8-\u23FA\u2699\u2705\u274C\u2714]\uFE0F?/gu, '').replace(/^\s+/, '');
  // texts of the start / ending screens come from the pack
  document.getElementById('startTitle').textContent = STAGE.title;
  {
    const b = document.createElement('div'); b.className = 'brand';
    b.innerHTML = `<span class="mark"></span><span class="series"></span><span class="vol"></span>`;
    b.querySelector('.series').textContent = THEME.ui.logo; b.querySelector('.vol').textContent = THEME.ui.seriesLabel;
    document.getElementById('startTitle').before(b);
  }
  document.getElementById('startStory').textContent = STAGE.intro.story;
  document.getElementById('startHowto').textContent = STAGE.intro.howto;
  document.getElementById('doneTitle').textContent = clean(STAGE.ending.title);
  document.getElementById('doneText').textContent = STAGE.ending.text;
  document.title = `${THEME.ui.logo} ― ${STAGE.title}`; // e.g. "ACROSS ― 回る宇宙ステーション（仮）"
  const UI = Object.assign({}, UI_FALLBACK, T.ui || {});
  Object.assign(G, { STAGE, T, UI, THEME, fmt, clean, DIR_NAME: STAGE.directions });
}
