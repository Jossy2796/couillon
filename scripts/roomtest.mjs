// Logiktest für Auto-Play-Übernahme, Assist, Abwerfen, Mit-Verbergen, Klopf-Liste.
import { Room } from '../src/room.js';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FEHLT:', m); } };

function fresh() {
  const r = new Room('TEST', () => {});
  r.addHuman('h1', 'Ich');   // Sitz 0 = Mensch (Host)
  r.addBot(1); r.addBot(2); r.addBot(3);
  return r;
}

// --- isFullAuto / missStreak / Strikes ---
let r = fresh();
const H = r.seats[0];
r.phase = 'playing'; r.trump = 'H'; r.mit = false; r.turnSeat = 0;
r.hands = [['9C', 'TD', '9S'], ['AH'], ['KH'], ['QH']];
ok(r.isFullAuto(0) === false, 'frisch: keine Voll-Übernahme');
// Auto-Play NUR bei assist/muck — niemals durch "verpasste Züge".
H.missStreak = 5; ok(r.isFullAuto(0) === false, 'verpasste Züge lösen KEINE Auto-Übernahme aus');
ok(r.isFullAuto(1) === false, 'Bot ist nie in Voll-Übernahme');

// --- Assist an/aus ---
r.setAssist('h1', true); ok(H.assist === true && r.isFullAuto(0) === true, 'Assist an -> Bot spielt');
r.setAssist('h1', false); ok(H.assist === false && r.isFullAuto(0) === false, 'Assist aus -> Mensch spielt selbst');

// --- resume ---
H.assist = true; r.resumeControl('h1');
ok(H.assist === false && r.isFullAuto(0) === false, 'resume: wieder selbst spielen');

// --- canMuck / Abwerfen ---
r = fresh();
r.phase = 'playing'; r.trump = 'H'; r.mit = false; r.turnSeat = 0;
r.hands = [['9C', 'TD', '9S'], ['AH'], ['KH'], ['QH']];
ok(r.stateFor('h1').canMuck === true, 'canMuck: nur wertlose Nicht-Trümpfe -> Frage möglich');
r.hands[0] = ['9C', '9H'];   // 9H ist Trumpf
ok(r.stateFor('h1').canMuck === false, 'canMuck: mit Trumpf -> nein');
r.hands[0] = ['9C', 'KD'];   // KD = 3 Punkte
ok(r.stateFor('h1').canMuck === false, 'canMuck: mit Punktkarte -> nein');
r.hands[0] = ['9C', 'TD', '9S'];
r.playerMuck('h1');
ok(r.seats[0].muck === true && r.isFullAuto(0) === true, 'playerMuck setzt Abwerfen + Voll-Übernahme');
r.hands[0] = ['9C', '9H']; r.seats[0].muck = false;
r.playerMuck('h1');
ok(r.seats[0].muck === false, 'playerMuck lehnt ab, wenn Trumpf in der Hand');

// --- Mit-Entscheider verbergen ---
r = fresh();
r.phase = 'mit'; r.qsHolder = 1; r.mit = false;
ok(r.stateFor('h1').qsHolder === null, 'Mit offen: qsHolder für andere verborgen');
ok(r.stateFor('h1').mitPending === true, 'mitPending Flag gesetzt');
ok(r.stateFor('bot-1').qsHolder === 1, 'Mit offen: Halter sieht sich selbst');
r.mit = true;
ok(r.stateFor('h1').qsHolder === 1, 'Nach Mit-Ansage: qsHolder öffentlich');

// --- Klopf-Liste ---
r = fresh();
r.phase = 'kontra'; r.mitTeam = 'A'; r.kontraTurn = 'B';
r.spielwertBase = 2; r.knocks = []; r.kontraPassed = new Set();
r.applyKontra(1, 'raise');  // Sitz 1 = Team B klopft
if (r._timer) clearTimeout(r._timer);
ok(r.knocks.length === 1 && r.knocks[0].label === 'Klopfen' && r.knocks[0].seat === 1, 'Klopfen wird in knocks erfasst');
ok(r.stateFor('h1').knocks.length === 1, 'knocks im State sichtbar');

// --- autoAct-Schutz: verwaister/verfrühter Timer darf NICHT für einen Menschen spielen ---
r = fresh();
r.phase = 'playing'; r.trump = 'H'; r.mit = false; r.turnSeat = 0; r.currentTrick = [];
r.hands = [['9C', 'TD'], ['AH'], ['KH'], ['QH']];
const n0 = r.hands[0].length;
// Frist noch NICHT abgelaufen -> autoAct darf nichts tun (verhindert "Bot spielt sofort")
r.autoForSeat = 0; r.autoDeadline = Date.now() + 10000;
r.autoAct(); if (r._timer) { clearTimeout(r._timer); r._timer = null; }
ok(r.hands[0].length === n0, 'autoAct spielt NICHT vor Ablauf der 15s-Frist (Anti-Instant-Bug)');
// Falscher Sitz in autoForSeat (verwaister Timer eines anderen Zugs) -> nichts tun
r.autoForSeat = 2; r.autoDeadline = Date.now() - 100;
r.autoAct(); if (r._timer) { clearTimeout(r._timer); r._timer = null; }
ok(r.hands[0].length === n0, 'autoAct ignoriert Timer, der nicht zu diesem Sitz gehört');
// Frist wirklich abgelaufen -> jetzt darf der Bot einen Zug machen
r.autoForSeat = 0; r.autoDeadline = Date.now() - 100;
r.autoAct(); if (r._timer) { clearTimeout(r._timer); r._timer = null; }
ok(r.hands[0].length === n0 - 1, 'autoAct spielt nach abgelaufener Frist');
// Assist an -> darf sofort spielen (unabhängig von der Frist)
r = fresh();
r.phase = 'playing'; r.trump = 'H'; r.mit = false; r.turnSeat = 0; r.currentTrick = [];
r.hands = [['9C', 'TD'], ['AH'], ['KH'], ['QH']];
r.seats[0].assist = true; r.autoForSeat = null; r.autoDeadline = null;
r.autoAct(); if (r._timer) { clearTimeout(r._timer); r._timer = null; }
ok(r.hands[0].length === 1, 'autoAct spielt bei Assist sofort');

console.log(`\n${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
