// bot.js — Starke KI, die wie ein echter Spieler spielt: nur eigene Karten +
// öffentlich gespielte Karten (Kartengedächtnis). Kein Blick in fremde Hände.
import {
  SUITS, suitOf, strengthOf, pointsOf, legalCards, currentWinnerSeat,
  partnerOf, teamOf, beats, isTrump, trumpStrength, makeDeck,
} from './game.js';

const ALL_CARDS = makeDeck();

// Strategie-Stellschrauben — per Head-to-head-Arena (Duplikat-Deals) optimiert.
export const DEFAULT_CFG = {
  cashAcesWhileTrumps: true, // Top-Asse aktiv cashen (Arena: klar besser als zurückhalten)
  drawMinTrumps: 3,          // ab 3 (Boss-)Trümpfen Trümpfe ziehen
  trumpInMinPoints: 3,       // schon ab 3 Punkten riskant einstechen
  cheapTrumpMax: 3,          // Trümpfe bis Stärke 3 gelten als "billig" (großzügiger einsetzen)
  leadLowMaxRank: 2,         // "niedrige" Anspielkarte (nur wenn Asse zurückgehalten werden)
};

// ---- Trumpfwahl (Spieler links vom Geber, aus 3 Karten, kein Passen) -----
export function decideTrump(hand) {
  let best = { suit: null, score: -1 };
  for (const trump of SUITS) {
    const score = evaluateSuit(hand, trump);
    if (score > best.score) best = { suit: trump, score };
  }
  return best.suit;
}

function evaluateSuit(hand, trump) {
  const myTrumps = hand.filter(c => isTrump(c, trump, false));
  let score = myTrumps.length * 3;             // Länge im Trumpf ist am wichtigsten
  if (myTrumps.length === 0) score -= 8;       // eine Farbe ohne eigene Karten meiden
  for (const c of hand) {
    const t = isTrump(c, trump, false);
    if (c === 'QC') score += 3;                // Kreuz-Dame immer stark
    if (t && strengthOf(c) === 5) score += 3;  // Trumpf-Ass
    else if (t && strengthOf(c) === 4) score += 2; // Trumpf-König
    if (!t && strengthOf(c) === 5) score += 2; // Nebenfarben-Ass
  }
  if (hand.includes('QS')) score += 1;         // Pik-Dame (potenzielles Mit)
  return score;
}

// ---- Mit-Entscheidung (Halter der Pik-Dame) ------------------------------
export function decideMit(hand, trump, seat, takerTeam) {
  const onTakerTeam = teamOf(seat) === takerTeam;
  const strongTrumps = hand.filter(c => isTrump(c, trump, true) && trumpStrength(c, trump, true) >= 5).length;
  const trumpCount = hand.filter(c => isTrump(c, trump, true)).length;
  return onTakerTeam && (strongTrumps >= 2 || trumpCount >= 4);
}

// ---- Kartenwahl ----------------------------------------------------------
// playedCards: alle in dieser Runde bereits gespielten Karten (öffentlich).
// seatVoids: Array[4] von Sets mit Farben, in denen ein Sitz sicher leer ist.
export function chooseCard(hand, trick, trump, mit, seat, playedCards = [], seatVoids = [], cfg = DEFAULT_CFG) {
  const legal = legalCards(hand, trick, trump, mit);
  if (legal.length === 1) return legal[0];

  const isT = c => isTrump(c, trump, mit);
  const tStr = c => trumpStrength(c, trump, mit);
  const val = c => pointsOf(c);
  const str = c => isT(c) ? 100 + tStr(c) : strengthOf(c);
  const byLowVal = a => a.slice().sort((x, y) => (val(x) - val(y)) || (str(x) - str(y)));
  const byLowRank = a => a.slice().sort((x, y) => (str(x) - str(y)) || (val(x) - val(y)));
  const byHighVal = a => a.slice().sort((x, y) => (val(y) - val(x)) || (str(x) - str(y)));

  const nonTrumps = legal.filter(c => !isT(c));
  const trumps = legal.filter(c => isT(c));
  const dump = () => (nonTrumps.length ? byLowVal(nonTrumps) : byLowRank(trumps))[0];

  // ---- Kartengedächtnis: was ist noch in fremden Händen? ----
  const seen = new Set([...hand, ...playedCards, ...trick.map(t => t.card)]);
  const unseen = ALL_CARDS.filter(c => !seen.has(c));
  const unseenTrumps = unseen.filter(isT);
  const maxUnseenTrumpStr = unseenTrumps.reduce((m, c) => Math.max(m, tStr(c)), -1);
  const noOutstandingTrumps = unseenTrumps.length === 0;
  const isBossTrump = c => isT(c) && tStr(c) > maxUnseenTrumpStr;
  const maxUnseenInSuit = s => unseen.filter(c => !isT(c) && suitOf(c) === s).reduce((m, c) => Math.max(m, strengthOf(c)), -1);
  const isTopOfSuit = c => !isT(c) && strengthOf(c) > maxUnseenInSuit(suitOf(c));

  const partner = partnerOf(seat);
  const opps = [0, 1, 2, 3].filter(s => s !== seat && s !== partner);
  const oppVoid = s => opps.some(o => seatVoids[o] && seatVoids[o].has(s));

  // ================= ANSPIELER =================
  if (trick.length === 0) {
    const myTrumps = hand.filter(isT);
    const bossTrumps = myTrumps.filter(isBossTrump);

    // A) Keine Trümpfe mehr draußen -> sichere Gewinner cashen (Asse sind jetzt sicher).
    if (noOutstandingTrumps) {
      const winners = nonTrumps.filter(isTopOfSuit);
      if (winners.length) return byHighVal(winners)[0];
    }
    // B) Trümpfe ziehen mit unschlagbarem Trumpf + Länge (danach kann man sicher cashen).
    if (bossTrumps.length && myTrumps.length >= cfg.drawMinTrumps) return byLowRank(bossTrumps).slice(-1)[0];
    // C) Asse cashen, auch wenn noch Trümpfe draußen sind? (optional/aggressiv)
    if (cfg.cashAcesWhileTrumps) {
      const cashAces = nonTrumps.filter(c => strengthOf(c) === 5 && isTopOfSuit(c) && !oppVoid(suitOf(c)));
      if (cashAces.length) return cashAces[0];
    } else {
      // Sonst: solange Gegner Trümpfe haben, KEINE hohen Karten anspielen (würden gestochen).
      const lowNon = nonTrumps.filter(c => strengthOf(c) <= cfg.leadLowMaxRank);
      if (lowNon.length) {
        const safe = lowNon.filter(c => !oppVoid(suitOf(c)));
        return byLowVal(safe.length ? safe : lowNon)[0];
      }
    }
    // D) Rest: sicher niedrig (nicht in Gegner-Voids), sonst niedrigste Karte.
    const safeLows = nonTrumps.filter(c => !oppVoid(suitOf(c)));
    if (safeLows.length) return byLowVal(safeLows)[0];
    if (nonTrumps.length) return byLowVal(nonTrumps)[0];
    return byLowRank(trumps)[0];
  }

  // ================= FOLGEND =================
  const ledNat = suitOf(trick[0].card);
  const winnerSeat = currentWinnerSeat(trick, trump, mit);
  const partnerWinning = winnerSeat === partner;
  const isLast = trick.length === 3;
  const winningCard = trick[localWinnerIdx(trick, trump, mit)].card;
  const trickPoints = trick.reduce((s, t) => s + pointsOf(t.card), 0);

  // ---- Partner führt: nicht überstechen, Trümpfe sparen ----
  if (partnerWinning) {
    const winnerIsBoss = isT(winningCard)
      ? isBossTrump(winningCard)
      : (isTopOfSuit(winningCard) && noOutstandingTrumps);
    const secure = isLast || winnerIsBoss; // Stich gehört uns sicher
    if (nonTrumps.length) return secure ? byHighVal(nonTrumps)[0] : byLowVal(nonTrumps)[0];
    // nur Trümpfe: Partner möglichst nicht überstechen -> niedrigsten unter ihm, sonst niedrigsten.
    const under = trumps.filter(c => tStr(c) < tStr(winningCard));
    return (under.length ? byLowRank(under) : byLowRank(trumps))[0];
  }

  // ---- Gegner führt ----
  const canWin = legal.filter(c => beats(c, winningCard, ledNat, trump, mit));
  if (canWin.length) {
    const winNon = canWin.filter(c => !isT(c));
    if (winNon.length) return byLowRank(winNon)[0]; // am billigsten mit Nicht-Trumpf gewinnen
    // Nur per Trumpf zu gewinnen: abwägen, ob es sich lohnt.
    const cheapT = byLowRank(canWin)[0];
    const worth =
      trickPoints >= cfg.trumpInMinPoints || // ordentlich Punkte im Stich
      isBossTrump(cheapT) ||                  // unüberstechbar -> risikofrei
      (isLast && trickPoints > 0) ||          // als Letzter mit Punkten sicher
      tStr(cheapT) <= cfg.cheapTrumpMax;      // sehr billiger Trumpf -> vertretbar
    return worth ? cheapT : dump();
  }

  // ---- Kann nicht gewinnen -> billig abwerfen, Punkte/Trümpfe sparen ----
  return dump();
}

function localWinnerIdx(trick, trump, mit) {
  const ledNat = suitOf(trick[0].card);
  let best = 0;
  for (let i = 1; i < trick.length; i++) {
    if (beats(trick[i].card, trick[best].card, ledNat, trump, mit)) best = i;
  }
  return best;
}
