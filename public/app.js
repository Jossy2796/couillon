'use strict';
// app.js — Client für das Couillon-Kartenspiel.

const RANK_DISPLAY = { '9': '9', T: '10', J: 'B', Q: 'D', K: 'K', A: 'A' };
const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };
const SUIT_NAMES = { S: 'Pik', H: 'Herz', D: 'Karo', C: 'Kreuz' };
const isRed = s => s === 'H' || s === 'D';
// Trumpf inkl. Sonder-Damen (muss zur Server-Logik passen).
function isTrumpCard(card, trump, mit) {
  if (!trump) return false;
  if (card === 'QC') return true;
  if (card === 'QS') return !!mit || trump === 'S';
  return card[1] === trump;
}
// Spielrichtung im Uhrzeigersinn: nächster Spieler (rel 1) sitzt links,
// Partner (rel 2) oben, danach rechts (rel 3). Ablauf: unten → links → oben → rechts.
const REL_CONTAINER = { 0: 'self', 1: 'left', 2: 'top', 3: 'right' };

// ---- Identität & Speicher ----
function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}
let playerId = localStorage.getItem('couillon_pid');
if (!playerId) { playerId = uuid(); localStorage.setItem('couillon_pid', playerId); }
let playerName = localStorage.getItem('couillon_name') || '';

// ---- DOM ----
const $ = id => document.getElementById(id);
const screens = { home: $('home'), lobby: $('lobby'), game: $('game') };
function showScreen(name) {
  for (const k in screens) screens[k].classList.toggle('hidden', k !== name);
}

// ---- WebSocket mit Auto-Reconnect ----
let ws = null;
let roomToRejoin = null;
let lastState = null;
let sendQueue = [];
let reconnectDelay = 500;
let prevPhase = null;   // für die Austeil-Animation
let dealTimer = null;
let muckAsked = false;  // "Abwerfen?"-Frage in dieser Runde bereits beantwortet
let prevKnocks = 0;     // für den Klopf-Hinweis
let countdownTimer = null;  // lokaler Ticker für den Zug-Countdown
let countdownEndAt = 0;     // Zeitpunkt (ms), zu dem der Bot übernimmt

// Foto-Kartengeberin: 60 WebP-Frames, ~55ms je Frame (~18 fps) = ein flüssiger
// Durchlauf in ~3,3s. Hintergrund transparent (auf dem Tisch), weiße Schleier entfernt.
const DEALER_FRAMES = Array.from({ length: 60 }, (_, i) => `dealer/dealer_frame_${String(i + 1).padStart(3, '0')}.webp`);
const DEAL_FRAME_MS = 55;    // Tempo pro Frame
let dealFrames = [];         // vorgeladene Image-Objekte (kein Flackern beim ersten Mal)
let dealFrameTimer = null;
function preloadDealer() { dealFrames = DEALER_FRAMES.map(src => { const im = new Image(); im.src = src; return im; }); }

function wsUrl() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}`;
}
function send(obj) {
  const s = JSON.stringify(obj);
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(s);
  else sendQueue.push(s);
}
function connect() {
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;
  setConn('Verbinde…', '');
  ws = new WebSocket(wsUrl());
  ws.onopen = () => {
    reconnectDelay = 500;
    setConn('Verbunden', 'ok');
    for (const m of sendQueue) ws.send(m);
    sendQueue = [];
    if (roomToRejoin) {
      send({ type: 'joinRoom', code: roomToRejoin, playerId, name: currentName() });
    }
  };
  ws.onmessage = ev => {
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    handleMessage(msg);
  };
  ws.onclose = () => {
    setConn('Verbindung getrennt – neuer Versuch…', 'bad');
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 1.6, 8000);
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
}
function setConn(text, cls) {
  const el = $('connStatus');
  if (el) { el.textContent = text; el.className = 'conn ' + cls; }
}

// ---- Nachrichten ----
function handleMessage(msg) {
  switch (msg.type) {
    case 'joined':
      roomToRejoin = msg.code;
      localStorage.setItem('couillon_room', msg.code);
      break;
    case 'state':
      // Veralteten/fremden Raum-State ignorieren (verhindert, dass nach dem
      // Verlassen kurz die alte Lobby über dem Home-Screen auftaucht).
      if (!roomToRejoin || msg.code !== roomToRejoin) break;
      lastState = msg;
      render(msg);
      break;
    case 'error':
      toast(msg.message);
      if (/nicht gefunden|voll/.test(msg.message)) {
        localStorage.removeItem('couillon_room');
        roomToRejoin = null;
        showScreen('home');
      }
      break;
  }
}

function currentName() {
  return (playerName && playerName.trim()) || 'Spieler';
}

// ================= RENDER =================
function render(s) {
  if (s.phase === 'trump' && prevPhase !== 'trump') {
    playDeal(); // neue Runde -> austeilen
    muckAsked = false; prevKnocks = 0; // Rundenzustände zurücksetzen
    if ((s.history || []).length === 0) announcePartner(s); // erste Runde eines Matches -> Teams zeigen
  }
  prevPhase = s.phase;
  if (s.phase === 'lobby') { showScreen('lobby'); renderLobby(s); }
  else { showScreen('game'); renderGame(s); }
  notifyKnocks(s);
  updateCountdown(s);
  renderOverlays(s);
}

// Sichtbarer Countdown, bis der Bot für DICH übernimmt (kein Überraschungs-Zug mehr).
// Der Server schickt die Restzeit; hier läuft ein lokaler Ticker, damit es flüssig runterzählt.
function updateCountdown(s) {
  const el = $('turnTimer');
  if (s.yourCountdownMs == null) {
    el.classList.add('hidden');
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    return;
  }
  countdownEndAt = Date.now() + s.yourCountdownMs;
  el.classList.remove('hidden');
  const tick = () => {
    const left = Math.max(0, countdownEndAt - Date.now());
    const secs = Math.ceil(left / 1000);
    el.textContent = `⏱ ${secs}s — sonst spielt der Bot`;
    el.classList.toggle('urgent', secs <= 3);
    if (left <= 0 && countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  };
  tick();
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = setInterval(tick, 250);
}

// Kurzer Hinweis, sobald jemand klopft/Re macht (Beschwerde: schlecht erkennbar).
function notifyKnocks(s) {
  const kn = s.knocks || [];
  if (kn.length > prevKnocks) {
    const k = kn[kn.length - 1];
    toast(`🔨 ${seatDisplay(s, k.seat)}: ${k.label}! Spielwert ${k.spielwert}`);
  }
  prevKnocks = kn.length;
}

function announcePartner(s) {
  if (s.you == null || s.you < 0) return;
  const p = s.players[(s.you + 2) % 4];
  if (p && !p.empty) setTimeout(() => toast('🎲 Neue Teams · dein Partner: ' + p.name), 1750);
}

function playDeal() {
  const el = $('dealAnim');
  const img = $('dealerFrame');
  clearTimeout(dealTimer);
  if (dealFrameTimer) { clearInterval(dealFrameTimer); dealFrameTimer = null; }
  let i = 0;
  img.src = DEALER_FRAMES[0];
  el.classList.remove('hidden');
  dealFrameTimer = setInterval(() => {
    i++;
    if (i >= DEALER_FRAMES.length) { clearInterval(dealFrameTimer); dealFrameTimer = null; return; }
    img.src = DEALER_FRAMES[i];
  }, DEAL_FRAME_MS);
  dealTimer = setTimeout(() => {
    el.classList.add('hidden');
    if (dealFrameTimer) { clearInterval(dealFrameTimer); dealFrameTimer = null; }
  }, DEAL_FRAME_MS * DEALER_FRAMES.length + 150);
}

function renderLobby(s) {
  $('roomCode').textContent = s.code;
  const list = $('seatList');
  list.innerHTML = '';
  for (const p of s.players) {
    const row = document.createElement('div');
    row.className = 'seat-row' + (p.empty ? ' empty' : '');
    const dotColor = p.team === 'A' ? 'var(--teamA)' : 'var(--teamB)';
    const tags = [];
    if (!p.empty && p.seat === s.you) tags.push('Du');
    if (!p.empty && p.isBot) tags.push('Bot');
    let right = '';
    if (s.isHost && (p.empty || p.isBot)) {
      right = p.empty
        ? `<button class="btn small" data-addbot="${p.seat}">+ Bot</button>`
        : `<button class="btn small" data-removeseat="${p.seat}">✕</button>`;
    }
    row.innerHTML =
      `<span class="team-dot" style="background:${dotColor}"></span>` +
      `<span class="sname">${p.empty ? 'Frei' : esc(p.name)}</span>` +
      `<span class="stag">${tags.join(' · ')} <small>Team ${p.team}</small></span>` +
      right;
    list.appendChild(row);
  }
  // Bot-Stärke
  const level = s.botLevel || 'medium';
  const descs = {
    easy: 'Leicht: spielt oft zufällig – gut für Einsteiger.',
    medium: 'Mittel: solide, mit Kartengedächtnis.',
    hard: 'Schwer: rechnet voraus (PIMC) – sehr stark.',
  };
  document.querySelectorAll('.lp-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.level === level);
    b.disabled = !s.isHost;
  });
  $('lpDesc').textContent = descs[level];

  $('hostControls').classList.toggle('hidden', !s.isHost);
  $('waitHost').classList.toggle('hidden', s.isHost);
  updateShareButtons();
}

function renderGame(s) {
  // Raumcode klein in der Kopfzeile (zum Nachschauen/Teilen)
  $('roomCodeGame').textContent = '#' + (s.code || '');
  // Kopfzeile (Striche zählen von 13 herunter)
  $('boardA').textContent = s.board.A;
  $('boardB').textContent = s.board.B;
  const sw = $('swChip');
  const inRound = ['trump', 'mit', 'kontra', 'playing'].includes(s.phase);
  sw.textContent = '×' + (s.spielwert || 1);
  sw.classList.toggle('hidden', !inRound || (s.spielwert || 1) <= 1);
  const tb = $('trumpBadge');
  if (s.trump) {
    tb.innerHTML = `<span class="tlabel">TRUMPF</span><span class="tsym">${SUIT_SYMBOLS[s.trump]}</span>`;
    tb.className = 'trump-badge ' + (isRed(s.trump) ? 'red' : 'black');
  } else {
    tb.innerHTML = `<span class="tlabel">TRUMPF</span><span class="tsym">—</span>`;
    tb.className = 'trump-badge none';
  }

  // Sitze
  ['self', 'right', 'top', 'left'].forEach(k => { $('seat-' + k).innerHTML = ''; $('trick-' + k).innerHTML = ''; $('trick-' + k).className = 'trick-slot slot-' + k; });
  for (const p of s.players) {
    if (p.empty) continue;
    const rel = (p.seat - s.you + 4) % 4;
    $('seat-' + REL_CONTAINER[rel]).innerHTML = seatChip(p, s);
  }
  // Aktueller Stich
  for (const t of s.currentTrick) {
    const rel = (t.seat - s.you + 4) % 4;
    const slot = $('trick-' + REL_CONTAINER[rel]);
    const trumpCls = isTrumpCard(t.card, s.trump, s.mit) ? 'trump' : '';
    slot.innerHTML = cardHtml(t.card, trumpCls);
    if (s.trickComplete && t.seat === s.trickWinnerSeat) slot.classList.add('winner');
    else if (!s.trickComplete && t.seat === s.leadingSeat) slot.classList.add('leading');
  }
  // Zentrum-Info
  $('centerInfo').innerHTML = centerInfo(s);

  // Hand
  renderHand(s);
  // Statuszeile
  $('statusBar').innerHTML = statusText(s);
}

function seatChip(p, s) {
  const dot = p.team === 'A' ? 'var(--teamA)' : 'var(--teamB)';
  const badges = [];
  if (p.seat === s.dealerSeat) badges.push('<span class="badge dealer">Geber</span>');
  if (p.seat === s.taker) badges.push('<span class="badge">Trumpf</span>');
  if (s.mit && p.seat === s.qsHolder) badges.push('<span class="badge mit">Mit ♠D</span>');
  const knock = (s.knocks || []).find(k => k.seat === p.seat);
  if (knock) badges.push(`<span class="badge knock">🔨 ${knock.label}</span>`);
  const cls = ['player-chip'];
  // Turn-Markierung nur bei Trumpf/Spiel — NICHT bei "Mit" (Entscheider bleibt verborgen).
  if (p.seat === s.turnSeat && (s.phase === 'trump' || s.phase === 'playing')) cls.push('turn');
  if (!p.connected && !p.isBot) cls.push('disconnected');
  const isSelf = p.seat === s.you;
  const name = isSelf ? 'Du' : esc(p.name);
  const n = s.handCounts[p.seat] || 0;
  let backs = '';
  for (let i = 0; i < n; i++) backs += '<div class="card-back"></div>';
  const dc = (!p.connected && !p.isBot) ? ' 📴' : '';
  // "Bot spielt für mich"-Checkbox direkt rechts neben dem eigenen Namen.
  let ctrl = '';
  if (isSelf && !p.isBot) {
    ctrl = `<label class="assist-toggle" title="Bot spielt für mich"><input type="checkbox" id="assistBox"${p.assist ? ' checked' : ''}><span>🤖</span></label>`;
  }
  // Status-Tag: wer wirft ab / für wen spielt gerade ein Bot.
  let autoTag = '';
  if (p.muck) autoTag = '<span class="auto-tag muck">wirft ab</span>';
  else if (p.auto) autoTag = '<span class="auto-tag">🤖 Bot spielt</span>';
  // Nach automatischer Übernahme: Button zum Selber-Weiterspielen.
  if (isSelf && p.auto && !p.assist && !p.muck) autoTag += ' <button class="btn tiny" id="btnResume">▶ selbst</button>';
  return `<div class="${cls.join(' ')}"><span class="tdot" style="background:${dot}"></span>` +
    `<span class="pname">${name}${dc}</span>${ctrl}</div>` +
    `<div>${badges.join(' ')}${autoTag}</div>` +
    `<div class="mini-cards">${backs}</div>`;
}

function centerInfo(s) {
  if (s.phase === 'trump') return s.canTrump ? 'Trumpf<br>bestimmen' : `${seatDisplay(s, s.turnSeat)}<br>wählt Trumpf…`;
  if (s.phase === 'mit') return s.canMit ? 'Mit?' : 'Entscheidung Mit<br>steht offen';
  if (s.phase === 'kontra') return `${s.kontraLabel || 'Kontra'}?<br>Team ${s.kontraTurn}`;
  if (s.trickComplete) return `${seatDisplay(s, s.trickWinnerSeat)}<br>gewinnt`;
  if (s.currentTrick.length > 0 && s.leadingSeat != null) return `▲ ${seatDisplay(s, s.leadingSeat)}<br>führt`;
  return `Stich ${Math.min((s.trickCount || 0) + 1, 6)}/6`;
}

function statusText(s) {
  if (s.phase === 'trump') {
    return s.canTrump ? '▶ Du bestimmst den Trumpf' : `${seatDisplay(s, s.turnSeat)} bestimmt den Trumpf…`;
  }
  if (s.phase === 'mit') {
    return s.canMit ? '▶ Du: Pik-Dame ansagen (Mit)?' : 'Entscheidung über die Mit steht offen…';
  }
  if (s.phase === 'kontra') {
    if (s.canKontra) return `▶ Team ${s.kontraTurn}: ${s.kontraLabel}?`;
    if (s.kontraPassed) return 'Du hast gepasst — warte auf deinen Mitspieler…';
    return `Team ${s.kontraTurn} überlegt (${s.kontraLabel})…`;
  }
  if (s.phase === 'playing') {
    let t = '';
    if (s.taker != null) {
      t = ` · Trumpf: ${seatDisplay(s, s.taker)} ${SUIT_SYMBOLS[s.trump] || ''}`;
      if (s.mit) t += ` · Mit: ${seatDisplay(s, s.qsHolder)}`;
      if ((s.spielwert || 1) > 1) t += ` · Wert ${s.spielwert}`;
    }
    const meP = s.you >= 0 ? s.players[s.you] : null;
    let turn;
    if (s.turnSeat === s.you) turn = (meP && meP.auto) ? '🤖 Bot spielt für dich…' : '▶ Du bist dran';
    else turn = `${seatDisplay(s, s.turnSeat)} ist dran`;
    return `${turn}${t}`;
  }
  return '';
}

function seatDisplay(s, seat) {
  if (seat === s.you) return 'Du';
  const p = s.players[seat];
  return p && p.name ? esc(p.name) : `Sitz ${seat + 1}`;
}

function renderHand(s) {
  const area = $('handArea');
  area.innerHTML = '';
  const myTurn = s.phase === 'playing' && s.you === s.turnSeat && !s.trickComplete;
  const legal = s.legalCards;
  for (const card of s.yourHand) {
    let cls = '';
    if (myTurn && legal) {
      cls = legal.includes(card) ? 'playable legalHint' : 'illegal';
    }
    if (isTrumpCard(card, s.trump, s.mit)) cls += ' trump';
    area.insertAdjacentHTML('beforeend', cardHtml(card, cls));
  }
}

function renderOverlays(s) {
  // Trumpf bestimmen
  $('trumpOverlay').classList.toggle('hidden', !(s.phase === 'trump' && s.canTrump));

  // Mit der Mit?
  $('mitOverlay').classList.toggle('hidden', !(s.phase === 'mit' && s.canMit));

  // Klopfen / Re
  const showKontra = s.phase === 'kontra' && s.canKontra;
  $('kontraOverlay').classList.toggle('hidden', !showKontra);
  if (showKontra) {
    const isRe = s.kontraLabel === 'Re';
    $('kontraTitle').textContent = isRe ? 'Re?' : 'Klopfen?';
    $('kontraHint').textContent = isRe
      ? 'Die Gegner haben geklopft. Kontert ihr mit Re (+1 Spielwert)?'
      : 'Die Mit wurde angesagt. Wollt ihr klopfen (+1 Spielwert)?';
    $('kontraValue').textContent = s.spielwert;
    $('btnKontraRaise').textContent = (isRe ? 'Re' : 'Klopfen') + ' (+1)';
  }

  // Runden-Ende
  const re = s.phase === 'roundEnd';
  $('handEndOverlay').classList.toggle('hidden', !re);
  if (re && s.lastRound) fillRoundEnd(s);

  // Match-Ende
  const me = s.phase === 'matchEnd';
  $('matchEndOverlay').classList.toggle('hidden', !me);
  if (me) fillMatchEnd(s);

  // Karten abwerfen? Nur solange möglich und in dieser Runde noch nicht beantwortet.
  $('muckOverlay').classList.toggle('hidden', !(s.canMuck && !muckAsked));

  // Strichliste live aktualisieren, falls offen
  if (!$('scoreOverlay').classList.contains('hidden')) fillScoreboard(s);
}

function fillRoundEnd(s) {
  const r = s.lastRound;
  $('handEndTitle').textContent = r.vole ? 'Vole! 🃏' : (r.trumpMakerLost ? 'Trumpfmacher verliert!' : 'Runde vorbei');
  let body = '';
  body += `<div class="result-line">Trumpf: <b>${seatDisplay(s, r.taker)}</b> ${SUIT_SYMBOLS[r.trump]} (${SUIT_NAMES[r.trump]})${r.mit ? ' · Mit' : ''}</div>`;
  body += `<div class="result-line">Kartenpunkte: Team A <b>${r.pointsA}</b> : <b>${r.pointsB}</b> Team B</div>`;
  body += `<div class="result-big result-win">Team ${r.winner} gewinnt · Spielwert ${r.spielwert}</div>`;
  if (r.vole) body += `<div class="result-line">Alle 6 Stiche — Vole: ein Strich mehr abgezogen!</div>`;
  body += `<div class="result-line">Team ${r.winner}: −${r.spielwert} Striche` +
    (r.trumpMakerLost ? ` · <span class="result-couillon">Team ${r.loser} (Trumpfmacher): +1</span>` : '') + `</div>`;
  body += boardTiles(s);
  $('handEndBody').innerHTML = body;
}

function teamNames(s, team) {
  return s.players.filter(p => !p.empty && p.team === team)
    .map(p => p.seat === s.you ? 'Du' : esc(p.name)).join(' & ');
}

function fillScoreboard(s) {
  const ahead = s.board.A < s.board.B ? 'A' : (s.board.B < s.board.A ? 'B' : null);
  let body = `<div class="board-tiles big">` +
    `<div class="bt a"><div class="num">${s.board.A}</div><div class="lbl">Team A${ahead === 'A' ? ' ▸ führt' : ''}</div><div class="lbl small">${teamNames(s, 'A')}</div></div>` +
    `<div class="bt b"><div class="num">${s.board.B}</div><div class="lbl">Team B${ahead === 'B' ? ' ▸ führt' : ''}</div><div class="lbl small">${teamNames(s, 'B')}</div></div>` +
    `</div>`;
  if (['mit', 'kontra', 'playing'].includes(s.phase) && s.trump) {
    body += `<div class="result-line">Aktuelle Runde: Spielwert <b>${s.spielwert}</b>${s.mit ? ' · Mit' : ''} · Trumpf ${SUIT_SYMBOLS[s.trump]}</div>`;
  }
  const h = s.history || [];
  if (h.length) {
    body += `<div class="hist-title">Rundenverlauf</div><div class="hist">`;
    h.slice().reverse().forEach((e, i) => {
      const nr = h.length - i;
      const extra = [e.mit ? 'Mit' : '', e.vole ? 'Vole' : ''].filter(Boolean).join(' ');
      body += `<div class="hist-row"><span class="hn">#${nr}</span>` +
        `<span>Team ${e.winner} −${e.spielwert}${extra ? ' (' + extra + ')' : ''}${e.trumpMakerLost ? ' · TM +1' : ''}</span>` +
        `<span class="hb">A ${e.boardA} · B ${e.boardB}</span></div>`;
    });
    body += `</div>`;
  } else {
    body += `<div class="hint">Noch keine Runde gespielt.</div>`;
  }
  $('scoreBody').innerHTML = body;
}

function fillMatchEnd(s) {
  const w = s.matchWinner;
  const youWin = s.players[s.you] && s.players[s.you].team === w;
  $('matchEndTitle').textContent = `Team ${w} gewinnt!`;
  let body = `<div class="result-big result-win">${youWin ? 'Glückwunsch – ihr habt gewonnen! 🎉' : 'Diesmal hat das andere Team gewonnen.'}</div>`;
  body += boardTiles(s);
  $('matchEndBody').innerHTML = body;
  $('btnRematch').classList.toggle('hidden', !s.isHost);
  $('rematchWait').classList.toggle('hidden', s.isHost);
}

function boardTiles(s) {
  return `<div class="board-tiles">` +
    `<div class="bt a"><div class="num">${s.board.A}</div><div class="lbl">Team A</div></div>` +
    `<div class="bt b"><div class="num">${s.board.B}</div><div class="lbl">Team B</div></div>` +
    `</div><div class="hint">Striche — Ziel: 0 oder darunter</div>`;
}

// ---- Karten-HTML ----
function cardHtml(card, cls = '') {
  const r = RANK_DISPLAY[card[0]];
  const s = card[1];
  const color = isRed(s) ? 'red' : 'black';
  return `<div class="card ${color} ${cls}" data-card="${card}">` +
    `<span class="rank">${r}</span><span class="suit-c">${SUIT_SYMBOLS[s]}</span></div>`;
}

function esc(str) {
  return String(str).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---- Toast ----
let toastTimer = null;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  t.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.classList.add('hidden'), 300); }, 2500);
}

// ================= EVENTS =================
function bindEvents() {
  const nameInput = $('nameInput');
  nameInput.value = playerName;
  nameInput.addEventListener('input', () => {
    playerName = nameInput.value;
    localStorage.setItem('couillon_name', playerName);
  });

  $('btnCreate').addEventListener('click', () => {
    playerName = nameInput.value.trim();
    localStorage.setItem('couillon_name', playerName);
    send({ type: 'createRoom', playerId, name: currentName() });
  });

  $('btnJoin').addEventListener('click', joinFromInput);
  $('codeInput').addEventListener('keydown', e => { if (e.key === 'Enter') joinFromInput(); });

  $('btnRules').addEventListener('click', () => $('rulesOverlay').classList.remove('hidden'));
  $('btnRulesInGame').addEventListener('click', () => { $('menuOverlay').classList.add('hidden'); $('rulesOverlay').classList.remove('hidden'); });
  $('btnCloseRules').addEventListener('click', () => $('rulesOverlay').classList.add('hidden'));

  $('btnCopy').addEventListener('click', copyLink);
  $('btnShare').addEventListener('click', shareLink);
  $('btnLeave').addEventListener('click', leaveRoom);
  $('btnLeaveGame').addEventListener('click', leaveRoom);
  $('btnBackHome').addEventListener('click', leaveRoom);

  // Lobby: Bots hinzufügen/entfernen, Start (Delegation)
  $('seatList').addEventListener('click', e => {
    const add = e.target.closest('[data-addbot]');
    const rem = e.target.closest('[data-removeseat]');
    if (add) send({ type: 'addBot', seat: +add.dataset.addbot });
    if (rem) send({ type: 'removeSeat', seat: +rem.dataset.removeseat });
  });
  $('btnStart').addEventListener('click', () => send({ type: 'start' }));

  // Bot-Stärke wählen (nur Gastgeber)
  $('levelPicker').addEventListener('click', e => {
    const b = e.target.closest('.lp-btn');
    if (b && !b.disabled) send({ type: 'setLevel', level: b.dataset.level });
  });

  // Trumpf bestimmen
  document.querySelectorAll('.suit-btn').forEach(btn => {
    btn.addEventListener('click', () => send({ type: 'trump', suit: btn.dataset.suit }));
  });

  // Mit der Mit?
  $('btnMitYes').addEventListener('click', () => send({ type: 'mit', value: true }));
  $('btnMitNo').addEventListener('click', () => send({ type: 'mit', value: false }));

  // Klopfen / Re
  $('btnKontraRaise').addEventListener('click', () => send({ type: 'kontra', action: 'raise' }));
  $('btnKontraPass').addEventListener('click', () => send({ type: 'kontra', action: 'pass' }));

  // Strichliste
  $('scoreMini').addEventListener('click', () => { if (lastState) { fillScoreboard(lastState); $('scoreOverlay').classList.remove('hidden'); } });
  $('btnCloseScore').addEventListener('click', () => $('scoreOverlay').classList.add('hidden'));

  // Karte spielen (Delegation)
  $('handArea').addEventListener('click', e => {
    const el = e.target.closest('.card.playable');
    if (!el) return;
    send({ type: 'play', card: el.dataset.card });
  });

  // "Bot spielt für mich" (Checkbox) + "▶ selbst" (nach automatischer Übernahme) — Delegation.
  $('table').addEventListener('change', e => {
    if (e.target && e.target.id === 'assistBox') send({ type: 'assist', value: e.target.checked });
  });
  $('table').addEventListener('click', e => {
    if (e.target.closest('#btnResume')) send({ type: 'resume' });
  });

  // Karten abwerfen (Frage)
  $('btnMuckYes').addEventListener('click', () => { muckAsked = true; $('muckOverlay').classList.add('hidden'); send({ type: 'muck' }); });
  $('btnMuckNo').addEventListener('click', () => { muckAsked = true; $('muckOverlay').classList.add('hidden'); });

  // Raumcode antippen = Link kopieren
  $('roomCodeGame').addEventListener('click', copyLink);

  // Hand-/Match-Ende
  $('btnContinue').addEventListener('click', () => send({ type: 'continue' }));
  $('btnRematch').addEventListener('click', () => send({ type: 'rematch' }));

  // Austeil-Animation antippen = überspringen
  $('dealAnim').addEventListener('click', () => {
    clearTimeout(dealTimer);
    if (dealFrameTimer) { clearInterval(dealFrameTimer); dealFrameTimer = null; }
    $('dealAnim').classList.add('hidden');
  });

  // Menü
  $('btnMenu').addEventListener('click', () => { renderLog(); $('menuOverlay').classList.remove('hidden'); });
  $('btnCloseMenu').addEventListener('click', () => $('menuOverlay').classList.add('hidden'));
}

function joinFromInput() {
  const code = $('codeInput').value.trim().toUpperCase();
  if (code.length < 3) { toast('Bitte gültigen Code eingeben.'); return; }
  playerName = $('nameInput').value.trim();
  localStorage.setItem('couillon_name', playerName);
  roomToRejoin = code;
  send({ type: 'joinRoom', code, playerId, name: currentName() });
}

function leaveRoom() {
  send({ type: 'leaveRoom', playerId }); // Server: Platz freigeben / State-Broadcast stoppen
  localStorage.removeItem('couillon_room');
  roomToRejoin = null;
  lastState = null;
  prevPhase = null;
  muckAsked = false; prevKnocks = 0;
  if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
  $('turnTimer').classList.add('hidden');
  ['trumpOverlay', 'mitOverlay', 'kontraOverlay', 'scoreOverlay', 'handEndOverlay', 'matchEndOverlay', 'menuOverlay', 'muckOverlay', 'dealAnim'].forEach(id => $(id).classList.add('hidden'));
  $('seatList').innerHTML = ''; // alte Lobby-Inhalte nicht stehen lassen
  showScreen('home');
  history.replaceState(null, '', location.pathname);
}

function renderLog() {
  const el = $('menuLog');
  el.innerHTML = '';
  const log = (lastState && lastState.log) || [];
  for (const line of log) {
    const d = document.createElement('div');
    d.textContent = line;
    el.appendChild(d);
  }
  el.scrollTop = el.scrollHeight;
}

// ---- Teilen / Link ----
function roomLink() {
  const code = (lastState && lastState.code) || roomToRejoin || '';
  return `${location.origin}/?room=${code}`;
}
function updateShareButtons() {
  $('btnShare').classList.toggle('hidden', !navigator.share);
}
async function copyLink() {
  try { await navigator.clipboard.writeText(roomLink()); toast('Link kopiert!'); }
  catch { toast(roomLink()); }
}
async function shareLink() {
  try { await navigator.share({ title: 'Couillon', text: 'Spiel mit mir Couillon!', url: roomLink() }); }
  catch {}
}

// ================= INIT =================
function init() {
  bindEvents();
  updateShareButtons();
  preloadDealer();
  const params = new URLSearchParams(location.search);
  const urlRoom = (params.get('room') || '').toUpperCase();
  const storedRoom = localStorage.getItem('couillon_room');
  if (urlRoom) $('codeInput').value = urlRoom;

  if (storedRoom) roomToRejoin = storedRoom;
  else if (urlRoom && playerName) roomToRejoin = urlRoom;

  connect();

  // Auf iPhone/Safari: bei Rückkehr in die App bzw. wieder online sofort neu verbinden,
  // damit nicht dauerhaft ein Bot übernimmt.
  const ensureConnected = () => {
    if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      reconnectDelay = 500;
      connect();
    }
  };
  document.addEventListener('visibilitychange', () => { if (!document.hidden) ensureConnected(); });
  window.addEventListener('focus', ensureConnected);
  window.addEventListener('online', ensureConnected);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
init();
