// Stresstest: viele volle Spiele mit dem "Leicht"-Bot (chooseCardEasy) + Mix.
import { makeDeck, shuffle, isLegal, trickWinnerIndex, isTrump, effSuit, teamOf } from '../src/game.js';
import { chooseCardEasy, chooseCardHeuristic, chooseCard, decideTrump, decideMit } from '../src/bot.js';
let illegal = 0, errors = 0, done = 0;
const pick = (level, hands, seat, trick, trump, mit, played, voids, takerTeam, qs) => {
  if (level === 'easy') return chooseCardEasy(hands[seat], trick, trump, mit);
  if (level === 'medium') return chooseCardHeuristic(hands[seat], trick, trump, mit, seat, played, voids);
  return chooseCard(hands[seat], trick, trump, mit, seat, played, voids, hands.map(h => h.length), takerTeam, qs);
};
const levels = ['easy', 'medium', 'hard'];
for (let g = 0; g < 3000; g++) {
  try {
    const level = levels[g % 3];
    const deck = shuffle(makeDeck()); const hands = [[], [], [], []];
    for (let i = 0; i < 24; i++) hands[i % 4].push(deck[i]);
    const dealer = Math.floor(Math.random() * 4), eldest = (dealer + 1) % 4;
    const trump = decideTrump(hands[eldest].slice(0, 3)); const takerTeam = teamOf(eldest);
    const qs = hands.findIndex(h => h.includes('QS')); const mit = decideMit(hands[qs], trump, qs, takerTeam);
    const played = [], voids = [new Set(), new Set(), new Set(), new Set()]; let lead = eldest;
    for (let t = 0; t < 6; t++) {
      const trick = [];
      for (let k = 0; k < 4; k++) {
        const seat = (lead + k) % 4;
        const card = pick(level, hands, seat, trick, trump, mit, played, voids, takerTeam, qs);
        if (!isLegal(card, hands[seat], trick, trump, mit)) illegal++;
        if (trick.length > 0) { const le = effSuit(trick[0].card, trump, mit); if (!isTrump(card, trump, mit) && effSuit(card, trump, mit) !== le) voids[seat].add(le); }
        played.push(card); hands[seat] = hands[seat].filter(c => c !== card); trick.push({ seat, card });
      }
      lead = trick[trickWinnerIndex(trick, trump, mit)].seat;
    }
    if (hands.some(h => h.length)) errors++;
    done++;
  } catch (e) { errors++; if (errors <= 3) console.log('ERR', e && e.stack); }
}
console.log(JSON.stringify({ done, illegal, errors }));
