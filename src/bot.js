// bot.js — Starke KI, die wie ein echter Spieler spielt: nur eigene Karten +
// öffentlich gespielte Karten (Kartengedächtnis). Kein Blick in fremde Hände.
import {
  SUITS, suitOf, strengthOf, pointsOf, legalCards, currentWinnerSeat,
  partnerOf, teamOf, beats, isTrump, trumpStrength, makeDeck,
  effSuit, determineRoundWinner,
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
export function chooseCardHeuristic(hand, trick, trump, mit, seat, playedCards = [], seatVoids = [], cfg = DEFAULT_CFG) {
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

// ================= PIMC (Perfect Information Monte Carlo) =================
// Vorausschauende Suche mit Gegnerkarten-Schätzung: viele plausible
// Kartenverteilungen der anderen samplen (konsistent mit gesehenen Karten +
// erkannten Voids), jede bis zum Rundenende durchspielen (Heuristik als
// Rollout-Policy) und die Karte mit dem besten Schnitt wählen.
// handCounts: aktuelle Restkartenzahl je Sitz (öffentlich). takerTeam: Trumpfmacher-Team.
const PIMC_SAMPLES = 24;

export function chooseCard(hand, trick, trump, mit, seat, playedCards = [], seatVoids = [], handCounts = null, takerTeam = null, cfg = DEFAULT_CFG) {
  const legal = legalCards(hand, trick, trump, mit);
  if (legal.length === 1) return legal[0];
  if (!handCounts || takerTeam == null) {
    return chooseCardHeuristic(hand, trick, trump, mit, seat, playedCards, seatVoids, cfg);
  }

  const esOf = c => effSuit(c, trump, mit);
  const seen = new Set([...hand, ...playedCards, ...trick.map(t => t.card)]);
  const unseen = ALL_CARDS.filter(c => !seen.has(c));
  const others = [0, 1, 2, 3].filter(s => s !== seat);
  const need = {}; let sum = 0;
  for (const o of others) { need[o] = handCounts[o]; sum += handCounts[o]; }
  if (sum !== unseen.length) {
    return chooseCardHeuristic(hand, trick, trump, mit, seat, playedCards, seatVoids, cfg);
  }

  const botTeam = teamOf(seat);
  const scores = new Map(legal.map(c => [c, 0]));
  for (let k = 0; k < PIMC_SAMPLES; k++) {
    const dealt = determinize(unseen, need, seatVoids, esOf);
    for (const cand of legal) {
      const hands = { [seat]: hand.filter(c => c !== cand) };
      for (const o of others) hands[o] = dealt[o].slice();
      const rTrick = trick.map(t => ({ seat: t.seat, card: t.card }));
      rTrick.push({ seat, card: cand });
      const played = playedCards.slice(); played.push(cand);
      const voids = seatVoids.map(s => new Set(s));
      if (trick.length > 0) {
        const le = esOf(trick[0].card);
        if (!isTrump(cand, trump, mit) && esOf(cand) !== le) voids[seat].add(le);
      }
      const captured = { A: 0, B: 0 }, tricksWon = { A: 0, B: 0 };
      rollout(hands, rTrick, (seat + 1) % 4, trump, mit, played, voids, captured, tricksWon, cfg);
      scores.set(cand, scores.get(cand) + rolloutScore(captured, tricksWon, botTeam, takerTeam, mit));
    }
  }
  let best = legal[0], bestScore = -Infinity;
  for (const c of legal) { const s = scores.get(c); if (s > bestScore) { bestScore = s; best = c; } }
  return best;
}

// Verteilt die unsichtbaren Karten zufällig auf die anderen Sitze,
// gemäß deren Restkartenzahl und ohne bekannte Void-Farben.
function determinize(unseen, need, voids, esOf) {
  const seats = Object.keys(need).map(Number);
  for (let attempt = 0; attempt < 25; attempt++) {
    const rem = {}; seats.forEach(s => rem[s] = need[s]);
    const hands = {}; seats.forEach(s => hands[s] = []);
    const order = unseen.slice();
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const eligCount = card => { const s = esOf(card); let n = 0; for (const x of seats) if (rem[x] > 0 && !(voids[x] && voids[x].has(s))) n++; return n; };
    order.sort((a, b) => eligCount(a) - eligCount(b)); // am stärksten eingeschränkte zuerst
    let ok = true;
    for (const card of order) {
      const s = esOf(card);
      const cand = seats.filter(x => rem[x] > 0 && !(voids[x] && voids[x].has(s)));
      if (!cand.length) { ok = false; break; }
      const pick = cand[Math.floor(Math.random() * cand.length)];
      hands[pick].push(card); rem[pick]--;
    }
    if (ok) return hands;
  }
  const rem = {}; seats.forEach(s => rem[s] = need[s]); const hands = {}; seats.forEach(s => hands[s] = []);
  const cards = unseen.slice();
  for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
  let idx = 0; for (const s of seats) for (let n = 0; n < need[s]; n++) hands[s].push(cards[idx++]);
  return hands;
}

// Spielt eine determinisierte Hand mit der Heuristik bis zum Ende durch.
function rollout(hands, trick, turnSeat, trump, mit, played, voids, captured, tricksWon, cfg) {
  let cur = turnSeat, guard = 0;
  while (guard++ < 40) {
    if (trick.length === 4) {
      const w = trick[localWinnerIdx(trick, trump, mit)].seat;
      captured[teamOf(w)] += trick.reduce((s, t) => s + pointsOf(t.card), 0);
      tricksWon[teamOf(w)]++;
      trick.length = 0; cur = w;
      if (!hands[0].length && !hands[1].length && !hands[2].length && !hands[3].length) break;
    }
    const seat = cur;
    const card = chooseCardHeuristic(hands[seat], trick, trump, mit, seat, played, voids, cfg);
    if (trick.length > 0) {
      const le = effSuit(trick[0].card, trump, mit);
      if (!isTrump(card, trump, mit) && effSuit(card, trump, mit) !== le) voids[seat].add(le);
    }
    played.push(card);
    hands[seat] = hands[seat].filter(c => c !== card);
    trick.push({ seat, card });
    cur = (cur + 1) % 4;
  }
}

function rolloutScore(captured, tricksWon, botTeam, takerTeam, mit) {
  const oppTeam = botTeam === 'A' ? 'B' : 'A';
  const winner = determineRoundWinner(captured, takerTeam);
  const vole = tricksWon[winner] === 6;
  const spielwert = (mit ? 2 : 1) + (vole ? 1 : 0);
  const benefit = (winner === botTeam ? spielwert : 0) - (takerTeam === botTeam && winner !== botTeam ? 1 : 0);
  return benefit * 100 + (captured[botTeam] - captured[oppTeam]); // Sieg zählt am meisten, Punktemarge als Feinschliff
}
