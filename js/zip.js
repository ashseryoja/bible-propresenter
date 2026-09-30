/*
 * Tiny ZIP writer (deflate via CompressionStream when the browser has it, otherwise stored).
 * Used to hand the viewer one file with bible.db3, rvmetadata.xml and a short README.
 */
(function () {
  'use strict';
  const AB = (globalThis.AB = globalThis.AB || {});

  const CRC_TABLE = (function () {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(u8) {
    let c = 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  async function deflateRaw(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      const stream = new Blob([u8]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (e) {
      return null;
    }
  }

  function dosDateTime(d) {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
    const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return [time & 0xffff, date & 0xffff];
  }

  const le16 = (v) => [v & 255, (v >>> 8) & 255];
  const le32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];

  /**
   * @param {{name:string, data:Uint8Array}[]} files
   * @param {{date?:Date}} [opts]
   * @returns {Promise<Uint8Array>}
   */
  async function makeZip(files, opts) {
    const [dosTime, dosDate] = dosDateTime((opts && opts.date) || new Date());
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const raw = f.data;
      const crc = crc32(raw);
      let method = 0;
      let body = raw;
      const packed = raw.length > 64 ? await deflateRaw(raw) : null;
      if (packed && packed.length < raw.length) { method = 8; body = packed; }
      const local = Uint8Array.from([
        ...le32(0x04034b50), ...le16(method === 8 ? 20 : 10), ...le16(0x0800), ...le16(method),
        ...le16(dosTime), ...le16(dosDate), ...le32(crc), ...le32(body.length), ...le32(raw.length),
        ...le16(name.length), ...le16(0), ...name,
      ]);
      chunks.push(local, body);
      central.push(Uint8Array.from([
        ...le32(0x02014b50), ...le16(0x031e), ...le16(method === 8 ? 20 : 10), ...le16(0x0800), ...le16(method),
        ...le16(dosTime), ...le16(dosDate), ...le32(crc), ...le32(body.length), ...le32(raw.length),
        ...le16(name.length), ...le16(0), ...le16(0), ...le16(0), ...le16(0), ...le32(0o100644 << 16), ...le32(offset),
        ...name,
      ]));
      offset += local.length + body.length;
    }
    let cdSize = 0;
    for (const c of central) cdSize += c.length;
    const end = Uint8Array.from([
      ...le32(0x06054b50), ...le16(0), ...le16(0), ...le16(files.length), ...le16(files.length),
      ...le32(cdSize), ...le32(offset), ...le16(0),
    ]);
    const all = [...chunks, ...central, end];
    let total = 0;
    for (const p of all) total += p.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of all) { out.set(p, o); o += p.length; }
    return out;
  }

  AB.zip = { makeZip, crc32 };
})();
