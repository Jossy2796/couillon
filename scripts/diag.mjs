import { makeDeck } from '../src/game.js';
import { chooseCard, chooseCardHeuristic } from '../src/bot.js';

// Szenario A (Beschwerde 1): Gegner (Sitz 2) sticht mit QH und führt.
// Bot Sitz 3 ist LETZTER, hat 9H (toter niedriger Trumpf) + Abwurfkarten, kein Pik.
// Sinnvoll: eine niedrige Nicht-Trumpf-Karte abwerfen, NICHT 9H verschwenden.
const trump = 'H', mit = false, seat = 3;
const hand = ['9H', 'TD', '9C', 'JD'];
const trick = [{ seat: 0, card: 'AS' }, { seat: 1, card: 'KS' }, { seat: 2, card: 'QH' }];
const unseen = ['AH', 'KH', 'JH', 'TH', 'QS', 'JS', '9S', 'AD', 'KD']; // 9H ist tot (AH/KH/JH/TH noch draußen)
const played = makeDeck().filter(c => !hand.includes(c) && !unseen.includes(c)); // 11 (inkl. Trick)
const voids = [new Set(), new Set(), new Set(), new Set()];
const handCounts = [3, 3, 3, 4];

console.log('MITTEL (Heuristik):', chooseCardHeuristic(hand, trick, trump, mit, seat, played, voids));
const cnt = {};
for (let i = 0; i < 300; i++) {
  const c = chooseCard(hand, trick, trump, mit, seat, played, voids, handCounts, 'A', null);
  cnt[c] = (cnt[c] || 0) + 1;
}
console.log('SCHWER (PIMC) Verteilung:', JSON.stringify(cnt));
console.log('=> 9H (Trumpf-Verschwendung) Anteil:', ((cnt['9H'] || 0) / 300 * 100).toFixed(0) + '%');
