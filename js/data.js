/*
 * The Bible in memory: base text (shipped with the page) + the reader's edits.
 * Verse numbers are never stored — a verse's number is its position in the chapter, so inserting, deleting,
 * splitting and merging always leave the numbering 1..N.
 */
(function () {
  'use strict';
  const AB = (globalThis.AB = globalThis.AB || {});

  const cfg = () => Object.assign({ dataMode: 'script', dataBase: 'data/' }, AB.config || {});
  const pad = (n) => String(n).padStart(2, '0');
  const key = (b, c) => b + ':' + c;

  let store = null;
  let overrides = new Map();          // "b:c" -> verses[] (only chapters that differ from the base)
  let meta = {};
  const listeners = new Set();
  const loading = new Map();
  const undoStack = [];

  // ---- loading ---------------------------------------------------------------------------------------------------

  function loadBook(i) {
    AB.data = AB.data || {};
    if (AB.data[i]) return Promise.resolve(AB.data[i]);
    if (loading.has(i)) return loading.get(i);
    const c = cfg();
    const p = new Promise((resolve, reject) => {
      if (c.dataMode === 'fetch') {
        fetch(c.dataBase + 'b' + pad(i) + '.json')
          .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
          .then((json) => { AB.data[i] = json; resolve(json); })
          .catch(reject);
      } else {
        const s = document.createElement('script');
        s.src = c.dataBase + 'b' + pad(i) + '.js';
        s.onload = () => (AB.data[i] ? resolve(AB.data[i]) : reject(new Error('no data in ' + s.src)));
        s.onerror = () => reject(new Error('cannot load ' + s.src));
        document.head.appendChild(s);
      }
    });
    loading.set(i, p);
    p.catch(() => loading.delete(i));
    return p;
  }

  async function loadAll(onProgress) {
    let done = 0;
    const n = AB.index.books.length;
    for (const b of AB.index.books) {
      await loadBook(b.i);
      done += 1;
      if (onProgress) onProgress(done, n);
    }
  }

  const isLoaded = (i) => !!(AB.data && AB.data[i]);
  const allLoaded = () => AB.index.books.every((b) => isLoaded(b.i));

  // ---- reading ---------------------------------------------------------------------------------------------------

  const bookMeta = (i) => AB.index.books[i - 1];
  const chapterCount = (i) => bookMeta(i).vs.length;
  const baseVerses = (b, c) => AB.data[b][c - 1];
  const verses = (b, c) => overrides.get(key(b, c)) || baseVerses(b, c);
  const isEdited = (b, c) => overrides.has(key(b, c));
  const bookName = (i) => (meta.bookNames && meta.bookNames[i]) || bookMeta(i).hy;
  const verseCount = (b, c) => (isLoaded(b) ? verses(b, c).length : bookMeta(b).vs[c - 1]);
  const equalArrays = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

  // ---- diff (which verses changed) -------------------------------------------------------------------------------

  /** Verse-level diff of an edited chapter against its base. Returns ops in order. */
  function diffVerses(a, b) {
    const n = a.length, m = b.length;
    let s = 0;
    while (s < n && s < m && a[s] === b[s]) s++;
    let e = 0;
    while (e < n - s && e < m - s && a[n - 1 - e] === b[m - 1 - e]) e++;
    const A = a.slice(s, n - e), B = b.slice(s, m - e);
    const N = A.length, M = B.length;
    const dp = [];
    for (let i = 0; i <= N; i++) dp.push(new Uint16Array(M + 1));
    for (let i = N - 1; i >= 0; i--) {
      for (let j = M - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
    const raw = [];
    let i = 0, j = 0;
    while (i < N && j < M) {
      if (A[i] === B[j]) { raw.push({ t: 'same' }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { raw.push({ t: 'del', a: s + i }); i++; }
      else { raw.push({ t: 'ins', b: s + j }); j++; }
    }
    while (i < N) { raw.push({ t: 'del', a: s + i }); i++; }
    while (j < M) { raw.push({ t: 'ins', b: s + j }); j++; }
    // pair a run of deletions and insertions into "changed" verses
    const ops = [];
    let k = 0;
    while (k < raw.length) {
      if (raw[k].t === 'same') { k++; continue; }
      const dels = [], inss = [];
      while (k < raw.length && raw[k].t !== 'same') { (raw[k].t === 'del' ? dels : inss).push(raw[k]); k++; }
      const pairs = Math.min(dels.length, inss.length);
      for (let p = 0; p < pairs; p++) ops.push({ t: 'chg', a: dels[p].a, b: inss[p].b });
      for (let p = pairs; p < dels.length; p++) ops.push(dels[p]);
      for (let p = pairs; p < inss.length; p++) ops.push(inss[p]);
    }
    return ops;
  }

  const diffCache = new WeakMap();
  function chapterDiff(b, c) {
    const cur = overrides.get(key(b, c));
    if (!cur) return [];
    let d = diffCache.get(cur);
    if (!d) { d = diffVerses(baseVerses(b, c), cur); diffCache.set(cur, d); }
    return d;
  }

  /** Overall figures for the badge and the changes list. */
  function summary() {
    let chapters = 0, changed = 0, inserted = 0, deleted = 0;
    const list = [];
    for (const k of overrides.keys()) {
      const [b, c] = k.split(':').map(Number);
      if (!isLoaded(b)) continue;
      const ops = chapterDiff(b, c);
      chapters += 1;
      const ch = ops.filter((o) => o.t === 'chg').length, ins = ops.filter((o) => o.t === 'ins').length, del = ops.filter((o) => o.t === 'del').length;
      changed += ch; inserted += ins; deleted += del;
      list.push({ b, c, ops, changed: ch, inserted: ins, deleted: del });
    }
    list.sort((x, y) => x.b - y.b || x.c - y.c);
    return { chapters, changed, inserted, deleted, touched: changed + inserted + deleted, list, bookNames: metaRenamed() };
  }

  function metaRenamed() {
    const out = [];
    for (const [i, name] of Object.entries(meta.bookNames || {})) {
      const b = bookMeta(Number(i));
      if (b && name && name !== b.hy) out.push({ i: Number(i), name });
    }
    return out;
  }

  // ---- writing ---------------------------------------------------------------------------------------------------

  function emit(what) { for (const fn of listeners) { try { fn(what); } catch (e) { console.error(e); } } }
  const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  function applyChapter(k, arr) {
    const [b, c] = k.split(':').map(Number);
    if (arr === null || equalArrays(arr, baseVerses(b, c))) {
      if (overrides.has(k)) { overrides.delete(k); store.putChapter(k, null); }
    } else {
      overrides.set(k, arr);
      store.putChapter(k, arr);
    }
  }

  /**
   * Applies a set of chapter changes as one undoable step.
   * @param {Map<string, string[]|null>} changes  "b:c" -> new verses (null = back to the original)
   */
  function commit(changes, label) {
    const before = new Map();
    for (const k of changes.keys()) before.set(k, overrides.has(k) ? overrides.get(k) : null);
    for (const [k, arr] of changes) applyChapter(k, arr);
    undoStack.push({ label, before, after: changes });
    if (undoStack.length > 30) undoStack.shift();
    emit({ type: 'edit', keys: [...changes.keys()], label });
  }

  function canUndo() { return undoStack.length > 0; }
  function lastLabel() { return undoStack.length ? undoStack[undoStack.length - 1].label : ''; }

  function undo() {
    const step = undoStack.pop();
    if (!step) return null;
    for (const [k, arr] of step.before) applyChapter(k, arr);
    emit({ type: 'undo', keys: [...step.before.keys()], label: step.label });
    return step.label;
  }

  // single-verse operations ---------------------------------------------------------------------------------------

  const cleanVerse = (t) => String(t).replace(/\s+/g, ' ').trim();

  function setVerse(b, c, v, text, label) {
    const cur = verses(b, c);
    const next = cur.slice();
    next[v - 1] = cleanVerse(text);
    commit(new Map([[key(b, c), next]]), label || 'правка стиха');
  }

  function insertAfter(b, c, v, text) {
    const next = verses(b, c).slice();
    next.splice(v, 0, cleanVerse(text));
    commit(new Map([[key(b, c), next]]), 'новый стих');
  }

  function deleteVerse(b, c, v) {
    const cur = verses(b, c);
    if (cur.length <= 1) return false;
    const next = cur.slice();
    next.splice(v - 1, 1);
    commit(new Map([[key(b, c), next]]), 'удаление стиха');
    return true;
  }

  function mergeWithNext(b, c, v) {
    const cur = verses(b, c);
    if (v >= cur.length) return false;
    const next = cur.slice();
    next.splice(v - 1, 2, cleanVerse(cur[v - 1] + ' ' + cur[v]));
    commit(new Map([[key(b, c), next]]), 'объединение стихов');
    return true;
  }

  function splitAt(b, c, v, left, right) {
    const next = verses(b, c).slice();
    const l = cleanVerse(left), r = cleanVerse(right);
    if (!l || !r) return false;
    next.splice(v - 1, 1, l, r);
    commit(new Map([[key(b, c), next]]), 'разделение стиха');
    return true;
  }

  /** Last verse of chapter c becomes the first verse of chapter c+1 (needs both books loaded). */
  function moveLastToNext(b, c) {
    if (c >= chapterCount(b)) return false;
    const cur = verses(b, c), nxt = verses(b, c + 1);
    if (cur.length <= 1) return false;
    commit(new Map([[key(b, c), cur.slice(0, -1)], [key(b, c + 1), [cur[cur.length - 1]].concat(nxt)]]), 'перенос стиха в следующую главу');
    return true;
  }

  /** First verse of chapter c becomes the last verse of chapter c-1. */
  function moveFirstToPrev(b, c) {
    if (c <= 1) return false;
    const cur = verses(b, c), prv = verses(b, c - 1);
    if (cur.length <= 1) return false;
    commit(new Map([[key(b, c - 1), prv.concat([cur[0]])], [key(b, c), cur.slice(1)]]), 'перенос стиха в предыдущую главу');
    return true;
  }

  /** Puts a whole chapter (a saved version) back; null = the original text. */
  function setChapter(b, c, verses, label) {
    commit(new Map([[key(b, c), verses && verses.length ? verses.slice() : null]]), label || 'восстановление версии');
  }

  /** Earlier saved versions of a chapter (only the shared store keeps them). */
  async function history(b, c, limit) {
    return store && typeof store.history === 'function' ? store.history(key(b, c), limit) : [];
  }

  /** Whether the shared store has saved versions of this chapter. */
  const hasHistory = (b, c) => !!(store && store.stamps && store.stamps.has && store.stamps.has(key(b, c)));

  function revertChapter(b, c) {
    if (!isEdited(b, c)) return false;
    commit(new Map([[key(b, c), null]]), 'возврат главы');
    return true;
  }

  function revertVerse(b, c, v) {
    // only meaningful when the chapter has the same number of verses as the base
    const base = baseVerses(b, c), cur = verses(b, c);
    if (base.length !== cur.length) return false;
    const next = cur.slice();
    next[v - 1] = base[v - 1];
    commit(new Map([[key(b, c), next]]), 'возврат стиха');
    return true;
  }

  function revertAll() {
    const changes = new Map();
    for (const k of overrides.keys()) changes.set(k, null);
    if (!changes.size) return 0;
    commit(changes, 'возврат всех правок');
    return changes.size;
  }

  // meta ----------------------------------------------------------------------------------------------------------

  const getMeta = () => meta;
  function setMeta(patch) {
    meta = Object.assign({}, meta, patch);
    store.putMeta(meta);
    emit({ type: 'meta' });
  }
  function setBookName(i, name) {
    const names = Object.assign({}, meta.bookNames || {});
    const n = cleanVerse(name);
    if (!n || n === bookMeta(i).hy) delete names[i]; else names[i] = n;
    setMeta({ bookNames: names });
  }

  // search --------------------------------------------------------------------------------------------------------

  const foldCache = new WeakMap();
  function foldedChapter(b, c) {
    const arr = verses(b, c);
    let f = foldCache.get(arr);
    if (!f) { f = arr.map((t) => AB.fold.fold(t)); foldCache.set(arr, f); }
    return f;
  }

  /** All verses whose folded text contains every token. Requires every book to be loaded. */
  function search(query, opts) {
    const toks = AB.fold.tokens(query);
    if (!toks.length) return { toks, hits: [] };
    const only = opts && opts.book;
    const hits = [];
    for (const bm of AB.index.books) {
      if (only && bm.i !== only) continue;
      if (!isLoaded(bm.i)) continue;
      for (let c = 1; c <= bm.vs.length; c++) {
        const f = foldedChapter(bm.i, c);
        for (let v = 0; v < f.length; v++) {
          const s = f[v];
          let ok = true;
          for (const tk of toks) if (s.indexOf(tk) < 0) { ok = false; break; }
          if (ok) hits.push({ b: bm.i, c, v: v + 1 });
        }
      }
    }
    return { toks, hits };
  }

  /** Literal, case-sensitive occurrences (used by replace). */
  function findLiteral(needle) {
    const hits = [];
    if (!needle) return hits;
    for (const bm of AB.index.books) {
      if (!isLoaded(bm.i)) continue;
      for (let c = 1; c <= bm.vs.length; c++) {
        const vs = verses(bm.i, c);
        for (let v = 0; v < vs.length; v++) if (vs[v].indexOf(needle) >= 0) hits.push({ b: bm.i, c, v: v + 1 });
      }
    }
    return hits;
  }

  function replaceLiteral(needle, replacement) {
    const changes = new Map();
    let count = 0;
    for (const bm of AB.index.books) {
      if (!isLoaded(bm.i)) continue;
      for (let c = 1; c <= bm.vs.length; c++) {
        const vs = verses(bm.i, c);
        let next = null;
        for (let v = 0; v < vs.length; v++) {
          if (vs[v].indexOf(needle) >= 0) {
            if (!next) next = vs.slice();
            const parts = vs[v].split(needle);
            count += parts.length - 1;
            const text = cleanVerse(parts.join(replacement));
            if (!text) return { error: 'empty' };
            next[v] = text;
          }
        }
        if (next) changes.set(key(bm.i, c), next);
      }
    }
    if (!changes.size) return { count: 0, chapters: 0 };
    commit(changes, 'замена «' + needle + '»');
    return { count, chapters: changes.size };
  }

  // whole Bible for the export -------------------------------------------------------------------------------------

  function exportBooks() {
    return AB.index.books.map((bm) => ({
      idx: bm.i,
      name: bookName(bm.i),
      chapters: bm.vs.map((_, ci) => verses(bm.i, ci + 1).slice()),
    }));
  }

  // backup file ---------------------------------------------------------------------------------------------------

  function backupJson() {
    const chapters = {};
    for (const [k, v] of overrides) chapters[k] = v;
    return JSON.stringify({ app: 'ararat-bible-edits', v: 1, base: AB.index.version, savedAt: new Date().toISOString(), meta, chapters }, null, 1);
  }

  /** Returns {chapters, skipped} — applies the file's chapters as one undoable step. */
  function restoreBackup(text) {
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('Файл не похож на копию правок (это не JSON).'); }
    if (!data || data.app !== 'ararat-bible-edits' || typeof data.chapters !== 'object') throw new Error('Это не файл с правками этой Библии.');
    const changes = new Map();
    let skipped = 0;
    for (const [k, arr] of Object.entries(data.chapters)) {
      const [b, c] = k.split(':').map(Number);
      if (!bookMeta(b) || !(c >= 1 && c <= chapterCount(b)) || !Array.isArray(arr) || !arr.length || arr.some((x) => typeof x !== 'string' || !cleanVerse(x))) { skipped += 1; continue; }
      changes.set(k, arr.map(cleanVerse));
    }
    if (changes.size) commit(changes, 'загрузка правок из файла');
    if (data.meta && typeof data.meta === 'object') {
      const patch = {};
      for (const f of ['name', 'abbr', 'slotAbbr']) if (typeof data.meta[f] === 'string') patch[f] = data.meta[f];
      if (data.meta.bookNames && typeof data.meta.bookNames === 'object') patch.bookNames = data.meta.bookNames;
      if (Object.keys(patch).length) setMeta(patch);
    }
    return { chapters: changes.size, skipped };
  }

  // ---- start-up --------------------------------------------------------------------------------------------------

  async function init() {
    const created = await AB.store.create();
    store = created.store;
    overrides = created.loaded.chapters;
    meta = created.loaded.meta || {};
    store.onRemote = (msg) => {
      if (msg.type === 'meta') { meta = msg.meta; emit({ type: 'remote', keys: [] }); return; }
      const [b, c] = String(msg.key).split(':').map(Number);
      if (!bookMeta(b) || !(c >= 1 && c <= chapterCount(b))) return;
      let next = msg.verses && msg.verses.length ? msg.verses : null;
      if (next && isLoaded(b) && equalArrays(next, baseVerses(b, c))) next = null;      // same as the original text: no edit
      const cur = overrides.get(msg.key) || null;
      if ((next === null && cur === null) || (next && cur && equalArrays(next, cur))) return;   // nothing new (the echo of our own change)
      if (next) overrides.set(msg.key, next); else overrides.delete(msg.key);
      emit({ type: 'remote', keys: [msg.key], by: msg.by || '' });
    };
    return store;
  }

  /** Overrides that no longer differ from the base (e.g. after the base text was updated) are dropped once loaded. */
  function tidy(bookIdx) {
    for (const k of [...overrides.keys()]) {
      const [b, c] = k.split(':').map(Number);
      if (b !== bookIdx) continue;
      const base = AB.data[b] && AB.data[b][c - 1];
      if (!base) { overrides.delete(k); store.putChapter(k, null); continue; }
      if (equalArrays(overrides.get(k), base)) { overrides.delete(k); store.putChapter(k, null); }
    }
  }

  AB.Data = {
    init, tidy, loadBook, loadAll, isLoaded, allLoaded, bookMeta, chapterCount, verses, baseVerses, verseCount, isEdited,
    bookName, summary, chapterDiff, diffVerses, onChange, commit, undo, canUndo, lastLabel,
    setVerse, insertAfter, deleteVerse, mergeWithNext, splitAt, moveLastToNext, moveFirstToPrev, setChapter, history, hasHistory, revertChapter, revertVerse,
    revertAll, getMeta, setMeta, setBookName, search, findLiteral, replaceLiteral, exportBooks, backupJson, restoreBackup,
    cleanVerse, key, get store() { return store; }, get editedKeys() { return [...overrides.keys()]; },
  };
})();
