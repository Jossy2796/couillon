// Regressions-Check: neuer PIMC vs. Heuristik über DUPLIKAT-Deals (gleiche Karten,
// PIMC spielt beide Seiten) -> Deal-Glück gekürzt. Erwartung laut Doku ~60% für PIMC.
import { makeDeck, shuffle, trickWinnerIndex, effSuit, isTrump, teamOf, determineRoundWinner } from '../src/game.js';
import { chooseCard, chooseCardHeuristic, decideTrump, decideMit } from '../src/bot.js';

function playRound(hands0, dealer, pimcTeam) {
  const hands = hands0.map(h => h.slice());
  const eldest = (dealer + 1) % 4;
  const trump = decideTrump(hands[eldest].slice(0, 3));
  const takerTeam = teamOf(eldest);
  const qs = hands.findIndex(h => h.includes('QS'));
  const mit = decideMit(hands[qs], trump, qs, takerTeam);
  const played = [], voids = [new Set(), new Set(), new Set(), new Set()];
  const captured = { A: 0, B: 0 }, tricksWon = { A: 0, B: 0 };
  let lead = eldest;
  for (let t = 0; t < 6; t++) {
    const trick = [];
    for (let k = 0; k < 4; k++) {
      const seat = (lead + k) % 4;
      const usePimc = teamOf(seat) === pimcTeam;
      const card = usePimc
        ? chooseCard(hands[seat], trick, trump, mit, seat, played, voids, hands.map(h => h.length), takerTeam, qs)
        : chooseCardHeuristic(hands[seat], trick, trump, mit, seat, played, voids);
      if (trick.length > 0) { const le = effSuit(trick[0].card, trump, mit); if (!isTrump(card, trump, mit) && effSuit(card, trump, mit) !== le) voids[seat].add(le); }
      played.push(card); hands[seat] = hands[seat].filter(c => c !== card); trick.push({ seat, card });
    }
    const wi = trickWinnerIndex(trick, trump, mit); lead = trick[wi].seat;
    const w = teamOf(lead); tricksWon[w]++;
    captured[w] += trick.reduce((s, x) => s + (require_pts(x.card)), 0);
  }
  return determineRoundWinner(captured, takerTeam);
}
import { pointsOf } from '../src/game.js';
function require_pts(c) { return pointsOf(c); }

const GAMES = Number(process.argv[2] || 800);
let pimcWins = 0, total = 0;
const t0 = Date.now();
for (let g = 0; g < GAMES; g++) {
  const deck = shuffle(makeDeck());
  const hands = [[], [], [], []];
  for (let i = 0; i < 24; i++) hands[i % 4].push(deck[i]);
  const dealer = g % 4;
  if (playRound(hands, dealer, 'A') === 'A') pimcWins++; total++;
  if (playRound(hands, dealer, 'B') === 'B') pimcWins++; total++;
}
console.log(`PIMC (neu) vs Heuristik: ${(pimcWins / total * 100).toFixed(1)}% Rundensiege (${total} Runden, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
