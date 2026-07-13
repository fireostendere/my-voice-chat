'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const frames = sizes.map((size) => createPng(size));
const directorySize = 6 + frames.length * 16;
const header = Buffer.alloc(directorySize);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);

let offset = directorySize;
frames.forEach((frame, index) => {
  const entry = 6 + index * 16;
  header[entry] = sizes[index] === 256 ? 0 : sizes[index];
  header[entry + 1] = sizes[index] === 256 ? 0 : sizes[index];
  header[entry + 2] = 0;
  header[entry + 3] = 0;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frame.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frame.length;
});

const output = path.join(__dirname, '..', 'assets', 'livekit-companion.ico');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, Buffer.concat([header, ...frames]));
console.log(`Generated ${path.relative(process.cwd(), output)} (${sizes.join(', ')} px)`);

function createPng(size) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    const row = y * (stride + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.floor((x * 512) / size);
      const sourceY = Math.floor((y * 512) / size);
      const color = liveKitPixel(sourceX, sourceY);
      const pixel = row + 1 + x * 4;
      raw[pixel] = color[0];
      raw[pixel + 1] = color[1];
      raw[pixel + 2] = color[2];
      raw[pixel + 3] = 255;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// Geometry and colors match public/images/livekit-apple-touch.png, but the ICO
// includes every Windows shell size from 16 through 256 px.
function liveKitPixel(x, y) {
  const background = [7, 7, 7];
  if (y < 96 || y >= 416) return background;
  if ((x >= 96 && x < 160) || (y >= 352 && x >= 160 && x < 288)) {
    return [240, 240, 240];
  }
  const coralBlock =
    (y < 160 && x >= 352 && x < 416) ||
    (y >= 160 && y < 224 && x >= 288 && x < 352) ||
    (y >= 224 && y < 288 && x >= 224 && x < 288) ||
    (y >= 288 && y < 352 && x >= 288 && x < 352) ||
    (y >= 352 && x >= 352 && x < 416);
  return coralBlock ? [255, 109, 93] : background;
}

function pngChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
