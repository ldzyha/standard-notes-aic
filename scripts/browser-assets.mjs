import { deflateSync } from "node:zlib";

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

export function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function distanceToSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const fraction = Math.max(
    0,
    Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)),
  );
  return Math.hypot(x - ax - fraction * dx, y - ay - fraction * dy);
}

function iconColor(x, y) {
  const cx = Math.max(20, Math.min(108, x));
  const cy = Math.max(20, Math.min(108, y));
  if (Math.hypot(x - cx, y - cy) > 20) return [0, 0, 0, 0];
  if (distanceToSegment(x, y, 64, 94, 102, 94) <= 6) return [76, 195, 138, 255];
  if (
    distanceToSegment(x, y, 28, 36, 62, 64) <= 6 ||
    distanceToSegment(x, y, 62, 64, 28, 92) <= 6
  )
    return [91, 157, 217, 255];
  return [20, 22, 26, 255];
}

/** Deterministic 128px raster of public/aic-logo.svg's >_ mark. */
export function createIconPng() {
  const size = 128;
  const samples = 4;
  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 4);
    for (let x = 0; x < size; x++) {
      const channels = [0, 0, 0];
      let covered = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const pixel = iconColor(
            x + (sx + 0.5) / samples,
            y + (sy + 0.5) / samples,
          );
          if (pixel[3]) {
            covered++;
            for (let channel = 0; channel < 3; channel++)
              channels[channel] += pixel[channel];
          }
        }
      }
      for (let channel = 0; channel < 3; channel++) {
        raw[row + 1 + x * 4 + channel] = covered
          ? Math.round(channels[channel] / covered)
          : 0;
      }
      raw[row + 1 + x * 4 + 3] = Math.round(
        (255 * covered) / (samples * samples),
      );
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from("89504e470d0a1a0a", "hex"),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

/** ZIP STORE with fixed 1980 timestamps, ordered names, and no host-specific metadata. */
export function createStoredZip(entries) {
  if (entries.length > 65535)
    throw new Error("Too many browser archive entries.");
  const files = entries
    .map(({ name, data }) => {
      if (
        !name ||
        name.startsWith("/") ||
        name.includes("\\") ||
        name.split("/").includes("..")
      ) {
        throw new Error(`Invalid archive path: ${name}`);
      }
      const bytes = Buffer.from(data);
      const path = Buffer.from(name, "utf8");
      if (bytes.length > 0xffffffff || path.length > 65535)
        throw new Error("Browser archive entry is too large.");
      return { name, path, bytes, crc: crc32(bytes) };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (
    files.some(
      (file, index) => index > 0 && file.name === files[index - 1].name,
    )
  ) {
    throw new Error("Duplicate browser archive entry.");
  }

  const local = [];
  const central = [];
  let offset = 0;
  for (const file of files) {
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(0x21, 12); // DOS date: 1980-01-01, with time 00:00:00.
    header.writeUInt32LE(file.crc, 14);
    header.writeUInt32LE(file.bytes.length, 18);
    header.writeUInt32LE(file.bytes.length, 22);
    header.writeUInt16LE(file.path.length, 26);
    local.push(header, file.path, file.bytes);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(0x21, 14);
    directory.writeUInt32LE(file.crc, 16);
    directory.writeUInt32LE(file.bytes.length, 20);
    directory.writeUInt32LE(file.bytes.length, 24);
    directory.writeUInt16LE(file.path.length, 28);
    directory.writeUInt32LE((0o100644 << 16) >>> 0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, file.path);
    offset += header.length + file.path.length + file.bytes.length;
  }
  const centralSize = central.reduce((size, part) => size + part.length, 0);
  if (offset > 0xffffffff || centralSize > 0xffffffff)
    throw new Error("Browser archive exceeds ZIP32 limits.");
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, ...central, end]);
}
