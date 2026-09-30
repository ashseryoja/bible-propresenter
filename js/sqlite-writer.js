/*
 * Minimal SQLite file writer — builds a ProPresenter Bible module (bible.db3) in memory.
 *
 * No WebAssembly and no libraries: it lays out the SQLite 3 file format directly (4096-byte pages,
 * UTF-8, table and index b-trees). Only what the module needs is supported: integer / text / NULL
 * values, INTEGER PRIMARY KEY tables, single-column integer indexes, rows that fit into one page.
 * The table layout is copied 1:1 from the module that ProPresenter already reads
 * (ZBIBLE / ZBOOK / ZCHAPTER / ZVERSE / Z_PRIMARYKEY plus the plain books / chapters / verses tables).
 *
 * File format reference: https://www.sqlite.org/fileformat2.html
 */
(function () {
  'use strict';
  const AB = (globalThis.AB = globalThis.AB || {});

  const PAGE = 4096;
  const MAX_TABLE_PAYLOAD = PAGE - 35;         // largest row that stays on a table leaf page
  const MAX_INDEX_PAYLOAD = Math.floor((PAGE - 12) * 64 / 255) - 23;
  const encoder = new TextEncoder();

  // ---- low level helpers -----------------------------------------------------------------------------------------

  function varint(v) {
    if (v < 0x80) return [v];
    const tmp = [v % 128];
    v = Math.floor(v / 128);
    while (v > 0) { tmp.push(128 | (v % 128)); v = Math.floor(v / 128); }
    return tmp.reverse();
  }

  function u32(v) { return [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]; }

  function concat(parts) {
    let n = 0;
    for (const p of parts) n += p.length;
    const out = new Uint8Array(n);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }

  function intSerial(v) {
    if (v === 0) return [8, 0];
    if (v === 1) return [9, 0];
    if (v >= -128 && v <= 127) return [1, 1];
    if (v >= -32768 && v <= 32767) return [2, 2];
    if (v >= -8388608 && v <= 8388607) return [3, 3];
    if (v >= -2147483648 && v <= 2147483647) return [4, 4];
    if (v >= -140737488355328 && v <= 140737488355327) return [5, 6];
    return [6, 8];
  }

  function intBytes(v, n) {
    if (v < 0) v += Math.pow(2, 8 * n);
    const out = new Array(n);
    for (let i = n - 1; i >= 0; i--) { out[n - 1 - i] = Math.floor(v / Math.pow(2, 8 * i)) % 256; }
    return out;
  }

  /** SQLite record: header (size varint + one serial type per column) followed by the column bodies. */
  function makeRecord(values) {
    const serials = [];
    const bodies = [];
    for (const v of values) {
      if (v === null || v === undefined) {
        serials.push(0);
      } else if (typeof v === 'number') {
        if (!Number.isInteger(v)) throw new Error('only integer numbers are supported');
        const [st, n] = intSerial(v);
        serials.push(st);
        if (n) bodies.push(Uint8Array.from(intBytes(v, n)));
      } else {
        const b = encoder.encode(String(v));
        serials.push(13 + 2 * b.length);
        if (b.length) bodies.push(b);
      }
    }
    const typeBytes = [];
    for (const s of serials) for (const b of varint(s)) typeBytes.push(b);
    let hs = typeBytes.length + 1;
    while (varint(hs).length + typeBytes.length !== hs) hs = varint(hs).length + typeBytes.length;
    return concat([Uint8Array.from(varint(hs)), Uint8Array.from(typeBytes), ...bodies]);
  }

  // ---- pages and b-trees -----------------------------------------------------------------------------------------

  class Pager {
    constructor() { this.pages = [new Uint8Array(PAGE)]; }      // pages[0] is page 1 (sqlite_master), filled last
    alloc() { this.pages.push(new Uint8Array(PAGE)); return this.pages.length; }   // 1-based page number
    get(n) { return this.pages[n - 1]; }
  }

  /** Lay out one b-tree page. type: 0x0d table leaf, 0x05 table interior, 0x0a index leaf, 0x02 index interior. */
  function writePage(buf, hdrOff, type, cells, rightPtr) {
    const interior = type === 0x02 || type === 0x05;
    const headerSize = interior ? 12 : 8;
    let total = 0;
    for (const c of cells) total += c.length;
    const start = PAGE - total;
    if (hdrOff + headerSize + 2 * cells.length > start) throw new Error('b-tree page overflow');
    buf[hdrOff] = type;
    buf[hdrOff + 3] = (cells.length >> 8) & 255;
    buf[hdrOff + 4] = cells.length & 255;
    buf[hdrOff + 5] = (start >> 8) & 255;
    buf[hdrOff + 6] = start & 255;
    if (interior) buf.set(u32(rightPtr), hdrOff + 8);
    let p = start;
    for (let i = 0; i < cells.length; i++) {
      buf.set(cells[i], p);
      const o = hdrOff + headerSize + 2 * i;
      buf[o] = (p >> 8) & 255;
      buf[o + 1] = p & 255;
      p += cells[i].length;
    }
  }

  /** Table b-tree from rows [{rowid, rec}] sorted by rowid. Returns the root page number. */
  function buildTable(pager, rows) {
    let level = [];
    let cur = [];
    let size = 0;
    const flush = () => {
      const page = pager.alloc();
      writePage(pager.get(page), 0, 0x0d, cur.map((c) => c.cell), 0);
      level.push({ page, max: cur.length ? cur[cur.length - 1].rowid : 0 });
      cur = [];
      size = 0;
    };
    for (const r of rows) {
      if (r.rec.length > MAX_TABLE_PAYLOAD) throw new Error('row too large for one page (' + r.rec.length + ' bytes)');
      const cell = concat([Uint8Array.from(varint(r.rec.length)), Uint8Array.from(varint(r.rowid)), r.rec]);
      const need = cell.length + 2;
      if (cur.length && 8 + size + need > PAGE) flush();
      cur.push({ cell, rowid: r.rowid });
      size += need;
    }
    if (cur.length || !level.length) flush();
    const MAXCH = 200;
    while (level.length > 1) {
      const P = Math.ceil(level.length / MAXCH);
      const base = Math.floor(level.length / P);
      const extra = level.length % P;
      const next = [];
      let idx = 0;
      for (let p = 0; p < P; p++) {
        const n = base + (p < extra ? 1 : 0);
        const kids = level.slice(idx, idx + n);
        idx += n;
        const cells = [];
        for (let k = 0; k < kids.length - 1; k++) {
          cells.push(Uint8Array.from([...u32(kids[k].page), ...varint(kids[k].max)]));
        }
        const page = pager.alloc();
        writePage(pager.get(page), 0, 0x05, cells, kids[kids.length - 1].page);
        next.push({ page, max: kids[kids.length - 1].max });
      }
      level = next;
    }
    return level[0].page;
  }

  /** Index b-tree from key records (Uint8Array) sorted ascending. Returns the root page number. */
  function buildIndex(pager, keys) {
    const leafCell = (k) => {
      if (k.length > MAX_INDEX_PAYLOAD) throw new Error('index key too large');
      return concat([Uint8Array.from(varint(k.length)), k]);
    };
    const intCell = (child, k) => concat([Uint8Array.from(u32(child)), Uint8Array.from(varint(k.length)), k]);
    const N = keys.length;
    let maxLeaf = 1;
    for (const k of keys) maxLeaf = Math.max(maxLeaf, leafCell(k).length + 2);
    const perLeaf = Math.max(2, Math.floor((PAGE - 8) / maxLeaf));
    if (N <= perLeaf) {
      const page = pager.alloc();
      writePage(pager.get(page), 0, 0x0a, keys.map(leafCell), 0);
      return page;
    }
    const L = Math.ceil((N + 1) / (perLeaf + 1));
    const leafKeys = N - (L - 1);
    const base = Math.floor(leafKeys / L);
    const extra = leafKeys % L;
    let children = [];
    let seps = [];
    let idx = 0;
    for (let l = 0; l < L; l++) {
      const n = base + (l < extra ? 1 : 0);
      const page = pager.alloc();
      writePage(pager.get(page), 0, 0x0a, keys.slice(idx, idx + n).map(leafCell), 0);
      idx += n;
      children.push(page);
      if (l < L - 1) { seps.push(keys[idx]); idx += 1; }
    }
    let maxInt = 1;
    for (const s of seps) maxInt = Math.max(maxInt, intCell(0, s).length + 2);
    const maxCh = Math.max(3, Math.floor((PAGE - 12) / maxInt));
    while (children.length > 1) {
      if (children.length <= maxCh) {
        const cells = [];
        for (let i = 0; i < children.length - 1; i++) cells.push(intCell(children[i], seps[i]));
        const page = pager.alloc();
        writePage(pager.get(page), 0, 0x02, cells, children[children.length - 1]);
        return page;
      }
      const P = Math.ceil(children.length / maxCh);
      const b = Math.floor(children.length / P);
      const e = children.length % P;
      const nextChildren = [];
      const nextSeps = [];
      let a = 0;
      for (let p = 0; p < P; p++) {
        const n = b + (p < e ? 1 : 0);
        const cells = [];
        for (let i = a; i < a + n - 1; i++) cells.push(intCell(children[i], seps[i]));
        const page = pager.alloc();
        writePage(pager.get(page), 0, 0x02, cells, children[a + n - 1]);
        nextChildren.push(page);
        if (p < P - 1) nextSeps.push(seps[a + n - 1]);
        a += n;
      }
      children = nextChildren;
      seps = nextSeps;
    }
    return children[0];
  }

  // ---- the ProPresenter module ----------------------------------------------------------------------------------

  const DDL = {
    books: 'CREATE TABLE books\n  (\n     pk        INTEGER PRIMARY KEY,\n     book_name VARCHAR\n  )',
    chapters: 'CREATE TABLE chapters\n  (\n     pk          INTEGER PRIMARY KEY,\n     book_id     INTEGER REFERENCES books,\n     chapter_num INTEGER\n  )',
    verses: 'CREATE TABLE verses\n  (\n     pk         INTEGER PRIMARY KEY,\n     chapter_id INTEGER REFERENCES chapters,\n     verse_num  INTEGER,\n     content    VARCHAR\n  )',
    ZBOOK: 'CREATE TABLE ZBOOK\n(\n    Z_PK            INTEGER PRIMARY KEY,\n    Z_ENT           INTEGER,\n    Z_OPT           INTEGER,\n    ZBOOK_INDEX     INTEGER,\n    ZTOBIBLE        INTEGER,\n    ZBOOK_NAME      VARCHAR,\n    ZBOOK_TESTIMENT VARCHAR\n)',
    ZBOOK_ZTOBIBLE_INDEX: 'CREATE INDEX ZBOOK_ZTOBIBLE_INDEX ON ZBOOK (ZTOBIBLE)',
    ZCHAPTER: 'CREATE TABLE ZCHAPTER\n(\n    Z_PK            INTEGER PRIMARY KEY,\n    Z_ENT           INTEGER,\n    Z_OPT           INTEGER,\n    ZCHAPTER_NUMBER INTEGER,\n    ZTOBOOK         INTEGER\n)',
    ZCHAPTER_ZTOBOOK_INDEX: 'CREATE INDEX ZCHAPTER_ZTOBOOK_INDEX ON ZCHAPTER (ZTOBOOK)',
    ZVERSE: 'CREATE TABLE ZVERSE\n(\n    Z_PK           INTEGER PRIMARY KEY,\n    Z_ENT          INTEGER,\n    Z_OPT          INTEGER,\n    ZVERSE_NUMBER  INTEGER,\n    ZTOCHAPTER     INTEGER,\n    ZVERSE_CONTENT VARCHAR\n)',
    ZVERSE_ZTOCHAPTER_INDEX: 'CREATE INDEX ZVERSE_ZTOCHAPTER_INDEX ON ZVERSE (ZTOCHAPTER)',
    Z_PRIMARYKEY: 'CREATE TABLE Z_PRIMARYKEY\n(\n    Z_ENT   INTEGER PRIMARY KEY,\n    Z_NAME  VARCHAR,\n    Z_SUPER INTEGER,\n    Z_MAX   INTEGER\n)',
    ZBIBLE: 'CREATE TABLE ZBIBLE\n(\n    Z_PK                       INTEGER PRIMARY KEY,\n    Z_ENT                      INTEGER,\n    Z_OPT                      INTEGER,\n    ZBIBLE_PUBLISHER           VARCHAR,\n    ZBIBLE_NAME                VARCHAR,\n    ZBIBLE_COPYRIGHT           VARCHAR,\n    ZBIBLE_CHECKSUM            VARCHAR,\n    ZBIBLE_REGISTRATION_NAME   VARCHAR,\n    ZBIBLE_LANGUAGE            VARCHAR,\n    ZBIBLE_ABBREVIATION        VARCHAR,\n    ZBIBLE_REGISTRATION_NUMBER VARCHAR\n)',
  };
  // objects in the order the module in use lists them: [type, name, table, ddl]
  const OBJECTS = [
    ['table', 'books', 'books'], ['table', 'chapters', 'chapters'], ['table', 'verses', 'verses'],
    ['table', 'ZBOOK', 'ZBOOK'], ['index', 'ZBOOK_ZTOBIBLE_INDEX', 'ZBOOK'],
    ['table', 'ZCHAPTER', 'ZCHAPTER'], ['index', 'ZCHAPTER_ZTOBOOK_INDEX', 'ZCHAPTER'],
    ['table', 'ZVERSE', 'ZVERSE'], ['index', 'ZVERSE_ZTOCHAPTER_INDEX', 'ZVERSE'],
    ['table', 'Z_PRIMARYKEY', 'Z_PRIMARYKEY'], ['table', 'ZBIBLE', 'ZBIBLE'],
  ];

  /**
   * @param {{idx:number, name:string, chapters:string[][]}[]} books  chapters[c][v] = text of chapter c+1, verse v+1
   * @param {{name:string, slotAbbr?:string, language?:string}} meta
   * @returns {Uint8Array} the bytes of bible.db3
   */
  function buildModuleDb(books, meta) {
    const slot = (meta && meta.slotAbbr) || 'ACV';
    const language = (meta && meta.language) || 'Armenian';
    const rBooks = [], rChapters = [], rVerses = [], zBook = [], zChapter = [], zVerse = [];
    const kBook = [], kChapter = [], kVerse = [];
    let chPk = 0;
    let vPk = 0;
    for (const b of books) {
      rBooks.push({ rowid: b.idx, rec: makeRecord([null, b.name]) });
      zBook.push({ rowid: b.idx, rec: makeRecord([null, 2, 1, b.idx, 1, b.name, null]) });
      kBook.push({ key: [1, b.idx] });
      b.chapters.forEach((verses, ci) => {
        chPk += 1;
        rChapters.push({ rowid: chPk, rec: makeRecord([null, b.idx, ci + 1]) });
        zChapter.push({ rowid: chPk, rec: makeRecord([null, 3, 2, ci + 1, b.idx]) });
        kChapter.push({ key: [b.idx, chPk] });
        verses.forEach((text, vi) => {
          vPk += 1;
          rVerses.push({ rowid: vPk, rec: makeRecord([null, chPk, vi + 1, text]) });
          zVerse.push({ rowid: vPk, rec: makeRecord([null, 4, 1, vi + 1, chPk, text]) });
          kVerse.push({ key: [chPk, vPk] });
        });
      });
    }
    const zKeys = [
      { rowid: 1, rec: makeRecord([null, 'Bible', 0, 1]) },
      { rowid: 2, rec: makeRecord([null, 'Book', 0, books.length]) },
      { rowid: 3, rec: makeRecord([null, 'Chapter', 0, chPk]) },
      { rowid: 4, rec: makeRecord([null, 'Verse', 0, vPk]) },
    ];
    const zBible = [{ rowid: 1, rec: makeRecord([null, 2, 1, 'Public Domain', meta.name, 'Public Domain', 'XXXXXXXXXXX',
      'Public Domain', language, slot, 'Public Domain']) }];
    const idxRec = (k) => makeRecord(k);

    const pager = new Pager();
    const root = {};
    root.books = buildTable(pager, rBooks);
    root.chapters = buildTable(pager, rChapters);
    root.verses = buildTable(pager, rVerses);
    root.ZBOOK = buildTable(pager, zBook);
    root.ZBOOK_ZTOBIBLE_INDEX = buildIndex(pager, kBook.map((x) => idxRec(x.key)));
    root.ZCHAPTER = buildTable(pager, zChapter);
    root.ZCHAPTER_ZTOBOOK_INDEX = buildIndex(pager, kChapter.map((x) => idxRec(x.key)));
    root.ZVERSE = buildTable(pager, zVerse);
    root.ZVERSE_ZTOCHAPTER_INDEX = buildIndex(pager, kVerse.map((x) => idxRec(x.key)));
    root.Z_PRIMARYKEY = buildTable(pager, zKeys);
    root.ZBIBLE = buildTable(pager, zBible);

    // page 1: the header and sqlite_master
    const first = pager.get(1);
    const masterCells = OBJECTS.map(([type, name, tbl], i) => {
      const rec = makeRecord([type, name, tbl, root[name], DDL[name]]);
      return concat([Uint8Array.from(varint(rec.length)), Uint8Array.from(varint(i + 1)), rec]);
    });
    writePage(first, 100, 0x0d, masterCells, 0);
    const nPages = pager.pages.length;
    first.set(encoder.encode('SQLite format 3\0'), 0);
    first[16] = (PAGE >> 8) & 255; first[17] = PAGE & 255;
    first[18] = 1; first[19] = 1; first[20] = 0;
    first[21] = 64; first[22] = 32; first[23] = 32;
    first.set(u32(1), 24);                 // file change counter
    first.set(u32(nPages), 28);            // size of the database in pages
    first.set(u32(1), 40);                 // schema cookie
    first.set(u32(4), 44);                 // schema format number
    first.set(u32(1), 56);                 // text encoding: UTF-8
    first.set(u32(1), 92);                 // version-valid-for = change counter
    first.set(u32(3035005), 96);           // SQLite version number the reference file was written with
    return concat(pager.pages);
  }

  AB.sqlite = { buildModuleDb, makeRecord, varint, PAGE };
})();
