// bot.js — Strategische KI für Trumpfwahl, Mit-Entscheidung und Kartenspiel.
import {
  SUITS, suitOf, strengthOf, pointsOf, legalCards, currentWinnerSeat,
  partnerOf, teamOf, beats, isTrump, trumpStrength,
} from './game.js';

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
  let score = 0;
  for (const c of hand) {
    const t = isTrump(c, trump, false);
    if (t) score += 2;
    if (c === 'QC') score += 3;                    // Kreuz-Dame immer stark
    if (t && strengthOf(c) === 5) score += 3;      // Trumpf-Ass
    else if (t && strengthOf(c) === 4) score += 2; // Trumpf-König
    if (!t && strengthOf(c) === 5) score += 2;     // Nebenfarben-Ass
  }
  if (hand.includes('QS')) score += 1;             // Pik-Dame (potenzielles Mit)
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
export function chooseCard(hand, trick, trump, mit, seat) {
  const legal = legalCards(hand, trick, trump, mit);
  if (legal.length === 1) return legal[0];

  const isT = c => isTrump(c, trump, mit);
  const val = c => pointsOf(c);
  const str = c => isT(c) ? 100 + trumpStrength(c, trump, mit) : strengthOf(c);
  // Sortierungen: wenig Punkte / niedriger Rang / viele Punkte zuerst.
  const byLowVal = arr => arr.slice().sort((a, b) => (val(a) - val(b)) || (str(a) - str(b)));
  const byLowRank = arr => arr.slice().sort((a, b) => (str(a) - str(b)) || (val(a) - val(b)));
  const byHighVal = arr => arr.slice().sort((a, b) => (val(b) - val(a)) || (str(a) - str(b)));

  const nonTrumps = legal.filter(c => !isT(c));
  const trumps = legal.filter(c => isT(c));
  // Karte zum "gefahrlosen Abwerfen": niedrigste Nicht-Trumpf-Karte, sonst niedrigster Trumpf.
  const dump = () => (nonTrumps.length ? byLowVal(nonTrumps) : byLowRank(trumps))[0];

  // ---- Anspieler ----
  if (trick.length === 0) {
    const aces = nonTrumps.filter(c => strengthOf(c) === 5);
    if (aces.length) return aces[0];               // Nebenfarben-Ass: Punkte kassieren
    if (nonTrumps.length) return byLowVal(nonTrumps)[0]; // niedrig anspielen, Trümpfe sparen
    return byLowRank(trumps)[0];                    // nur Trümpfe: niedrigen Trumpf
  }

  const ledNat = suitOf(trick[0].card);
  const winnerSeat = currentWinnerSeat(trick, trump, mit);
  const partnerWinning = winnerSeat === partnerOf(seat);
  const isLast = trick.length === 3;
  const trickPoints = trick.reduce((s, t) => s + pointsOf(t.card), 0);
  const winningCard = trick[localWinnerIdx(trick, trump, mit)].card;
  const topTrumpStr = trumpStrength('A' + trump, trump, mit); // stärkster möglicher Trumpf

  // ---- Partner führt: NIE überstechen, keinen Trumpf verschwenden ----
  if (partnerWinning) {
    // Sicher = ich bin Letzter, oder Partner hält den höchsten Trumpf.
    const secure = isLast || (isT(winningCard) && trumpStrength(winningCard, trump, mit) === topTrumpStr);
    if (nonTrumps.length) {
      return secure ? byHighVal(nonTrumps)[0]   // Punkte zum Partner schmieren
                    : byLowVal(nonTrumps)[0];   // unsicher: niedrig, keine Punkte riskieren
    }
    return byLowRank(trumps)[0];                 // nur Trümpfe: niedrigsten (Partner nicht überstechen)
  }

  // ---- Gegner führt ----
  const canWin = legal.filter(c => beats(c, winningCard, ledNat, trump, mit));
  if (canWin.length) {
    const winNonTrump = canWin.filter(c => !isT(c));
    if (winNonTrump.length) return byLowRank(winNonTrump)[0]; // billig mit Nicht-Trumpf gewinnen
    // Nur per Trumpf zu gewinnen: 0-Punkte-Stiche nicht mit Trumpf verschwenden,
    // wenn noch ein Gegner nach mir kommt (könnte eh überstechen).
    if (trickPoints === 0 && !isLast) return dump();
    return byLowRank(canWin)[0];                 // niedrigsten gewinnenden Trumpf
  }

  // ---- Kann nicht gewinnen -> gefahrlos abwerfen ----
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
