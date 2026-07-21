// Tests für die Bot-Strategie. Ausführen mit: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseCard } from './bot.js';

// Szenario aus dem Feedback: Partner (Sitz 1) führt mit einem Trumpf.
// Der Bot (Sitz 3, letzter) darf NICHT mit einem höheren Trumpf überstechen,
// sondern soll Punkte mit einer Nicht-Trumpf-Karte schmieren.
test('Bot übersticht den führenden Partner nicht', () => {
  const hand = ['AH', 'KD', 'TD']; // AH = Trumpf (Herz), KD/TD = Karo
  const trick = [
    { seat: 0, card: 'AS' },  // Gegner spielt Nicht-Trumpf-Ass an
    { seat: 1, card: '9H' },  // Partner trumpft -> führt
    { seat: 2, card: '9D' },  // Gegner wirft ab
  ];
  const card = chooseCard(hand, trick, 'H', false, 3);
  assert.notEqual(card, 'AH', 'Bot darf den Trumpf-Ass nicht verschwenden');
  assert.equal(card, 'KD', 'Bot schmiert den König (Punkte) auf den Partner-Stich');
});

test('Partner führt, aber Stich unsicher (noch Gegner nach mir) -> niedrig, keine Punkte riskieren', () => {
  // Partner = Sitz 0 führt mit niedrigem Trumpf; Bot = Sitz 2; Sitz 3 kommt noch.
  const trick = [{ seat: 0, card: '9H' }];
  const card = chooseCard(['AS', 'KD', 'TD'], trick, 'H', false, 2);
  assert.equal(card, 'TD', 'niedrigste Nicht-Trumpf-Karte, nicht das Ass verschenken');
});

test('Gegner führt: billig mit Nicht-Trumpf gewinnen statt zu trumpfen', () => {
  const hand = ['KS', 'AS', '9H']; // 9H = Trumpf; KS/AS = Pik
  const trick = [{ seat: 0, card: 'JS' }]; // Gegner führt Pik-Bube
  const card = chooseCard(hand, trick, 'H', false, 1);
  assert.equal(card, 'KS', 'mit dem König gewinnen, Ass und Trumpf sparen');
});

test('Kann nicht gewinnen -> niedrige Nicht-Trumpf-Karte abwerfen, Trumpf/Ass sparen', () => {
  const hand = ['AD', 'TD', '9H']; // 9H Trumpf, AD/TD Karo
  const trick = [
    { seat: 0, card: 'AS' },
    { seat: 1, card: 'KH' }, // Gegner trumpft hoch -> führt
  ];
  // Bot Sitz 2, kann KH (Trumpf) nur mit 9H nicht schlagen -> abwerfen; TD (0 Punkte)
  const card = chooseCard(hand, trick, 'H', false, 2);
  assert.equal(card, 'TD');
});
