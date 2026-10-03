/*
 * References: understanding "Ин 3:16", "1 Кор 13", "Հով 3:16", "Псалом 22" and the Psalm numbering difference.
 * This Bible numbers the Psalms the Hebrew way (as Armenian Bibles do); Russian Bibles use the Greek/Slavonic way.
 */
(function () {
  'use strict';
  const AB = (globalThis.AB = globalThis.AB || {});

  // ---- Psalm numbering -------------------------------------------------------------------------------------------

  /** Number in this Bible -> how the Russian Bible numbers it (a string, sometimes a range). */
  function psalmToRu(n) {
    if (n <= 8) return String(n);
    if (n === 9 || n === 10) return '9';
    if (n <= 113) return String(n - 1);
    if (n === 114 || n === 115) return '113';
    if (n === 116) return '114–115';
    if (n <= 146) return String(n - 1);
    if (n === 147) return '146–147';
    return String(n);
  }

  /** Number in the Russian Bible -> number in this Bible (where a Russian Psalm is split, the first part). */
  function psalmFromRu(r) {
    if (r <= 9) return r;
    if (r <= 112) return r + 1;
    if (r === 113) return 114;
    if (r === 114 || r === 115) return 116;
    if (r <= 145) return r + 1;
    if (r === 146 || r === 147) return 147;
    return r;
  }

  // ---- book names ------------------------------------------------------------------------------------------------

  // extra Russian spellings people type
  const EXTRA_RU = {
    19: ['псалом', 'псалмы', 'псалтырь'], 20: ['притчи соломона'], 21: ['эклезиаст', 'екклесиаст'], 22: ['песня песней', 'песнь песней'],
    23: ['исайя'], 27: ['даниил'], 40: ['матфей'], 41: ['марк'], 42: ['лука'], 43: ['иоанн', 'иоанна'], 44: ['деяния апостолов', 'деяния'],
    66: ['апокалипсис', 'откровение иоанна'],
  };

  // common Armenian short forms that would otherwise be ambiguous (Հով = Հովհաննես, not Հովել or Հովնան)
  const EXTRA_HY = { 43: ['հով', 'յովհ', 'հովհ'], 62: ['1 հով', '1 յով'], 63: ['2 հով', '2 յով'], 64: ['3 հով', '3 յով'] };

  const isArmenian = (s) => /[Ա-֏]/.test(s);
  const ruNorm = (s) => String(s).toLowerCase().replace(/ё/g, 'е').replace(/[.,;:]/g, ' ').replace(/^(\d)\s*(?=\D)/, '$1 ').replace(/\s+/g, ' ').trim();
  // Classical Յ at the start of a word is Հ in the reformed spelling (Յովհաննէս / Հովհաննես)
  const hyNorm = (s) => AB.fold.fold(s).replace(/(^|\s)յ/g, '$1հ').replace(/\s+/g, ' ').trim();

  function aliases() {
    const out = [];
    for (const bm of AB.index.books) {
      const a = [];
      const add = (text, lang) => { if (text) a.push({ text: lang === 'hy' ? hyNorm(text) : ruNorm(text), lang }); };
      add(bm.hy, 'hy');
      add(AB.Data.bookName(bm.i), 'hy');
      add(bm.ru, 'ru');
      add(bm.ab, 'ru');
      if (/^От /.test(bm.ru)) add(bm.ru.replace(/^От /, ''), 'ru');
      for (const x of EXTRA_RU[bm.i] || []) add(x, 'ru');
      for (const x of EXTRA_HY[bm.i] || []) add(x, 'hy');
      out.push({ i: bm.i, aliases: a });
    }
    return out;
  }

  /** @returns {{book:number|null, lang:string, candidates:number[]}} */
  function matchBook(query) {
    const arm = isArmenian(query);
    const q = arm ? hyNorm(query) : ruNorm(query);
    if (!q) return { book: null, lang: '', candidates: [] };
    const list = aliases();
    for (const b of list) {
      for (const a of b.aliases) if (a.text === q && (a.lang === 'hy') === arm) return { book: b.i, lang: a.lang, candidates: [b.i] };
    }
    const cand = [];
    let lang = '';
    for (const b of list) {
      const hit = b.aliases.find((a) => (a.lang === 'hy') === arm && a.text.startsWith(q));
      if (hit) { cand.push(b.i); lang = hit.lang; }
    }
    return { book: cand.length === 1 ? cand[0] : null, lang, candidates: cand };
  }

  /** Books that contain the text anywhere in one of their names (for filtering the book list). */
  function filterBooks(query) {
    const arm = isArmenian(query);
    const q = arm ? hyNorm(query) : ruNorm(query);
    if (!q) return null;
    const set = new Set();
    for (const b of aliases()) if (b.aliases.some((a) => a.text.includes(q))) set.add(b.i);
    return set;
  }

  /**
   * Parses a typed reference.
   * @returns {null | {ok:boolean, b?:number, c?:number, v?:number, hasChapter?:boolean, note?:string, candidates?:number[]}}
   */
  function parse(text) {
    const s = String(text || '').trim();
    if (!s) return null;
    const m = /^(.*?)\s*(\d{1,3})(?:(?:\s*[:.,]\s*|\s+)(\d{1,3}))?(?:\s*[-–]\s*\d{1,3})?\s*$/.exec(s);
    const bookPart = m ? m[1] : s;
    if (!bookPart.replace(/[.\s]/g, '')) return null;
    const hit = matchBook(bookPart);
    if (!hit.book) return { ok: false, candidates: hit.candidates };
    const bm = AB.Data.bookMeta(hit.book);
    const res = { ok: true, b: hit.book, c: 1, v: 0, note: '', hasChapter: !!m };
    if (m) {
      let c = Number(m[2]);
      if (hit.book === 19 && hit.lang === 'ru') {
        const conv = psalmFromRu(c);
        if (conv !== c) res.note = AB.t('Псалом {ru} в русской Библии — это Псалом {n} здесь.', { ru: c, n: conv });
        c = conv;
      }
      res.c = Math.min(Math.max(c, 1), bm.vs.length);
      if (res.c !== c) res.note = AB.t('В этой книге {n} глав.', { n: bm.vs.length });
      if (m[3]) res.v = Number(m[3]);
    }
    return res;
  }

  /** The book-name part of a typed reference (numbers at the end removed). */
  function bookPart(text) {
    const s = String(text || '').trim();
    const m = /^(.*?)\s*(\d{1,3})(?:(?:\s*[:.,]\s*|\s+)(\d{1,3}))?(?:\s*[-\u2013]\s*\d{1,3})?\s*$/.exec(s);
    return m ? m[1] : s;
  }

  AB.refs = { bookPart, psalmToRu, psalmFromRu, matchBook, filterBooks, parse, hyNorm, ruNorm };
})();
