import { makeDeck } from '../src/game.js';
import { chooseCard, chooseCardHeuristic } from '../src/bot.js';

// Szenario B (Beschwerde 2): Partner (Sitz 1) FÜHRT sicher mit Karo-Ass.
// Bot Sitz 3 ist LETZTER, hat 9H (Trumpf) + KS (3 Pkt) + 9C. Kein Karo.
// Sinnvoll: KS drauflegen (3 Punkte "schmieren"), Stich bleibt beim Partner.
// FALSCH: 9H spielen -> überstiche unnötig den eigenen Partner (Trumpf verschwendet).
const trump = 'H', mit = false, seat = 3;
const hand = ['9H', 'KS', '9C'];
const trick = [{ seat: 0, card: 'KD' }, { seat: 1, card: 'AD' }, { seat: 2, card: '9D' }];
const unseen = ['AH', 'KH', 'QS', 'JS', 'TC', 'JC']; // Sitze 0,1,2 je 2 Karten
const played = makeDeck().filter(c => !hand.includes(c) && !unseen.includes(c)); // 15 (inkl. Trick)
const voids = [new Set(), new Set(), new Set(), new Set()];
const handCounts = [2, 2, 2, 3];

console.log('MITTEL (Heuristik):', chooseCardHeuristic(hand, trick, trump, mit, seat, played, voids));
const cnt = {};
for (let i = 0; i < 300; i++) {
  const c = chooseCard(hand, trick, trump, mit, seat, played, voids, handCounts, 'A', null);
  cnt[c] = (cnt[c] || 0) + 1;
}
console.log('SCHWER (PIMC) Verteilung:', JSON.stringify(cnt));
console.log('=> 9H (Partner unnötig überstochen) Anteil:', ((cnt['9H'] || 0) / 300 * 100).toFixed(0) + '%');
console.log('=> KS (richtig geschmiert) Anteil:', ((cnt['KS'] || 0) / 300 * 100).toFixed(0) + '%');
