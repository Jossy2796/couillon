// room.js — Ein Spielraum: Sitzverwaltung, Zustandsautomat und KI-/Auto-Steuerung.
// Kujon, St. Vither Variante. Ablauf pro Runde:
//   3 Karten -> Trumpf bestimmen (links vom Geber, kein Passen) -> 3 Karten
//   -> Mit? -> ggf. Klopfen/Re -> 6 Stiche -> Wertung.
import {
  makeDeck, shuffle, sortHand, legalCards, isLegal, trickWinnerIndex,
  pointsOf, teamOf, scoreRound, seatWithQS, CONFIG,
  SUIT_SYMBOLS, SUIT_NAMES,
} from './game.js';
import { decideTrump, decideMit, chooseCard } from './bot.js';

const RANK_DISPLAY = { '9': '9', T: '10', J: 'B', Q: 'D', K: 'K', A: 'A' };
export function formatCard(card) { return RANK_DISPLAY[card[0]] + SUIT_SYMBOLS[card[1]]; }

const BOT_DELAY = 850;      // ms, natürlicheres Tempo für Bot-Züge
const TRICK_PAUSE = 1300;   // ms, fertigen Stich kurz zeigen
const HAND_PAUSE = 8000;    // ms, Rundenergebnis zeigen, dann automatisch weiter

const BOT_NAMES = ['Bot Anna', 'Bot Ben', 'Bot Cleo', 'Bot Dario'];
const SUIT_LIST = ['S', 'H', 'D', 'C'];

export class Room {
  constructor(code, onChange) {
    this.code = code;
    this.onChange = onChange || (() => {});
    this.seats = [null, null, null, null];
    this.hostId = null;
    this.phase = 'lobby';
    this.log = [];
    this.config = { ...CONFIG };

    // Rundenzustand
    this.dealerSeat = 0;
    this.turnSeat = 0;
    this.trump = null;
    this.taker = null;           // Trumpfmacher = Spieler links vom Geber
    this.trumpMakerTeam = null;
    this.mit = false;            // Pik-Dame angesagt?
    this.qsHolder = null;        // Sitz mit der Pik-Dame
    this.mitTeam = null;
    this.spielwertBase = 1;      // 1 + Mit + Klopfen/Re
    this.kontraTurn = null;      // Team, das gerade erhöhen darf ('A'/'B')
    this._deck = [];

    this.hands = [[], [], [], []];
    this.currentTrick = [];
    this.trickLeadSeat = 0;
    this.trickCount = 0;
    this.tricksWon = { A: 0, B: 0 };
    this.capturedPoints = { A: 0, B: 0 };

    this.board = { A: this.config.START_STRICHE, B: this.config.START_STRICHE };
    this.history = [];

    this.trickComplete = false;
    this.trickWinnerSeat = null;
    this.lastRound = null;
    this.matchWinner = null;

    this._timer = null;
    this._resolving = false;
    this.lastActivity = Date.now();
  }

  // ---- Logging ----
  logMsg(msg) { this.log.push(msg); if (this.log.length > 16) this.log.shift(); }
  seatName(seat) { return this.seats[seat] ? this.seats[seat].name : `Sitz ${seat + 1}`; }

  // ---- Sitz-/Spielerverwaltung ----
  hasConnectedHuman() { return this.seats.some(p => p && !p.isBot && p.connected); }
  teamHasConnectedHuman(team) {
    return this.seats.some((p, i) => p && !p.isBot && p.connected && teamOf(i) === team);
  }
  seatOf(playerId) { return this.seats.findIndex(p => p && p.playerId === playerId); }
  firstFreeSeat() { return this.seats.findIndex(s => s === null); }

  addHuman(playerId, name) {
    const existing = this.seatOf(playerId);
    if (existing >= 0) {
      this.seats[existing].connected = true;
      if (name) this.seats[existing].name = name;
      this.touch();
      this.scheduleAuto();
      return { ok: true, seat: existing, reconnect: true };
    }
    if (this.phase !== 'lobby') return { ok: false, error: 'Spiel läuft bereits.' };
    const seat = this.firstFreeSeat();
    if (seat < 0) return { ok: false, error: 'Raum ist voll.' };
    this.seats[seat] = { playerId, name: name || `Spieler ${seat + 1}`, isBot: false, connected: true };
    if (!this.hostId) this.hostId = playerId;
    this.touch();
    return { ok: true, seat, reconnect: false };
  }

  markDisconnected(playerId) {
    const seat = this.seatOf(playerId);
    if (seat < 0) return;
    this.seats[seat].connected = false;
    this.touch();
    this.scheduleAuto();
  }

  addBot(seat) {
    if (this.phase !== 'lobby') return;
    if (seat < 0 || seat > 3 || this.seats[seat]) return;
    this.seats[seat] = { playerId: `bot-${seat}`, name: BOT_NAMES[seat], isBot: true, connected: true };
    this.touch();
  }
  removeSeat(seat) {
    if (this.phase !== 'lobby') return;
    if (this.seats[seat] && this.seats[seat].isBot) this.seats[seat] = null;
    this.touch();
  }
  fillWithBots() { for (let s = 0; s < 4; s++) if (!this.seats[s]) this.addBot(s); }
  isHost(playerId) { return playerId === this.hostId; }

  // ---- Aktionen ----
  handle(playerId, msg) {
    switch (msg.type) {
      case 'addBot': if (this.isHost(playerId)) { this.addBot(msg.seat); this.emit(); } break;
      case 'removeSeat': if (this.isHost(playerId)) { this.removeSeat(msg.seat); this.emit(); } break;
      case 'start': if (this.isHost(playerId)) this.startMatch(); break;
      case 'trump': this.playerTrump(playerId, msg); break;
      case 'mit': this.playerMit(playerId, msg); break;
      case 'kontra': this.playerKontra(playerId, msg); break;
      case 'play': this.playerPlay(playerId, msg); break;
      case 'continue': if (this.phase === 'roundEnd') this.nextRound(); break;
      case 'rematch': if (this.isHost(playerId) && this.phase === 'matchEnd') this.startMatch(); break;
      default: break;
    }
  }

  startMatch() {
    if (this.phase !== 'lobby' && this.phase !== 'matchEnd') return;
    this.fillWithBots();
    if (this.seats.some(s => s === null)) return;
    this.board = { A: this.config.START_STRICHE, B: this.config.START_STRICHE };
    this.history = [];
    this.matchWinner = null;
    this.lastRound = null;
    this.dealerSeat = 0; // Spieler 1 gibt in Runde 1
    this.log = [];
    this.logMsg(`Neues Match! Beide Teams starten bei ${this.config.START_STRICHE} Strichen — wer zuerst auf 0 (oder darunter) ist, gewinnt.`);
    this.startRound();
  }

  startRound() {
    const eldest = (this.dealerSeat + 1) % 4;
    this._deck = shuffle(makeDeck());
    this.hands = [[], [], [], []];
    for (let i = 0; i < 12; i++) this.hands[i % 4].push(this._deck[i]); // 3 Karten je Spieler

    this.trump = null;
    this.mit = false;
    this.mitTeam = null;
    this.qsHolder = null;
    this.spielwertBase = 1;
    this.kontraTurn = null;
    this.taker = eldest;
    this.trumpMakerTeam = teamOf(eldest);
    this.currentTrick = [];
    this.trickComplete = false;
    this.trickWinnerSeat = null;
    this.trickCount = 0;
    this.tricksWon = { A: 0, B: 0 };
    this.capturedPoints = { A: 0, B: 0 };

    this.phase = 'trump';
    this.turnSeat = eldest;
    this.trickLeadSeat = eldest;
    this.logMsg(`${this.seatName(this.dealerSeat)} gibt. ${this.seatName(eldest)} bestimmt den Trumpf (aus 3 Karten).`);
    this.emit();
    this.scheduleAuto();
  }

  // ---- Trumpf bestimmen ----
  playerTrump(playerId, msg) {
    if (this.phase !== 'trump') return;
    const seat = this.seatOf(playerId);
    if (seat !== this.turnSeat) return;
    if (!SUIT_LIST.includes(msg.suit)) return;
    this.applyTrump(seat, msg.suit);
  }

  applyTrump(seat, suit) {
    this.trump = suit;
    for (let i = 12; i < 24; i++) this.hands[i % 4].push(this._deck[i]); // restliche 3 Karten
    this.qsHolder = seatWithQS(this.hands);
    this.logMsg(`${this.seatName(seat)} macht Trumpf ${SUIT_NAMES[suit]} ${SUIT_SYMBOLS[suit]}. Team ${teamOf(seat)} trägt das Risiko.`);
    this.startMit();
  }

  // ---- Mit? ----
  startMit() {
    this.phase = 'mit';
    this.turnSeat = this.qsHolder;
    this.logMsg(`${this.seatName(this.qsHolder)} hat die Pik-Dame (Mit) und entscheidet.`);
    this.emit();
    this.scheduleAuto();
  }

  playerMit(playerId, msg) {
    if (this.phase !== 'mit') return;
    if (this.seatOf(playerId) !== this.qsHolder) return;
    this.applyMit(!!msg.value);
  }

  applyMit(value) {
    this.mit = value;
    if (value) {
      this.spielwertBase = 2;
      this.mitTeam = teamOf(this.qsHolder);
      this.logMsg(`${this.seatName(this.qsHolder)} sagt MIT an — Pik-Dame ist zweithöchster Trumpf, Spielwert 2.`);
      this.startKontra();
    } else {
      this.spielwertBase = 1;
      this.logMsg(`${this.seatName(this.qsHolder)} sagt die Mit NICHT an.`);
      this.startPlaying();
    }
  }

  // ---- Klopfen / Re ----
  startKontra() {
    this.phase = 'kontra';
    this.kontraTurn = this.mitTeam === 'A' ? 'B' : 'A'; // Gegner dürfen zuerst klopfen
    this.logMsg(`Team ${this.kontraTurn} darf klopfen (Kontra).`);
    this.emit();
    this.scheduleAuto();
  }

  playerKontra(playerId, msg) {
    if (this.phase !== 'kontra') return;
    const seat = this.seatOf(playerId);
    if (seat < 0 || teamOf(seat) !== this.kontraTurn) return;
    this.applyKontra(msg.action === 'raise' ? 'raise' : 'pass');
  }

  applyKontra(action) {
    if (action === 'raise') {
      this.spielwertBase += 1;
      const label = this.kontraTurn === this.mitTeam ? 'Re' : 'Klopfen';
      this.logMsg(`Team ${this.kontraTurn}: ${label}! Spielwert jetzt ${this.spielwertBase}.`);
      this.kontraTurn = this.kontraTurn === 'A' ? 'B' : 'A';
      this.emit();
      this.scheduleAuto();
    } else {
      this.logMsg(`Team ${this.kontraTurn} erhöht nicht mehr.`);
      this.startPlaying();
    }
  }

  startPlaying() {
    this.phase = 'playing';
    this.kontraTurn = null;
    const eldest = (this.dealerSeat + 1) % 4;
    this.turnSeat = eldest;
    this.trickLeadSeat = eldest;
    this.currentTrick = [];
    this.emit();
    this.scheduleAuto();
  }

  // ---- Stiche ----
  playerPlay(playerId, msg) {
    if (this.phase !== 'playing' || this._resolving) return;
    const seat = this.seatOf(playerId);
    if (seat !== this.turnSeat) return;
    this.applyPlay(seat, msg.card);
  }

  applyPlay(seat, card) {
    const hand = this.hands[seat];
    if (!isLegal(card, hand, this.currentTrick, this.trump, this.mit)) return;
    this.hands[seat] = hand.filter(c => c !== card);
    this.currentTrick.push({ seat, card });

    if (this.currentTrick.length === 4) {
      const winIdx = trickWinnerIndex(this.currentTrick, this.trump, this.mit);
      this.trickWinnerSeat = this.currentTrick[winIdx].seat;
      this.trickComplete = true;
      this._resolving = true;
      this.emit();
      this._timer = setTimeout(() => this.resolveTrick(), TRICK_PAUSE);
      return;
    }
    this.turnSeat = (this.turnSeat + 1) % 4;
    this.emit();
    this.scheduleAuto();
  }

  resolveTrick() {
    this._resolving = false;
    const winnerSeat = this.trickWinnerSeat;
    const team = teamOf(winnerSeat);
    const pts = this.currentTrick.reduce((s, t) => s + pointsOf(t.card), 0);
    this.capturedPoints[team] += pts;
    this.tricksWon[team] += 1;
    this.trickCount += 1;
    this.logMsg(`${this.seatName(winnerSeat)} gewinnt den Stich (+${pts}). Punkte: A ${this.capturedPoints.A} : ${this.capturedPoints.B} B.`);

    this.currentTrick = [];
    this.trickComplete = false;
    this.trickWinnerSeat = null;

    if (this.trickCount === 6) { this.endRound(); return; }
    this.turnSeat = winnerSeat;
    this.trickLeadSeat = winnerSeat;
    this.emit();
    this.scheduleAuto();
  }

  endRound() {
    const res = scoreRound(this.capturedPoints, this.tricksWon, this.trumpMakerTeam, this.spielwertBase, this.config);
    this.board[res.winner] += res.winnerDelta;
    this.board[res.loser] += res.loserPenalty;

    this.lastRound = {
      ...res, mit: this.mit, trump: this.trump, taker: this.taker,
      spielwertBase: this.spielwertBase,
      capturedPoints: { ...this.capturedPoints },
      tricksWon: { ...this.tricksWon },
      boardAfter: { ...this.board },
    };
    this.history.push({
      dealer: this.dealerSeat, trumpMaker: this.taker, trump: this.trump, mit: this.mit,
      winner: res.winner, spielwert: res.spielwert, vole: res.vole,
      trumpMakerLost: res.trumpMakerLost, pointsA: res.pointsA, pointsB: res.pointsB,
      boardA: this.board.A, boardB: this.board.B,
    });

    let msg = `Team ${res.winner} gewinnt die Runde (${res.pointsA}:${res.pointsB}) und zieht ${res.spielwert} ab.`;
    if (res.vole) msg += ' Vole — alle Stiche!';
    if (res.trumpMakerLost) msg += ` Trumpfmacher-Team ${res.loser} bekommt +1 angemacht.`;
    this.logMsg(msg);
    this.logMsg(`Stand: Team A ${this.board.A} — Team B ${this.board.B} (Ziel 0).`);

    if (this.board[res.winner] <= 0) {
      this.matchWinner = res.winner;
      this.phase = 'matchEnd';
      this.logMsg(`Team ${this.matchWinner} ist auf 0 — Match gewonnen! 🏆`);
      this.emit();
      return;
    }
    this.phase = 'roundEnd';
    this.emit();
    this.scheduleAuto();
  }

  nextRound() {
    if (this.phase !== 'roundEnd') return;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    this.dealerSeat = (this.dealerSeat + 1) % 4; // neuer Geber = alter Trumpfmacher
    this.startRound();
  }

  // ---- Automatik (Bots & getrennte Spieler) ----
  scheduleAuto() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    if (this._resolving) return;
    if (!this.hasConnectedHuman()) return;

    if (this.phase === 'roundEnd') {
      this._timer = setTimeout(() => this.nextRound(), HAND_PAUSE);
      return;
    }
    if (this.phase === 'kontra') {
      if (!this.teamHasConnectedHuman(this.kontraTurn)) {
        this._timer = setTimeout(() => this.autoKontra(), BOT_DELAY);
      }
      return;
    }
    if (!['trump', 'mit', 'playing'].includes(this.phase)) return;

    const occ = this.seats[this.turnSeat];
    if (!occ) return;
    if (!(occ.isBot || !occ.connected)) return;
    this._timer = setTimeout(() => this.autoAct(), BOT_DELAY);
  }

  autoKontra() {
    this._timer = null;
    if (this.phase !== 'kontra') return;
    if (this.teamHasConnectedHuman(this.kontraTurn)) return; // Mensch übernimmt
    this.applyKontra('pass'); // Bots erhöhen nicht
  }

  autoAct() {
    this._timer = null;
    const seat = this.turnSeat;
    const occ = this.seats[seat];
    if (!occ) return;
    if (occ.connected && !occ.isBot) return;
    if (this.phase === 'trump') {
      this.applyTrump(seat, decideTrump(this.hands[seat]));
    } else if (this.phase === 'mit') {
      this.applyMit(decideMit(this.hands[seat], this.trump, seat, this.trumpMakerTeam));
    } else if (this.phase === 'playing' && !this._resolving) {
      this.applyPlay(seat, chooseCard(this.hands[seat], this.currentTrick, this.trump, this.mit, seat));
    }
  }

  // ---- Zustand nach außen ----
  touch() { this.lastActivity = Date.now(); }
  emit() { this.touch(); this.onChange(); }

  playersPublic() {
    return this.seats.map((p, seat) => p ? {
      seat, name: p.name, isBot: p.isBot, connected: p.connected, team: teamOf(seat),
    } : { seat, name: null, isBot: false, connected: false, team: teamOf(seat), empty: true });
  }

  stateFor(playerId) {
    const you = this.seatOf(playerId);
    const yourHand = you >= 0 ? sortHand(this.hands[you], this.trump, this.mit) : [];
    let legal = null;
    if (this.phase === 'playing' && you === this.turnSeat && !this._resolving && !this.trickComplete) {
      legal = legalCards(this.hands[you], this.currentTrick, this.trump, this.mit);
    }
    return {
      type: 'state',
      code: this.code,
      phase: this.phase,
      you,
      isHost: playerId === this.hostId,
      players: this.playersPublic(),
      handCounts: this.hands.map(h => h.length),
      dealerSeat: this.dealerSeat,
      turnSeat: this.turnSeat,
      trump: this.trump,
      mit: this.mit,
      qsHolder: this.qsHolder,
      taker: this.taker,
      trumpMakerTeam: this.trumpMakerTeam,
      spielwert: this.spielwertBase,
      kontraTurn: this.kontraTurn,
      mitTeam: this.mitTeam,
      yourHand,
      legalCards: legal,
      canTrump: this.phase === 'trump' && you === this.turnSeat,
      canMit: this.phase === 'mit' && you === this.qsHolder,
      canKontra: this.phase === 'kontra' && you >= 0 && teamOf(you) === this.kontraTurn,
      kontraLabel: this.phase === 'kontra' ? (this.kontraTurn === this.mitTeam ? 'Re' : 'Klopfen') : null,
      currentTrick: this.currentTrick,
      trickComplete: this.trickComplete,
      trickWinnerSeat: this.trickWinnerSeat,
      trickLeadSeat: this.trickLeadSeat,
      trickCount: this.trickCount,
      board: this.board,
      startStriche: this.config.START_STRICHE,
      history: this.history.slice(-12),
      capturedPoints: this.capturedPoints,
      tricksWon: this.tricksWon,
      lastRound: this.phase === 'roundEnd' || this.phase === 'matchEnd' ? this.lastRound : null,
      matchWinner: this.matchWinner,
      log: this.log.slice(-10),
    };
  }
}
