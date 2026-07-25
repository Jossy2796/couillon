// Tests für die Bot-Strategie. Ausführen mit: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseCard } from './bot.js';

// --- Grundlegendes Zusammenspiel ---
test('Bot übersticht den führenden Partner nicht (schmiert Punkte)', () => {
  const hand = ['AH', 'KD', 'TD']; // AH = Trumpf
  const trick = [{ seat: 0, card: 'AS' }, { seat: 1, card: '9H' }, { seat: 2, card: '9D' }];
  const card = chooseCard(hand, trick, 'H', false, 3);
  assert.notEqual(card, 'AH', 'Trumpf-Ass nicht verschwenden');
  assert.equal(card, 'KD', 'König als Punkte auf den sicheren Partner-Stich');
});

test('Partner führt unsicher (Gegner kommt noch) -> niedrig, keine Punkte riskieren', () => {
  const trick = [{ seat: 0, card: '9H' }]; // Partner (Sitz 0) führt niedrig
  const card = chooseCard(['AS', 'KD', 'TD'], trick, 'H', false, 2);
  assert.equal(card, 'TD');
});

test('Gegner führt: billig mit Nicht-Trumpf gewinnen', () => {
  const card = chooseCard(['KS', 'AS', '9H'], [{ seat: 0, card: 'JS' }], 'H', false, 1);
  assert.equal(card, 'KS', 'mit König gewinnen, Ass sparen');
});

test('Kann nicht gewinnen -> niedrige Nicht-Trumpf-Karte abwerfen', () => {
  const trick = [{ seat: 0, card: 'AS' }, { seat: 1, card: 'KH' }];
  const card = chooseCard(['AD', 'TD', '9H'], trick, 'H', false, 2);
  assert.equal(card, 'TD');
});

// --- Neue, stärkere Strategien mit Kartengedächtnis ---
test('Anspiel: Trümpfe ziehen mit unschlagbarem Trumpf + Länge', () => {
  const hand = ['AH', 'KH', 'QH', '9S', 'TD', '9C']; // 3 Trümpfe, AH ist höchster
  const card = chooseCard(hand, [], 'H', false, 0);
  assert.equal(card, 'AH', 'höchsten Trumpf anspielen, um Gegner-Trümpfe zu ziehen');
});

test('Anspiel: Top-Ass einer Nebenfarbe cashen (laut Arena die stärkere Wahl)', () => {
  const hand = ['AS', '9S', 'TD', '9C', 'JD', 'TC']; // AS = Top-Pik
  const card = chooseCard(hand, [], 'H', false, 0);
  assert.equal(card, 'AS');
});

test('Anspiel: Ass cashen, wenn keine Trümpfe mehr draußen sind', () => {
  // alle 7 Trümpfe (6 Herz + Kreuz-Dame) sind weg -> AS ist unschlagbar
  const played = ['AH', 'KH', 'QH', 'JH', 'TH', '9H', 'QC'];
  const card = chooseCard(['AS', '9C'], [], 'H', false, 0, played);
  assert.equal(card, 'AS', 'jetzt sicher -> Ass cashen');
});

test('Gegner führt kleinen Stich: mittleren Trumpf NICHT verschwenden', () => {
  const trick = [{ seat: 0, card: '9C' }]; // 0 Punkte
  const card = chooseCard(['KH', 'TD', '9S'], trick, 'H', false, 1);
  assert.notEqual(card, 'KH', 'König-Trumpf für 0 Punkte + Überstich-Risiko sparen');
});

test('Gegner führt Ass (Punkte): mit billigem Trumpf holen', () => {
  const trick = [{ seat: 0, card: 'AC' }]; // 4 Punkte
  const card = chooseCard(['9H', 'TD', 'KS'], trick, 'H', false, 1);
  assert.equal(card, '9H', 'billiger Trumpf holt die 4 Punkte');
});

test('Anspiel: sicheren Gewinner cashen, wenn keine Trümpfe mehr draußen sind', () => {
  const played = ['AH', 'KH', 'QH', 'JH', 'TH', '9H', 'QC', 'AS']; // alle Trümpfe + Pik-Ass weg
  const card = chooseCard(['KS', '9D'], [], 'H', false, 0, played);
  assert.equal(card, 'KS', 'König Pik ist jetzt unschlagbar -> cashen');
});
