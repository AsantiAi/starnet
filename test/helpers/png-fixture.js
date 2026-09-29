'use strict';
/* A real PNG encoder for transparency fixtures (image.test.js, transparent-image.e2e.test.js). Rows cycle through
   all five scanline filters so a decoder's unfilter is exercised, not just filter 0.
     encodePng({ w, h, ctype, depth?, interlace?, plte?, trns?, rawIdat?, pixel(x, y) -> samples })
   ctype: 0 grey, 2 RGB, 3 palette, 4 grey+alpha, 6 RGBA. Samples are 0..255, or 0..65535 at depth 16.
   rawIdat replaces the compressed pixel data verbatim (for corrupt-data fixtures). */
const zlib = require('node:zlib');

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const x of buf) c = CRC_TABLE[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng({ w, h, ctype, depth = 8, interlace = 0, plte = null, trns = null, rawIdat = null, pixel }) {
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ctype];
  const bpp = channels * depth / 8, stride = w * bpp, rows = [];
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const cur = Buffer.alloc(stride);
    for (let x = 0; x < w; x++) {
      const s = pixel(x, y);
      for (let c = 0; c < channels; c++) {
        if (depth === 16) cur.writeUInt16BE(s[c], (x * channels + c) * 2); else cur[x * channels + c] = s[c];
      }
    }
    const f = y % 5, out = Buffer.alloc(stride + 1);
    out[0] = f;
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let pred = 0;
      if (f === 1) pred = a; else if (f === 2) pred = b; else if (f === 3) pred = (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); pred = (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c); }
      out[i + 1] = (cur[i] - pred) & 255;
    }
    rows.push(out); prev = cur;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = depth; ihdr[9] = ctype; ihdr[12] = interlace;
  const parts = [Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), pngChunk('IHDR', ihdr)];
  if (plte) parts.push(pngChunk('PLTE', Buffer.from(plte)));
  if (trns) parts.push(pngChunk('tRNS', Buffer.from(trns)));
  parts.push(pngChunk('IDAT', rawIdat || zlib.deflateSync(Buffer.concat(rows))), pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

// A 40x30 "logo": a 20x10 subject at alpha 253 (gpt-image-2 renders opaque areas that way) on a clear background.
function logoPng() {
  return encodePng({ w: 40, h: 30, ctype: 6, pixel: (x, y) => (x >= 10 && x < 30 && y >= 10 && y < 20) ? [220, 60, 20, 253] : [0, 0, 0, 0] });
}

module.exports = { encodePng, logoPng };
