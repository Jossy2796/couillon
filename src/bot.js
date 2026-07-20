// bot.js — Einfache, aber vernünftige KI für Ansage, Mit-Entscheidung und Kartenspiel.
import {
  SUITS, suitOf, strengthOf, pointsOf, legalCards, currentWinnerSeat,
  partnerOf, teamOf, beats, isTrump, trumpStrength,
} from './game.js';

// ---- Trumpfwahl (Spieler links vom Geber, anhand von 3 Karten, kein Passen) --
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
    if (c === 'QC') score += 3;                 // Kreuz-Dame ist immer stark
    if (t && strengthOf(c) === 5) score += 3;   // Trumpf-Ass
    else if (t && strengthOf(c) === 4) score += 2; // Trumpf-König
    if (!t && strengthOf(c) === 5) score += 2;  // Nebenfarben-Ass
  }
  if (hand.includes('QS')) score += 1;          // Pik-Dame (potenzielles Mit)
  return score;
}

// ---- Mit-Entscheidung (Halter der Pik-Dame) ------------------------------
// takerTeam = Team des Ansagers, seat = Sitz des Bots.
export function decideMit(hand, trump, seat, takerTeam) {
  const onTakerTeam = teamOf(seat) === takerTeam;
  // Anzahl starker Trümpfe grob schätzen (bei aktivem Mit).
  const strongTrumps = hand.filter(c => isTrump(c, trump, true) && trumpStrength(c, trump, true) >= 5).length;
  const trumpCount = hand.filter(c => isTrump(c, trump, true)).length;
  // Nur "Mit" (Einsatz verdoppeln), wenn man im Ansager-Team ist und stark wirkt.
  return onTakerTeam && (strongTrumps >= 2 || trumpCount >= 4);
}

// ---- Kartenwahl ----------------------------------------------------------
export function chooseCard(hand, trick, trump, mit, seat) {
  const legal = legalCards(hand, trick, trump, mit);
  if (legal.length === 1) return legal[0];

  const val = c => pointsOf(c);
  const str = c => isTrump(c, trump, mit) ? 100 + trumpStrength(c, trump, mit) : strengthOf(c);
  const lowest = arr => arr.slice().sort((a, b) => (val(a) - val(b)) || (str(a) - str(b)))[0];
  const highestPoints = arr => arr.slice().sort((a, b) => (val(b) - val(a)) || (str(b) - str(a)))[0];

  // Anspieler
  if (trick.length === 0) {
    const sideAces = legal.filter(c => !isTrump(c, trump, mit) && strengthOf(c) === 5);
    if (sideAces.length) return sideAces[0];
    const nonTrump = legal.filter(c => !isTrump(c, trump, mit));
    if (nonTrump.length) return lowest(nonTrump);
    return lowest(legal);
  }

  const ledNat = suitOf(trick[0].card);
  const winnerSeat = currentWinnerSeat(trick, trump, mit);
  const partnerWinning = winnerSeat === partnerOf(seat);
  const isLast = trick.length === 3;
  const winningCard = trick[trickWinnerIndexLocal(trick, trump, mit)].card;
  const canWin = legal.filter(c => beats(c, winningCard, ledNat, trump, mit));

  if (partnerWinning) {
    // Partner führt: als Letzter Punkte schmieren, sonst niedrig abwerfen.
    return isLast ? highestPoints(legal) : lowest(legal);
  }
  if (canWin.length > 0) {
    // billigste Gewinnkarte
    return canWin.slice().sort((a, b) => (str(a) - str(b)) || (val(a) - val(b)))[0];
  }
  return lowest(legal);
}

function trickWinnerIndexLocal(trick, trump, mit) {
  const ledNat = suitOf(trick[0].card);
  let best = 0;
  for (let i = 1; i < trick.length; i++) {
    if (beats(trick[i].card, trick[best].card, ledNat, trump, mit)) best = i;
  }
  return best;
}
