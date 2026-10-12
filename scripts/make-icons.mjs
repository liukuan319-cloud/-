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
  const shape = [[.50,.17],[.57,.42],[.82,.50],[.57,.58],[.50,.83],[.43,.58],[.18,.50],[.43,.42]].map(([x,y])=>[x*size,y*size]);
  const inside = (x,y) => {
    let contained = false;
    for (let i=0,j=shape.length-1;i<shape.length;j=i++) {
      const a=shape[i],b=shape[j];
      if ((a[1]>y)!==(b[1]>y) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]) contained=!contained;
    }
    return contained;
  };
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    for (let x = 0; x < size; x++) {
      const offset = row + 1 + x * 4;
      const inset = Math.min(x, y, size - x - 1, size - y - 1);
      const t = (x + y) / (2 * size);
      let color = inset < size * .055 ? [245, 245, 247] : [56 - Math.round(9 * t), 211 - Math.round(42 * t), 159 - Math.round(21 * t)];
      // Match the existing brand mark: white central four-point sparkle, small plus and dot.
      const central = inside(x,y);
      const plus = (Math.abs(x - size * .77) < size * .022 && Math.abs(y - size * .16) < size * .10) || (Math.abs(y - size * .16) < size * .022 && Math.abs(x - size * .77) < size * .10);
      const dot = ((x - size * .17) ** 2 + (y - size * .83) ** 2) < (size * .035) ** 2;
      if (central || plus || dot) color = [255, 255, 255];
      bytes.set([...color, 255], offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(bytes, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
await mkdir(new URL('../public/icons/', import.meta.url), { recursive: true });
for (const size of [192, 512]) await writeFile(new URL(`../public/icons/icon-${size}.png`, import.meta.url), icon(size));
