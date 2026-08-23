import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

sharp.cache(false); // keine Datei-Handles halten (Windows-Schreibsperre vermeiden)

const DIR = 'C:/Users/Joé/Documents/Claude/couillon/public/dealer';
const files = fs.readdirSync(DIR).filter(f => /^dealer_frame_\d+\.webp$/.test(f)).sort();

// Ist ein Pixel "Hintergrund/Schleier"? weißlich UND nicht voll deckend.
function isVeil(r, g, b, a) { return a < 250 && r > 200 && g > 200 && b > 200; }

let beforeTotal = 0, afterTotal = 0, removedTotal = 0;

for (const f of files) {
  const p = path.join(DIR, f);
  const input = fs.readFileSync(p); // erst in Buffer lesen -> sharp öffnet die Datei nicht selbst
  beforeTotal += input.length;
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const idx = (x, y) => (y * w + x) * 4;
  const visited = new Uint8Array(w * h);
  const stack = [];
  // Startpunkte: alle Randpixel (der Rahmen ist transparenter Hintergrund)
  for (let x = 0; x < w; x++) { stack.push(x, 0); stack.push(x, h - 1); }
  for (let y = 0; y < h; y++) { stack.push(0, y); stack.push(w - 1, y); }
  let removed = 0;
  while (stack.length) {
    const y = stack.pop(), x = stack.pop();
    if (x < 0 || y < 0 || x >= w || y >= h) continue;
    const pi = y * w + x;
    if (visited[pi]) continue;
    const i = pi * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
    // Nur durch Hintergrund (a==0) ODER weißlichen Schleier weiterfluten.
    if (!(a === 0 || isVeil(r, g, b, a))) continue; // deckende/dunkle Figur blockt -> Kragen/Karten sicher
    visited[pi] = 1;
    if (a !== 0) { data[i + 3] = 0; removed++; } // Schleier transparent machen
    stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
  }
  removedTotal += removed;
  const out = await sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 4 } })
    .webp({ quality: 82, alphaQuality: 100, effort: 5 })
    .toBuffer();
  fs.writeFileSync(p, out);
  afterTotal += out.length;
}

const kb = n => (n / 1024).toFixed(0) + ' KB';
console.log(`Frames: ${files.length}`);
console.log(`Schleier-Pixel entfernt gesamt: ${removedTotal}`);
console.log(`Größe vorher: ${kb(beforeTotal)}  ->  nachher: ${kb(afterTotal)}  (${(afterTotal / beforeTotal * 100).toFixed(0)}%)`);
