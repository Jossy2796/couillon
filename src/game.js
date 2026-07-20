// game.js — Reine Spiel-Engine für "Le Couillon" (Variante Joé).
// 4 Spieler (Sitze 0-3), 2 Teams über Kreuz: Team A = {0,2}, Team B = {1,3}.
// 24 Karten (9,10,B,D,K,A in 4 Farben). Ansager-Team muss > 20 Punkte holen.
//
// Sonderregeln dieser Variante:
//  - Kreuz-Dame (QC) ist IMMER Trumpf, egal welche Farbe angesagt ist.
//  - Pik-Dame (QS) wird Trumpf, wenn der Halter zu Beginn "Mit der Mit?" mit Ja
//    beantwortet (dann zählt die Hand 2 statt 1 Strich). Ist Pik selbst Trumpf,
//    ist QS ohnehin Trumpf.
//  - Trumpf-Rang (stärkste zuerst): Ass › Pik-Dame(bei Mit) › Kreuz-Dame › König
//    › (Trumpf-)Dame › Bube › 10 › 9. Die beiden Damen behalten IMMER ihren Rang.
//  - Man darf JEDERZEIT trumpfen; kein Stech- oder Überstichzwang.
//  - Wertung: Einsatz = 2 (Mit) bzw. 1 Strich; Kapott (alle 6 Stiche) +1 extra.

export const SUITS = ['S', 'H', 'D', 'C']; // Pik, Herz, Karo, Kreuz
export const RANKS = ['9', 'T', 'J', 'Q', 'K', 'A']; // T = 10

// Stärke für NICHT-Trumpf-Farben (höher = stärker).
export const RANK_STRENGTH = { '9': 0, 'T': 1, 'J': 2, 'Q': 3, 'K': 4, 'A': 5 };

// Kartenwerte für die Punktezählung (Summe = 40).
export const CARD_POINTS = { A: 4, K: 3, Q: 2, J: 1, T: 0, '9': 0 };

export const SUIT_NAMES = { S: 'Pik', H: 'Herz', D: 'Karo', C: 'Kreuz' };
export const SUIT_SYMBOLS = { S: '♠', H: '♥', D: '♦', C: '♣' };

export const CONFIG = {
  START_STRICHE: 13,  // beide Teams starten hier und zählen auf <= 0 herunter
  VOLE_BONUS: 1,      // Extra-Strich, wenn ein Team alle 6 Stiche macht (Vole)
};

// ---- Karten-Helfer -------------------------------------------------------

export function cardId(rank, suit) { return rank + suit; }
export function rankOf(card) { return card[0]; }
export function suitOf(card) { return card[1]; }
export function pointsOf(card) { return CARD_POINTS[rankOf(card)]; }
export function strengthOf(card) { return RANK_STRENGTH[rankOf(card)]; } // nur Nicht-Trumpf

export function teamOf(seat) { return seat % 2 === 0 ? 'A' : 'B'; }
export function partnerOf(seat) { return (seat + 2) % 4; }

export function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(cardId(r, s));
  return deck;
}

export function shuffle(deck, rng = Math.random) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---- Trumpf-Logik (mit Sonder-Damen) ------------------------------------

// Ist die Karte ein Trumpf? trump = angesagte Farbe, mit = Pik-Dame aktiv.
export function isTrump(card, trump, mit) {
  if (card === 'QC') return true;                 // Kreuz-Dame immer
  if (card === 'QS') return !!mit || trump === 'S'; // Pik-Dame bei Mit oder wenn Pik Trumpf
  return suitOf(card) === trump;
}

// Effektive Farbe zum Bedienen: 'T' für Trümpfe, sonst die natürliche Farbe.
export function effSuit(card, trump, mit) {
  return isTrump(card, trump, mit) ? 'T' : suitOf(card);
}

// Geordnete Trumpfliste (stärkste zuerst) für aktuelle Farbe + Mit-Zustand.
export function trumpOrderList(trump, mit) {
  const L = ['A' + trump];
  if (mit) L.push('QS');
  L.push('QC');
  L.push('K' + trump);
  const dameT = 'Q' + trump;
  if (dameT !== 'QC' && !(mit && dameT === 'QS')) L.push(dameT); // normale Trumpf-Dame
  L.push('J' + trump, 'T' + trump, '9' + trump);
  return L;
}

// Trumpf-Stärke (höher = stärker); -1 wenn kein Trumpf.
export function trumpStrength(card, trump, mit) {
  const L = trumpOrderList(trump, mit);
  const idx = L.indexOf(card);
  return idx < 0 ? -1 : (L.length - idx);
}

// ---- Stich-Auswertung ----------------------------------------------------

// Schlägt Karte a die aktuell führende Karte b? ledNat = natürliche Farbe der ersten Karte.
export function beats(a, b, ledNat, trump, mit) {
  const aT = isTrump(a, trump, mit), bT = isTrump(b, trump, mit);
  if (aT || bT) {
    if (aT && bT) return trumpStrength(a, trump, mit) > trumpStrength(b, trump, mit);
    return aT; // Trumpf schlägt Nicht-Trumpf
  }
  if (suitOf(a) !== ledNat) return false;
  if (suitOf(b) !== ledNat) return true;
  return strengthOf(a) > strengthOf(b);
}

// trick: [{seat, card}, ...] in Spielreihenfolge. Gibt Gewinner-Index zurück.
export function trickWinnerIndex(trick, trump, mit) {
  const ledNat = suitOf(trick[0].card);
  let best = 0;
  for (let i = 1; i < trick.length; i++) {
    if (beats(trick[i].card, trick[best].card, ledNat, trump, mit)) best = i;
  }
  return best;
}

export function currentWinnerSeat(trick, trump, mit) {
  if (trick.length === 0) return null;
  return trick[trickWinnerIndex(trick, trump, mit)].seat;
}

// ---- Regel: welche Karten sind erlaubt? ----------------------------------
// Bedienpflicht: Man MUSS die angespielte Farbe bekennen, wenn man sie hat.
// Ausnahme: Trumpf darf man jederzeit spielen (statt zu bedienen).
// Kann man nicht bedienen, ist jede Karte erlaubt. Kein Überstichzwang.
export function legalCards(hand, trick, trump, mit) {
  if (trick.length === 0) return hand.slice(); // Anspieler: freie Wahl
  const ledEff = effSuit(trick[0].card, trump, mit);
  const ofLed = hand.filter(c => effSuit(c, trump, mit) === ledEff);
  if (ofLed.length > 0) {
    const trumps = hand.filter(c => isTrump(c, trump, mit));
    const allowed = new Set([...ofLed, ...trumps]);
    return hand.filter(c => allowed.has(c)); // bedienen ODER trumpfen
  }
  return hand.slice(); // kann nicht bedienen -> beliebig
}

export function isLegal(card, hand, trick, trump, mit) {
  return legalCards(hand, trick, trump, mit).includes(card);
}

// Sortiert eine Hand: Trümpfe zuerst (nach Stärke), dann Nebenfarben.
export function sortHand(hand, trump, mit) {
  const suitOrder = { S: 0, H: 1, D: 2, C: 3 };
  return hand.slice().sort((x, y) => {
    const xT = isTrump(x, trump, mit), yT = isTrump(y, trump, mit);
    if (xT && yT) return trumpStrength(y, trump, mit) - trumpStrength(x, trump, mit);
    if (xT) return -1;
    if (yT) return 1;
    if (suitOf(x) !== suitOf(y)) return suitOrder[suitOf(x)] - suitOrder[suitOf(y)];
    return strengthOf(y) - strengthOf(x);
  });
}

// ---- Wer hält die Pik-Dame? ----------------------------------------------
export function seatWithQS(hands) {
  return hands.findIndex(h => h.includes('QS'));
}

// ---- Runden-Auswertung ---------------------------------------------------

// Sieger der Runde: mehr Kartenpunkte gewinnt. Bei 20:20 gewinnt das Team,
// das den Trumpf NICHT gewählt hat.
export function determineRoundWinner(capturedPoints, trumpMakerTeam) {
  if (capturedPoints.A > capturedPoints.B) return 'A';
  if (capturedPoints.B > capturedPoints.A) return 'B';
  return trumpMakerTeam === 'A' ? 'B' : 'A';
}

// spielwertBase = 1 (normal) + 1 (Mit) + Klopfen/Re. Vole wird hier addiert.
// Sieger zieht den Spielwert von seinen Strichen ab. Verliert das
// Trumpfmacher-Team, bekommt es +1 Strich angemacht.
export function scoreRound(capturedPoints, tricksWon, trumpMakerTeam, spielwertBase, config = CONFIG) {
  const winner = determineRoundWinner(capturedPoints, trumpMakerTeam);
  const loser = winner === 'A' ? 'B' : 'A';
  const vole = tricksWon[winner] === 6;
  const spielwert = spielwertBase + (vole ? config.VOLE_BONUS : 0);
  const trumpMakerLost = loser === trumpMakerTeam;

  return {
    winner, loser, vole, spielwert,
    winnerDelta: -spielwert,          // Sieger: Striche runter
    loserPenalty: trumpMakerLost ? 1 : 0, // Trumpfmacher-Team verliert -> +1
    trumpMakerLost, trumpMakerTeam,
    pointsA: capturedPoints.A, pointsB: capturedPoints.B,
  };
}
