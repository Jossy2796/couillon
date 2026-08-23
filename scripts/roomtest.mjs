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
H.missStreak = 1; ok(r.isFullAuto(0) === false, '1 Strike: noch keine Voll-Übernahme');
H.missStreak = 2; ok(r.isFullAuto(0) === true, '2 Strikes: Voll-Übernahme aktiv');
r.humanActed(0); ok(H.missStreak === 0 && r.isFullAuto(0) === false, 'Aktion setzt Strikes zurück');
ok(r.isFullAuto(1) === false, 'Bot ist nie in Voll-Übernahme');

// --- Assist an/aus ---
r.setAssist('h1', true); ok(H.assist === true && r.isFullAuto(0) === true, 'Assist an -> Voll-Übernahme');
H.missStreak = 2; r.setAssist('h1', false); ok(H.assist === false && H.missStreak === 0, 'Assist aus -> zurückgesetzt');

// --- resume nach automatischer Übernahme ---
H.missStreak = 2; H.assist = true; r.resumeControl('h1');
ok(H.missStreak === 0 && H.assist === false, 'resume übernimmt wieder selbst');

// --- Reconnect setzt Strikes zurück ---
H.missStreak = 2; r.seats[0].connected = false; r.addHuman('h1', 'Ich');
ok(H.missStreak === 0, 'Reconnect setzt Strikes zurück');

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

console.log(`\n${pass} ok, ${fail} fehlgeschlagen`);
process.exit(fail ? 1 : 0);
