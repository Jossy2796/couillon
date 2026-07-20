// gen-icons.mjs — Erzeugt PNG-Icons (grüner Hintergrund, weiße Karte, rotes Herz)
// ohne externe Abhängigkeiten. Rasterisiert direkt und kodiert PNG via zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, '..', 'public');

const GREEN = [11, 93, 59];
const WHITE = [253, 253, 247];
const RED = [198, 40, 40];

function render(size) {
  const buf = Buffer.alloc(size * size * 3);
  const set = (x, y, [r, g, b]) => { const i = (y * size + x) * 3; buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; };

  // Kartenrechteck (leicht gedreht wäre komplex -> gerade, gerundet)
  const cardX0 = size * 0.24, cardX1 = size * 0.76;
  const cardY0 = size * 0.16, cardY1 = size * 0.84;
  const radius = size * 0.06;
  const inCard = (x, y) => {
    if (x < cardX0 || x > cardX1 || y < cardY0 || y > cardY1) return false;
    // Gerundete Ecken: nur prüfen, wenn im Eckbereich -> Abstand zum Eckmittelpunkt.
    const inCornerX = x < cardX0 + radius || x > cardX1 - radius;
    const inCornerY = y < cardY0 + radius || y > cardY1 - radius;
    if (inCornerX && inCornerY) {
      const cx = x < (cardX0 + cardX1) / 2 ? cardX0 + radius : cardX1 - radius;
      const cy = y < (cardY0 + cardY1) / 2 ? cardY0 + radius : cardY1 - radius;
      const dx = x - cx, dy = y - cy;
      return dx * dx + dy * dy <= radius * radius;
    }
    return true;
  };

  // Herz (implizite Kurve), zentriert auf der Karte
  const hx = size * 0.5, hy = size * 0.50, R = size * 0.20;
  const inHeart = (x, y) => {
    const u = (x - hx) / R;
    const v = (hy - y) / R + 0.35; // nach oben positiv, leicht verschoben
    const a = u * u + v * v - 1;
    return a * a * a - u * u * v * v * v <= 0;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let col = GREEN;
      if (inCard(x, y)) col = WHITE;
      if (inHeart(x, y) && inCard(x, y)) col = RED;
      set(x, y, col);
    }
  }
  return encodePNG(buf, size, size);
}

function encodePNG(rgb, width, height) {
  // Scanlines mit Filter-Byte 0 voranstellen
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0;
    rgb.copy(raw, y * (1 + width * 3) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const idat = deflateSync(raw, { level: 9 });

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

writeFileSync(path.join(OUT, 'apple-touch-icon.png'), render(180));
writeFileSync(path.join(OUT, 'icon-512.png'), render(512));
console.log('Icons erzeugt: apple-touch-icon.png (180), icon-512.png (512)');
