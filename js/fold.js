/*
 * Search folding: makes classical and reformed Armenian spelling, capitals and punctuation compare equal,
 * so a search for «Աստված» also finds «Աստուած», and «մոտ» finds «մօտ».
 * foldMap() also returns, for every folded character, the span of the original text it came from,
 * so matches can be highlighted in the original verse.
 */
(function () {
  'use strict';
  const AB = (globalThis.AB = globalThis.AB || {});

  const CONS = 'բգդզթժլխծկհձղճմնշչպջռսվտրցփքֆ';
  const VOWEL_AFTER_U = 'աեէիոօ';
  const INWORD_MARKS = '՛՜՞՚’\'`';        // emphasis / exclamation / question marks and apostrophes sit inside words
  const isArm = (ch) => ch >= 'ա' && ch <= 'ֆ';
  const isWordChar = (ch) => isArm(ch) || ch === 'և' || (ch >= 'a' && ch <= 'z') || (ch >= 'а' && ch <= 'я') || ch === 'ё' || (ch >= '0' && ch <= '9');

  /** @returns {{s:string, from:Int32Array, to:Int32Array}} folded text and, per folded char, the original [from, to) span */
  function foldMap(text) {
    const src = String(text);
    const t = src.toLowerCase();
    const n = t.length;
    const out = [];
    const from = [];
    const to = [];
    const push = (ch, a, b) => { out.push(ch); from.push(a); to.push(b); };
    let i = 0;
    while (i < n) {
      const ch = t[i];
      const nx = t[i + 1];
      if (ch === 'ե' && nx === 'ւ') { push('և', i, i + 2); i += 2; continue; }
      if (ch === 'ա' && nx === 'ւ') { push('ա', i, i + 2); push('վ', i, i + 2); i += 2; continue; }
      if (ch === 'ի' && nx === 'ւ') {
        if (out.slice(-3).join('') === 'հով') { push('ի', i, i + 2); push('վ', i, i + 2); }      // հովիւ = հովիվ (shepherd)
        else { push('յ', i, i + 2); push('ո', i, i + 2); push('ւ', i, i + 2); }
        i += 2;
        continue;
      }
      if (ch === 'ո' && nx === 'ւ') {
        const prev = out[out.length - 1];
        if (prev && CONS.indexOf(prev) >= 0 && VOWEL_AFTER_U.indexOf(t[i + 2]) >= 0 && t[i + 2] !== undefined) {
          push('վ', i, i + 2);
        } else {
          push('ո', i, i + 2); push('ւ', i, i + 2);
        }
        i += 2;
        continue;
      }
      if (ch === 'ւ') { push('վ', i, i + 1); i += 1; continue; }
      if (ch === 'է') { push('ե', i, i + 1); i += 1; continue; }
      if (ch === 'օ') {
        const p = i > 0 ? t[i - 1] : '';
        push(isWordChar(p) ? 'ո' : 'օ', i, i + 1);
        i += 1;
        continue;
      }
      if (ch === 'ё') { push('е', i, i + 1); i += 1; continue; }
      if (INWORD_MARKS.indexOf(ch) >= 0) { i += 1; continue; }
      push(isWordChar(ch) ? ch : ' ', i, i + 1);
      i += 1;
    }
    return { s: out.join(''), from: Int32Array.from(from), to: Int32Array.from(to) };
  }

  function fold(text) { return foldMap(text).s; }

  /** Query words after folding (empty words removed). */
  function tokens(query) {
    return fold(query).split(/\s+/).filter(Boolean);
  }

  /**
   * Character ranges [start, end) of `text` covered by any of the (already folded) tokens, merged and sorted.
   */
  function ranges(text, toks) {
    const m = foldMap(text);
    const spans = [];
    for (const tk of toks) {
      let pos = 0;
      while ((pos = m.s.indexOf(tk, pos)) >= 0) {
        spans.push([m.from[pos], m.to[pos + tk.length - 1]]);
        pos += Math.max(1, tk.length);
      }
    }
    spans.sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const sp of spans) {
      const last = merged[merged.length - 1];
      if (last && sp[0] <= last[1]) last[1] = Math.max(last[1], sp[1]);
      else merged.push(sp.slice());
    }
    return merged;
  }

  AB.fold = { fold, foldMap, tokens, ranges };
})();
