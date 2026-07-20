// server.js — HTTP (statische Web-App) + WebSocket-Server für Mehrspieler-Räume.
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { Room } from './room.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const app = express();
app.disable('x-powered-by');
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));
app.get('/healthz', (_req, res) => res.type('text').send('ok'));
app.get('*', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ---- Raumverwaltung ----
const rooms = new Map();              // code -> Room
const clients = new Map();            // code -> Map(playerId -> ws)
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne verwechselbare Zeichen

function newCode() {
  let code;
  do {
    code = Array.from({ length: 4 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function broadcast(code) {
  const room = rooms.get(code);
  const map = clients.get(code);
  if (!room || !map) return;
  for (const [playerId, ws] of map) {
    if (ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(room.stateFor(playerId))); } catch { /* ignore */ }
    }
  }
}

function send(ws, obj) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
}

function registerClient(code, playerId, ws) {
  if (!clients.has(code)) clients.set(code, new Map());
  clients.get(code).set(playerId, ws);
  ws.roomCode = code;
  ws.playerId = playerId;
}

// ---- WebSocket-Handling ----
wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'createRoom') {
      const playerId = String(msg.playerId || '').slice(0, 64);
      if (!playerId) return send(ws, { type: 'error', message: 'Ungültige ID.' });
      const code = newCode();
      const room = new Room(code, () => broadcast(code));
      rooms.set(code, room);
      const res = room.addHuman(playerId, sanitizeName(msg.name));
      registerClient(code, playerId, ws);
      send(ws, { type: 'joined', code, seat: res.seat });
      broadcast(code);
      return;
    }

    if (msg.type === 'joinRoom') {
      const code = String(msg.code || '').toUpperCase().slice(0, 8);
      const playerId = String(msg.playerId || '').slice(0, 64);
      const room = rooms.get(code);
      if (!room) return send(ws, { type: 'error', message: 'Raum nicht gefunden.' });
      const res = room.addHuman(playerId, sanitizeName(msg.name));
      if (!res.ok) return send(ws, { type: 'error', message: res.error });
      registerClient(code, playerId, ws);
      send(ws, { type: 'joined', code, seat: res.seat, reconnect: res.reconnect });
      broadcast(code);
      return;
    }

    // Ab hier: Spielaktionen — Client muss einem Raum zugeordnet sein.
    const room = rooms.get(ws.roomCode);
    if (!room || !ws.playerId) return;
    room.handle(ws.playerId, msg);
  });

  ws.on('close', () => {
    const room = rooms.get(ws.roomCode);
    const map = clients.get(ws.roomCode);
    if (map && map.get(ws.playerId) === ws) map.delete(ws.playerId);
    if (room && ws.playerId) room.markDisconnected(ws.playerId);
  });

  ws.on('error', () => { /* ignore, close folgt */ });
});

function sanitizeName(name) {
  return String(name || '').replace(/[<>]/g, '').trim().slice(0, 16);
}

// ---- Heartbeat: tote Verbindungen erkennen (wichtig für mobiles Safari) ----
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    try { ws.ping(); } catch { /* ignore */ }
  }
}, 30000);

// ---- Leere Räume aufräumen ----
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    const map = clients.get(code);
    const anyConnected = map && [...map.values()].some(ws => ws.readyState === WebSocket.OPEN);
    if (!anyConnected && now - room.lastActivity > 15 * 60 * 1000) {
      rooms.delete(code);
      clients.delete(code);
    }
  }
}, 60000);

server.on('close', () => { clearInterval(heartbeat); clearInterval(cleanup); });
server.listen(PORT, () => {
  console.log(`Couillon-Server läuft auf Port ${PORT}`);
});
