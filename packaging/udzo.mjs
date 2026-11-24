// Writes a compressed Apple disk image (UDIF "UDZO": zlib chunks + XML block map + koly trailer)
// from a raw disk image, so a .dmg can be built on Linux or Windows without hdiutil.
// Format reference: the UDIF layout used by hdiutil (mish block tables in the "blkx" resource).
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const SECTOR = 512;
const CHUNK_SECTORS = 0x800;            // 1 MiB per chunk
const T_ZLIB = 0x80000005, T_IGNORE = 0x00000002, T_END = 0xffffffff;

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf, crc = 0) { crc = ~crc >>> 0; for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8); return ~crc >>> 0; }

const u64 = (b, off, v) => { b.writeUInt32BE(Math.floor(v / 2 ** 32), off); b.writeUInt32BE(v >>> 0, off + 4); };

/** raw: Buffer of the whole disk (multiple of 512). Returns the .dmg Buffer. */
export function udzo(raw, name = 'whole disk (Apple_HFS : 0)') {
  if (raw.length % SECTOR) raw = Buffer.concat([raw, Buffer.alloc(SECTOR - (raw.length % SECTOR))]);
  const sectors = raw.length / SECTOR;
  const chunks = [];
  const out = [];
  let offset = 0;
  let rawCrc = 0;
  for (let s = 0; s < sectors; s += CHUNK_SECTORS) {
    const n = Math.min(CHUNK_SECTORS, sectors - s);
    const part = raw.subarray(s * SECTOR, (s + n) * SECTOR);
    rawCrc = crc32(part, rawCrc);
    if (!part.some((x) => x !== 0)) { chunks.push([T_IGNORE, s, n, offset, 0]); continue; }
    const z = zlib.deflateSync(part, { level: 9 });
    chunks.push([T_ZLIB, s, n, offset, z.length]);
    out.push(z); offset += z.length;
  }
  chunks.push([T_END, sectors, 0, offset, 0]);
  const data = Buffer.concat(out);

  // mish block table
  const mish = Buffer.alloc(204 + 40 * chunks.length);
  mish.write('mish', 0, 'latin1');
  mish.writeUInt32BE(1, 4);                       // version
  u64(mish, 8, 0);                                // first sector
  u64(mish, 16, sectors);                         // sector count
  u64(mish, 24, 0);                               // data offset
  mish.writeUInt32BE(0x808, 32);                  // buffers needed (chunk sectors + 8)
  mish.writeUInt32BE(0xfffffffe, 36);             // block descriptor: entire device
  mish.writeUInt32BE(2, 64);                      // checksum type CRC32
  mish.writeUInt32BE(32, 68);                     // checksum bits
  mish.writeUInt32BE(rawCrc, 72);
  mish.writeUInt32BE(chunks.length, 200);
  chunks.forEach(([type, sec, cnt, off, len], i) => {
    const o = 204 + i * 40;
    mish.writeUInt32BE(type, o); mish.writeUInt32BE(0, o + 4);
    u64(mish, o + 8, sec); u64(mish, o + 16, cnt); u64(mish, o + 24, off); u64(mish, o + 32, len);
  });

  const b64 = mish.toString('base64').replace(/.{1,52}/g, '\t\t\t\t$&\n');
  const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>resource-fork</key>
	<dict>
		<key>blkx</key>
		<array>
			<dict>
				<key>Attributes</key>
				<string>0x0050</string>
				<key>CFName</key>
				<string>${name}</string>
				<key>Data</key>
				<data>
${b64}				</data>
				<key>ID</key>
				<string>-1</string>
				<key>Name</key>
				<string>${name}</string>
			</dict>
		</array>
	</dict>
</dict>
</plist>
`, 'utf8');

  const master = Buffer.alloc(4); master.writeUInt32BE(rawCrc, 0);
  const koly = Buffer.alloc(512);
  koly.write('koly', 0, 'latin1');
  koly.writeUInt32BE(4, 4); koly.writeUInt32BE(512, 8); koly.writeUInt32BE(1, 12);
  u64(koly, 16, 0); u64(koly, 24, 0); u64(koly, 32, data.length);   // data fork
  u64(koly, 40, 0); u64(koly, 48, 0);                               // resource fork (none)
  koly.writeUInt32BE(1, 56); koly.writeUInt32BE(1, 60);              // segment 1 of 1
  crypto.randomBytes(16).copy(koly, 64);                            // segment ID
  koly.writeUInt32BE(2, 80); koly.writeUInt32BE(32, 84); koly.writeUInt32BE(crc32(data), 88);
  u64(koly, 216, data.length); u64(koly, 224, xml.length);          // XML plist right after the data
  koly.writeUInt32BE(2, 352); koly.writeUInt32BE(32, 356); koly.writeUInt32BE(crc32(master), 360);
  koly.writeUInt32BE(1, 488);                                       // image variant
  u64(koly, 492, sectors);
  return Buffer.concat([data, xml, koly]);
}

/** Reads a UDZO image back to raw bytes (used to self-check what we wrote). */
export function readUdzo(dmg) {
  const koly = dmg.subarray(dmg.length - 512);
  if (koly.toString('latin1', 0, 4) !== 'koly') throw new Error('no koly trailer');
  const xmlOff = Number(koly.readBigUInt64BE(216)), xmlLen = Number(koly.readBigUInt64BE(224));
  const xml = dmg.subarray(xmlOff, xmlOff + xmlLen).toString('utf8');
  const b64 = /<key>Data<\/key>\s*<data>([\s\S]*?)<\/data>/.exec(xml)[1].replace(/\s+/g, '');
  const mish = Buffer.from(b64, 'base64');
  const sectors = Number(mish.readBigUInt64BE(16));
  const raw = Buffer.alloc(sectors * SECTOR);
  const n = mish.readUInt32BE(200);
  for (let i = 0; i < n; i++) {
    const o = 204 + i * 40;
    const type = mish.readUInt32BE(o);
    const sec = Number(mish.readBigUInt64BE(o + 8)), off = Number(mish.readBigUInt64BE(o + 24)), len = Number(mish.readBigUInt64BE(o + 32));
    if (type === T_ZLIB) zlib.inflateSync(dmg.subarray(off, off + len)).copy(raw, sec * SECTOR);
  }
  if (crc32(raw) !== mish.readUInt32BE(72)) throw new Error('checksum mismatch');
  return raw;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const [, , input, output] = process.argv;
  fs.writeFileSync(output, udzo(fs.readFileSync(input)));
}
