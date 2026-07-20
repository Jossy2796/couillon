// Tests für die Spiel-Engine (Kujon, St. Vither Variante). Ausführen mit: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  makeDeck, pointsOf, isTrump, effSuit, trumpStrength, beats,
  trickWinnerIndex, legalCards, isLegal, scoreRound, determineRoundWinner,
  sortHand, seatWithQS,
} from './game.js';

test('Deck: 24 eindeutige Karten, 40 Punkte gesamt', () => {
  const deck = makeDeck();
  assert.equal(deck.length, 24);
  assert.equal(new Set(deck).size, 24);
  assert.equal(deck.reduce((s, c) => s + pointsOf(c), 0), 40);
});

test('Kreuz-Dame ist immer Trumpf (auch bei Herz-Trumpf)', () => {
  assert.equal(isTrump('QC', 'H', false), true);
  assert.equal(isTrump('QC', 'H', true), true);
  assert.equal(effSuit('QC', 'H', false), 'T');
});

test('Pik-Dame nur bei Mit (oder wenn Pik Trumpf) ein Trumpf', () => {
  assert.equal(isTrump('QS', 'H', false), false);
  assert.equal(isTrump('QS', 'H', true), true);
  assert.equal(isTrump('QS', 'S', false), true);
});

test('Trumpf-Rang: Ass › Pik-D › Kreuz-D › König (bei Mit)', () => {
  const s = c => trumpStrength(c, 'H', true);
  assert.ok(s('AH') > s('QS'));
  assert.ok(s('QS') > s('QC'));
  assert.ok(s('QC') > s('KH'));
  assert.ok(s('KH') > s('QH'));
});

test('Kreuz-Dame schlägt Trumpf-König, aber nicht das Trumpf-Ass', () => {
  assert.equal(beats('QC', 'KH', 'H', 'H', false), true);
  assert.equal(beats('QC', 'AH', 'H', 'H', false), false);
});

test('Stichgewinner: Kreuz-Dame sticht Nicht-Trumpf-Ass', () => {
  const trick = [
    { seat: 0, card: 'AS' }, { seat: 1, card: 'QC' },
    { seat: 2, card: 'KS' }, { seat: 3, card: '9S' },
  ];
  assert.equal(trickWinnerIndex(trick, 'H', false), 1);
});

test('Stichgewinner: höchste Anspielfarbe ohne Trumpf', () => {
  const trick = [
    { seat: 0, card: 'KH' }, { seat: 1, card: 'AH' },
    { seat: 2, card: '9H' }, { seat: 3, card: 'TS' },
  ];
  assert.equal(trickWinnerIndex(trick, 'C', false), 1);
});

test('Bedienpflicht: bekennen ODER trumpfen, keine andere Farbe', () => {
  const hand = ['AH', 'KH', '9S', 'AC']; // AC = Trumpf (C)
  const trick = [{ seat: 0, card: 'TH' }]; // Herz angespielt
  const legal = legalCards(hand, trick, 'C', false);
  assert.deepEqual(new Set(legal), new Set(['AH', 'KH', 'AC'])); // Herz bedienen oder Trumpf
  assert.equal(isLegal('9S', hand, trick, 'C', false), false); // andere Farbe NICHT erlaubt
});

test('Trumpf darf man jederzeit spielen (statt zu bedienen)', () => {
  const hand = ['AH', 'AC']; // AC = Trumpf
  const trick = [{ seat: 0, card: 'TH' }];
  assert.equal(isLegal('AC', hand, trick, 'C', false), true);
});

test('Kann nicht bedienen -> jede Karte erlaubt', () => {
  const hand = ['9S', 'TS', 'AD'];
  const trick = [{ seat: 0, card: 'KH' }]; // Herz, habe ich nicht
  assert.deepEqual(new Set(legalCards(hand, trick, 'C', false)), new Set(hand));
});

test('Trumpf angespielt -> Trumpf bedienen (kein Überstichzwang)', () => {
  const hand = ['9C', 'QC', 'AS']; // 9C, QC sind Trumpf
  const trick = [{ seat: 0, card: 'JC' }];
  assert.deepEqual(new Set(legalCards(hand, trick, 'C', false)), new Set(['9C', 'QC']));
});

test('sortHand: Trümpfe zuerst', () => {
  const hand = ['9S', 'AC', 'KH', 'QC', '9H'];
  const sorted = sortHand(hand, 'H', false);
  assert.ok(isTrump(sorted[0], 'H', false));
});

test('seatWithQS findet die Pik-Dame', () => {
  assert.equal(seatWithQS([['AH'], ['QS', '9C'], ['KD'], ['TS']]), 1);
});

test('Rundensieger: mehr Punkte gewinnt', () => {
  assert.equal(determineRoundWinner({ A: 25, B: 15 }, 'A'), 'A');
  assert.equal(determineRoundWinner({ A: 18, B: 22 }, 'A'), 'B');
});

test('Rundensieger: bei 20:20 gewinnt das Nicht-Trumpf-Team', () => {
  assert.equal(determineRoundWinner({ A: 20, B: 20 }, 'A'), 'B');
  assert.equal(determineRoundWinner({ A: 20, B: 20 }, 'B'), 'A');
});

test('Wertung: normale Runde, Trumpfmacher gewinnt -> Sieger −1', () => {
  const res = scoreRound({ A: 25, B: 15 }, { A: 4, B: 2 }, 'A', 1);
  assert.equal(res.winner, 'A');
  assert.equal(res.winnerDelta, -1);
  assert.equal(res.loserPenalty, 0);
});

test('Wertung: Trumpfmacher verliert -> Gegner −Spielwert, Trumpfmacher +1', () => {
  const res = scoreRound({ A: 18, B: 22 }, { A: 3, B: 3 }, 'A', 1); // A macht Trumpf, verliert
  assert.equal(res.winner, 'B');
  assert.equal(res.winnerDelta, -1);   // B zieht 1 ab
  assert.equal(res.loserPenalty, 1);   // A bekommt 1 angemacht
  assert.equal(res.trumpMakerLost, true);
});

test('Wertung: Mit + Klopfen + Re = Spielwert 4', () => {
  const res = scoreRound({ A: 30, B: 10 }, { A: 5, B: 1 }, 'A', 4);
  assert.equal(res.spielwert, 4);
  assert.equal(res.winnerDelta, -4);
});

test('Wertung: Vole gibt +1 auf den Spielwert', () => {
  const res = scoreRound({ A: 40, B: 0 }, { A: 6, B: 0 }, 'A', 2); // Mit(2) + Vole
  assert.equal(res.vole, true);
  assert.equal(res.spielwert, 3); // 2 + Vole 1
  assert.equal(res.winnerDelta, -3);
});
