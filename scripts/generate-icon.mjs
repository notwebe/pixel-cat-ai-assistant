import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outputPath = path.join(rootDir, 'build', 'icon.ico');

const GRID_SIZE = 20;
const ICON_SIZES = [16, 32, 48, 256];

const PALETTE = {
  outline: [0x1e, 0x1b, 0x4b, 0xff], // #1e1b4b
  eyeShade: [0x31, 0x2e, 0x81, 0xff], // #312e81
  cream: [0xff, 0xf7, 0xed, 0xff], // #fff7ed
  creamShade: [0xfe, 0xd7, 0xaa, 0xff], // #fed7aa
  ginger: [0xfb, 0x92, 0x3c, 0xff], // #fb923c
  gingerDark: [0xea, 0x58, 0x0c, 0xff], // #ea580c
  pink: [0xf4, 0x72, 0xb6, 0xff], // #f472b6
};

// Mirrors the 20x20 idle cat from src/components/PixelCatSvg.tsx (shifted +1px in X to center in the icon frame)
function buildBasePixelCat() {
  const pixels = new Uint8Array(GRID_SIZE * GRID_SIZE * 4);
  const offsetX = 1;

  const fillRect = (x, y, w, h, rgba) => {
    const startX = x + offsetX;
    for (let py = y; py < y + h; py += 1) {
      if (py < 0 || py >= GRID_SIZE) continue;
      for (let px = startX; px < startX + w; px += 1) {
        if (px < 0 || px >= GRID_SIZE) continue;
        const idx = (py * GRID_SIZE + px) * 4;
        pixels[idx] = rgba[0];
        pixels[idx + 1] = rgba[1];
        pixels[idx + 2] = rgba[2];
        pixels[idx + 3] = rgba[3];
      }
    }
  };

  // Tail
  fillRect(1, 8, 2, 2, PALETTE.outline);
  fillRect(1, 9, 1, 1, PALETTE.ginger);
  fillRect(2, 10, 2, 3, PALETTE.outline);
  fillRect(2, 11, 2, 2, PALETTE.creamShade);
  fillRect(3, 12, 2, 2, PALETTE.outline);
  fillRect(4, 12, 1, 2, PALETTE.ginger);

  // Body outline & fill
  fillRect(4, 10, 10, 6, PALETTE.outline);
  fillRect(5, 11, 8, 4, PALETTE.cream);
  fillRect(5, 11, 4, 2, PALETTE.ginger);
  fillRect(6, 14, 6, 1, PALETTE.creamShade);

  // Ears outline & inner ear
  fillRect(7, 3, 2, 2, PALETTE.outline);
  fillRect(14, 3, 2, 2, PALETTE.outline);
  fillRect(8, 4, 1, 2, PALETTE.ginger);
  fillRect(14, 4, 1, 2, PALETTE.gingerDark);
  fillRect(8, 5, 1, 1, PALETTE.pink);
  fillRect(14, 5, 1, 1, PALETTE.pink);

  // Head outline & fill
  fillRect(7, 5, 9, 6, PALETTE.outline);
  fillRect(6, 6, 11, 4, PALETTE.outline);
  fillRect(8, 6, 7, 4, PALETTE.cream);
  fillRect(7, 7, 9, 3, PALETTE.cream);

  // Ginger forehead patches
  fillRect(8, 6, 3, 2, PALETTE.ginger);
  fillRect(13, 6, 2, 1, PALETTE.ginger);

  // Rosy cheeks
  fillRect(8, 9, 1, 1, PALETTE.pink);
  fillRect(15, 9, 1, 1, PALETTE.pink);

  // Eyes
  fillRect(9, 7, 1, 2, PALETTE.outline);
  fillRect(14, 7, 1, 2, PALETTE.outline);
  fillRect(9, 7, 1, 1, PALETTE.eyeShade);
  fillRect(14, 7, 1, 1, PALETTE.eyeShade);

  // Nose
  fillRect(12, 9, 1, 1, PALETTE.pink);

  // Standing neat paws
  fillRect(5, 16, 2, 2, PALETTE.outline);
  fillRect(6, 16, 1, 1, PALETTE.cream);
  fillRect(8, 16, 2, 2, PALETTE.outline);
  fillRect(8, 16, 1, 1, PALETTE.creamShade);
  fillRect(11, 16, 2, 2, PALETTE.outline);
  fillRect(11, 16, 1, 1, PALETTE.cream);

  return pixels;
}

function scaleNearestNeighbor(srcRgba, srcSize, dstSize) {
  const dst = new Uint8Array(dstSize * dstSize * 4);
  for (let y = 0; y < dstSize; y += 1) {
    const srcY = Math.min(srcSize - 1, Math.floor((y * srcSize) / dstSize));
    for (let x = 0; x < dstSize; x += 1) {
      const srcX = Math.min(srcSize - 1, Math.floor((x * srcSize) / dstSize));
      const srcIdx = (srcY * srcSize + srcX) * 4;
      const dstIdx = (y * dstSize + x) * 4;
      dst[dstIdx] = srcRgba[srcIdx];
      dst[dstIdx + 1] = srcRgba[srcIdx + 1];
      dst[dstIdx + 2] = srcRgba[srcIdx + 2];
      dst[dstIdx + 3] = srcRgba[srcIdx + 3];
    }
  }
  return dst;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);

  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);

  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function encodePngRgba(rgba, width, height) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const stride = width * 4;
  const rawScanlines = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    rawScanlines[rowStart] = 0; // filter: None
    const srcStart = y * stride;
    rawScanlines.set(rgba.subarray(srcStart, srcStart + stride), rowStart + 1);
  }

  const compressed = zlib.deflateSync(rawScanlines, { level: 9 });

  return Buffer.concat([
    signature,
    makePngChunk('IHDR', ihdr),
    makePngChunk('IDAT', compressed),
    makePngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function encodeIco(frames) {
  const headerSize = 6;
  const entrySize = 16;
  const header = Buffer.alloc(headerSize);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: 1 = icon
  header.writeUInt16LE(frames.length, 4);

  const entries = [];
  let currentOffset = headerSize + entrySize * frames.length;

  for (const frame of frames) {
    const entry = Buffer.alloc(entrySize);
    entry[0] = frame.size >= 256 ? 0 : frame.size;
    entry[1] = frame.size >= 256 ? 0 : frame.size;
    entry[2] = 0; // color palette count
    entry[3] = 0; // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(frame.png.length, 8);
    entry.writeUInt32LE(currentOffset, 12);
    entries.push(entry);
    currentOffset += frame.png.length;
  }

  return Buffer.concat([header, ...entries, ...frames.map((frame) => frame.png)]);
}

const baseCat = buildBasePixelCat();
const frames = ICON_SIZES.map((size) => {
  const scaled = scaleNearestNeighbor(baseCat, GRID_SIZE, size);
  return {
    size,
    png: encodePngRgba(scaled, size, size),
  };
});

const icoBuffer = encodeIco(frames);
mkdirSync(path.dirname(outputPath), { recursive: true });
writeFileSync(outputPath, icoBuffer);
console.log(`Generated ${outputPath} (${icoBuffer.length} bytes, sizes: ${ICON_SIZES.join(', ')})`);
