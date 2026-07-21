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
  if (s.phase === 'trump' && prevPhase !== 'trump') playDeal(); // neue Runde -> austeilen
  prevPhase = s.phase;
  if (s.phase === 'lobby') { showScreen('lobby'); renderLobby(s); }
  else { showScreen('game'); renderGame(s); }
  renderOverlays(s);
}

function playDeal() {
  const el = $('dealAnim');
  el.classList.remove('hidden'); // display-Wechsel startet die CSS-Animationen neu
  clearTimeout(dealTimer);
  dealTimer = setTimeout(() => el.classList.add('hidden'), 1600);
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
  $('hostControls').classList.toggle('hidden', !s.isHost);
  $('waitHost').classList.toggle('hidden', s.isHost);
  updateShareButtons();
}

function renderGame(s) {
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
  const cls = ['player-chip'];
  if (p.seat === s.turnSeat && (s.phase === 'bidding' || s.phase === 'playing')) cls.push('turn');
  if (!p.connected && !p.isBot) cls.push('disconnected');
  const name = p.seat === s.you ? 'Du' : esc(p.name);
  const n = s.handCounts[p.seat] || 0;
  let backs = '';
  for (let i = 0; i < n; i++) backs += '<div class="card-back"></div>';
  const dc = (!p.connected && !p.isBot) ? ' 📴' : '';
  return `<div class="${cls.join(' ')}"><span class="tdot" style="background:${dot}"></span>` +
    `<span class="pname">${name}${dc}</span></div>` +
    `<div>${badges.join(' ')}</div>` +
    `<div class="mini-cards">${backs}</div>`;
}

function centerInfo(s) {
  if (s.phase === 'trump') return s.canTrump ? 'Trumpf<br>bestimmen' : `${seatDisplay(s, s.turnSeat)}<br>wählt Trumpf…`;
  if (s.phase === 'mit') return s.canMit ? 'Mit?' : `${seatDisplay(s, s.qsHolder)}<br>Mit?`;
  if (s.phase === 'kontra') return `Kontra<br>Team ${s.kontraTurn}`;
  if (s.trickComplete) return `${seatDisplay(s, s.trickWinnerSeat)}<br>gewinnt`;
  if (s.currentTrick.length > 0 && s.leadingSeat != null) return `▲ ${seatDisplay(s, s.leadingSeat)}<br>führt`;
  return `Stich ${(s.trickCount || 0) + 1}/6`;
}

function statusText(s) {
  if (s.phase === 'trump') {
    return s.canTrump ? '▶ Du bestimmst den Trumpf' : `${seatDisplay(s, s.turnSeat)} bestimmt den Trumpf…`;
  }
  if (s.phase === 'mit') {
    return s.canMit ? '▶ Du: Pik-Dame ansagen (Mit)?' : `${seatDisplay(s, s.qsHolder)} entscheidet über die Mit…`;
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
    const turn = s.turnSeat === s.you ? '▶ Du bist dran' : `${seatDisplay(s, s.turnSeat)} ist dran`;
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

  // Hand-/Match-Ende
  $('btnContinue').addEventListener('click', () => send({ type: 'continue' }));
  $('btnRematch').addEventListener('click', () => send({ type: 'rematch' }));

  // Austeil-Animation antippen = überspringen
  $('dealAnim').addEventListener('click', () => { clearTimeout(dealTimer); $('dealAnim').classList.add('hidden'); });

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
  localStorage.removeItem('couillon_room');
  roomToRejoin = null;
  lastState = null;
  ['trumpOverlay', 'mitOverlay', 'kontraOverlay', 'scoreOverlay', 'handEndOverlay', 'matchEndOverlay', 'menuOverlay', 'dealAnim'].forEach(id => $(id).classList.add('hidden'));
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
