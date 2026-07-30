import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(data) {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function createIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const put = (x, y, color) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const offset = (y * size + x) * 4;
    pixels.set(color, offset);
  };
  const scale = size / 128;
  const rect = (x, y, width, height, color) => {
    for (let row = Math.round(y * scale); row < Math.round((y + height) * scale); row += 1)
      for (let col = Math.round(x * scale); col < Math.round((x + width) * scale); col += 1) put(col, row, color);
  };
  const circle = (x, y, radius, color) => {
    const cx = x * scale;
    const cy = y * scale;
    const r = radius * scale;
    for (let row = Math.floor(cy - r); row <= Math.ceil(cy + r); row += 1)
      for (let col = Math.floor(cx - r); col <= Math.ceil(cx + r); col += 1)
        if ((col - cx) ** 2 + (row - cy) ** 2 <= r ** 2) put(col, row, color);
  };
  const red = [255, 36, 66, 255];
  const white = [255, 255, 255, 255];
  const radius = 28 * scale;
  for (let y = 0; y < size; y += 1)
    for (let x = 0; x < size; x += 1) {
      const dx = Math.max(radius - x, 0, x - (size - radius - 1));
      const dy = Math.max(radius - y, 0, y - (size - radius - 1));
      if (dx * dx + dy * dy <= radius * radius) put(x, y, red);
    }
  rect(31, 38, 66, 13, white);
  rect(31, 58, 66, 13, white);
  rect(31, 78, 41, 13, white);
  circle(91, 84.5, 10.5, white);
  rect(88, 79, 6, 14, red);
  rect(84, 83, 14, 6, red);

  const scanlines = Buffer.alloc((size * 4 + 1) * size);
  for (let row = 0; row < size; row += 1) pixels.copy(scanlines, row * (size * 4 + 1) + 1, row * size * 4, (row + 1) * size * 4);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'binary'), chunk('IHDR', header), chunk('IDAT', deflateSync(scanlines)), chunk('IEND', Buffer.alloc(0))]);
}

for (const size of [16, 32, 48, 128]) writeFileSync(new URL(`icon-${size}.png`, import.meta.url), createIcon(size));
