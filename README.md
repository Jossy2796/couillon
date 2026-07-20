# 🃏 Couillon – Online-Kartenspiel

Le Couillon für 4 Spieler in 2 Teams über Kreuz – als mobile-first Web-App
(optimiert fürs iPhone/Safari) mit Node.js-Server, WebSockets, Räumen und Bots.

## Features

- 📱 **Mobile-first & PWA** – im Safari öffnen, „Zum Home-Bildschirm" hinzufügen → wie eine App (kein App-Store nötig)
- 🔌 **Räume** – ein Spieler erstellt einen Raum, die anderen treten per 4-stelligem Code oder Link bei
- 🤖 **Bots** füllen leere Plätze automatisch, damit ihr auch zu zweit/dritt spielen könnt
- 🔁 **Reconnect** – wenn Safari im Hintergrund die Verbindung kappt, verbindet die App automatisch neu; solange übernimmt ein Bot den Zug, damit das Spiel nicht stehen bleibt
- 🇩🇪 Oberfläche komplett auf Deutsch

## Regeln (Kujon – St. Vither Variante, Kurzfassung)

- 4 Spieler, 2 Teams über Kreuz. **Beide Teams starten bei 13 Strichen und zählen auf ≤ 0 herunter** –
  wer zuerst da ist, gewinnt (nicht exakt 0 nötig).
- 24 Karten. Nicht-Trumpf-Stärke **A > K > D > B > 10 > 9**. Punkte: **Ass 4 · König 3 · Dame 2 · Bube 1** → 40 pro Runde.
- **Geben & Trumpf:** je 3 Karten; der Spieler **links vom Geber** muss aus seinen 3 Karten den Trumpf
  bestimmen (kein Passen) – sein Team trägt das Risiko. Dann je 3 weitere Karten. Nächster Geber = Trumpfmacher.
- **Sonder-Trümpfe:** **Kreuz-Dame** immer Trumpf. **Pik-Dame = „Mit"**: der Halter darf sie ansagen →
  zweithöchster Trumpf, Spielwert steigt auf 2. **Klopfen/Re** erhöht den Spielwert weiter (je +1).
- **Trumpf-Rang:** Trumpf-Ass › Pik-Dame (bei Mit) › Kreuz-Dame › König › Dame › Bube › 10 › 9.
- **Bedienpflicht:** die angespielte Farbe bekennen, wenn man sie hat; nur **Trumpf** darf jederzeit gespielt
  werden. Kann man nicht bedienen, ist jede Karte erlaubt (kein Überstichzwang).
- **Wertung:** mehr Kartenpunkte gewinnt die Runde (20:20 → Nicht-Trumpf-Team). Sieger zieht den Spielwert ab;
  verliert das **Trumpfmacher-Team**, bekommt es **+1** angemacht. **Vole** (alle 6 Stiche): ein Strich mehr wird abgezogen.
- Start-Striche in `src/game.js` unter `CONFIG` anpassbar.

## Lokal starten

Voraussetzung: [Node.js](https://nodejs.org) ≥ 18.

```bash
npm install
npm start
```

Dann im Browser **http://localhost:3000** öffnen. Zum Mitspielen im selben WLAN geben
die anderen `http://<deine-lokale-IP>:3000` ein.

Weitere Befehle:

```bash
npm test        # Regel-Engine testen
npm run icons   # App-Icons (PNG) neu erzeugen
npm run dev     # Server mit Auto-Neustart bei Änderungen
```

## Kostenlos online hosten (damit ihr von überall spielen könnt)

Empfohlen: **Render.com** (kostenloser Web-Service, WebSockets inklusive).

1. Diesen Ordner in ein **GitHub-Repo** pushen.
2. Auf [render.com](https://render.com) mit GitHub anmelden → **New +** → **Blueprint** →
   das Repo auswählen. Render liest `render.yaml` und richtet alles ein.
   (Alternativ **New + → Web Service** manuell: Build `npm install`, Start `npm start`.)
3. Nach dem Deploy bekommst du eine feste URL wie `https://couillon-xyz.onrender.com`.
   Diesen Link teilst du mit deinen Freunden – fertig.

> Hinweis: Der Gratis-Tarif „schläft" nach ~15 Min. Inaktivität ein; der erste Aufruf
> danach dauert ein paar Sekunden (Cold Start). Danach läuft alles flüssig.

Andere Hoster (Railway, Fly.io, eigener Server) funktionieren genauso – es ist ein
Standard-Node-Server, der auf `process.env.PORT` hört.

## Projektstruktur

```
couillon/
├─ src/
│  ├─ server.js   # HTTP + WebSocket-Server, Raumverwaltung, Reconnect-Heartbeat
│  ├─ room.js     # Ein Spielraum: Zustandsautomat, Bot-/Auto-Steuerung
│  ├─ game.js     # Reine Regel-Engine (Karten, Züge, Wertung)
│  ├─ bot.js      # Einfache KI für Ansage & Kartenwahl
│  └─ game.test.js
├─ public/        # Web-App (HTML, CSS, JS, PWA-Manifest, Icons)
├─ scripts/gen-icons.mjs
├─ render.yaml    # 1-Klick-Deploy auf Render
└─ package.json
```

## Anpassen

- **Match-Länge:** `CONFIG.START_STRICHE` in `src/game.js` (Standard 13). `VOLE_BONUS` = Extra-Strich bei allen 6 Stichen.
- **Bot-Stärke:** Schwellenwert/Bewertung in `src/bot.js`.
- **Design:** Farben & Layout in `public/style.css` (CSS-Variablen ganz oben).
