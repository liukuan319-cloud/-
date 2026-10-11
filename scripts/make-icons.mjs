import { mkdir, writeFile } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function chunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0);
  name.copy(result, 4);
  data.copy(result, 8);
  let crc = 0xffffffff;
  for (const byte of result.subarray(4, data.length + 8)) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8);
  return result;
}
function icon(size) {
  const bytes = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x++) {
      const offset = row + 1 + x * 4;
      const inset = Math.min(x, y, size - x - 1, size - y - 1);
      let color = inset < size * .065 ? [245, 245, 247] : [56, 211 - Math.round(42 * (x + y) / (2 * size)), 159 - Math.round(21 * (x + y) / (2 * size))];
      const dx = Math.abs(x - size / 2), dy = Math.abs(y - size / 2);
      // A simple central "枢" inspired mark that stays legible at small sizes.
      if ((dx < size * .20 && dy < size * .27) || (dx < size * .29 && dy < size * .065)) color = [255, 255, 255];
      if ((dx < size * .055 && dy < size * .27) || (dx < size * .29 && dy < size * .055)) color = [47, 169, 138];
      bytes.set([...color, 255], offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(bytes, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
await mkdir(new URL('../public/icons/', import.meta.url), { recursive: true });
for (const size of [192, 512]) await writeFile(new URL(`../public/icons/icon-${size}.png`, import.meta.url), icon(size));
