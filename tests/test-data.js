// Node test for the data layer (edits, structure operations, undo, diff, search, replace, backup).
'use strict';
const fs = require('fs');
const path = require('path');

globalThis.AB = {};
for (const f of ['fold', 'platform', 'store', 'data']) require(path.join(__dirname, '..', 'js', f + '.js'));
const AB = globalThis.AB;

const idxSrc = fs.readFileSync(path.join(__dirname, '..', 'data', 'index.js'), 'utf8').replace(/^window\.AB=window\.AB\|\|\{\};AB\.index=/, '').replace(/;\s*$/, '');
AB.index = JSON.parse(idxSrc);
AB.data = {};
for (const b of AB.index.books) AB.data[b.i] = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'json', 'b' + String(b.i).padStart(2, '0') + '.json'), 'utf8'));

// memory store standing in for IndexedDB
const saved = new Map();
let savedMeta = {};
AB.store = {
  create: async () => ({
    store: {
      kind: 'test', persistent: true, onRemote: null,
      putChapter: async (k, v) => { if (v) saved.set(k, v); else saved.delete(k); },
      putMeta: async (m) => { savedMeta = m; },
    },
    loaded: { chapters: new Map(), meta: {} },
  }),
};

let bad = 0;
const ok = (c, m) => { if (!c) { bad++; console.error('FAIL', m); } };
const D = AB.Data;

(async () => {
  await D.init();
  const p23 = D.baseVerses(19, 23).slice();
  ok(D.verses(19, 23).length === 6, 'Psalm 23 has 6 verses');
  ok(D.summary().touched === 0 && !D.isEdited(19, 23), 'clean start');

  // edit one verse, then put the original text back -> no leftover override
  D.setVerse(19, 23, 1, 'Փորձ։');
  ok(D.isEdited(19, 23) && D.verses(19, 23)[0] === 'Փորձ։' && saved.has('19:23'), 'edit stored');
  ok(D.summary().changed === 1 && D.summary().touched === 1, 'summary after edit');
  D.setVerse(19, 23, 1, p23[0]);
  ok(!D.isEdited(19, 23) && !saved.has('19:23'), 'equal to base -> override dropped');
  D.undo(); D.undo();
  ok(!D.isEdited(19, 23) && D.canUndo() === false, 'undo stack empty again');

  // structure operations keep numbering contiguous
  D.insertAfter(19, 23, 2, 'նոր');
  ok(D.verses(19, 23).length === 7 && D.verses(19, 23)[2] === 'նոր', 'insert after 2');
  let s = D.summary();
  ok(s.inserted === 1 && s.changed === 0 && s.deleted === 0, 'summary insert ' + JSON.stringify([s.inserted, s.changed, s.deleted]));
  D.deleteVerse(19, 23, 3);
  ok(!D.isEdited(19, 23), 'insert + delete cancels out');
  ok(D.mergeWithNext(19, 23, 1) && D.verses(19, 23).length === 5 && D.verses(19, 23)[0] === p23[0] + ' ' + p23[1], 'merge');
  D.undo();
  ok(D.splitAt(19, 23, 1, 'ա', 'բ') && D.verses(19, 23)[0] === 'ա' && D.verses(19, 23)[1] === 'բ' && D.verses(19, 23).length === 7, 'split');
  D.undo();
  ok(D.deleteVerse(19, 117, 2) && D.verses(19, 117).length === 1, 'delete leaves one verse');
  ok(D.deleteVerse(19, 117, 1) === false && D.verses(19, 117).length === 1, 'the last verse of a chapter cannot be deleted');
  D.undo();
  ok(D.deleteVerse(19, 23, 6) && D.verses(19, 23).length === 5, 'delete last');
  D.undo();

  // move verses between chapters
  const n1 = D.verses(28, 11).length, n2 = D.verses(28, 12).length;
  ok(D.moveLastToNext(28, 11) && D.verses(28, 11).length === n1 - 1 && D.verses(28, 12).length === n2 + 1, 'move last to next chapter');
  ok(D.verses(28, 12)[0] === D.baseVerses(28, 11)[n1 - 1], 'moved verse is first in next chapter');
  s = D.summary();
  ok(s.chapters === 2 && s.deleted === 1 && s.inserted === 1, 'move shows as +1 / -1: ' + JSON.stringify([s.chapters, s.inserted, s.deleted]));
  D.undo();
  ok(D.summary().touched === 0, 'undo of a two-chapter step');
  ok(D.moveFirstToPrev(28, 12) && D.verses(28, 12).length === n2 - 1 && D.verses(28, 11).length === n1 + 1, 'move first to previous chapter');
  D.undo();

  // search: classical vs reformed spelling
  const hitsA = D.search('Աստվածը').hits.length, hitsB = D.search('Աստուածը').hits.length;
  ok(hitsA > 100 && hitsA === hitsB, 'spelling-insensitive search ' + hitsA + '/' + hitsB);
  ok(D.search('Աստուած', { book: 1 }).hits.every((h) => h.b === 1), 'book scope');
  ok(D.search('   ').hits.length === 0, 'empty query');

  // replace
  const before = D.findLiteral('Եհովա').length;
  ok(before > 500, 'many Եհովա: ' + before);
  const r = D.replaceLiteral('Եհովա', 'Տէր');
  ok(r.count > 500 && D.findLiteral('Եհովա').length === 0, 'replaced all: ' + r.count);
  ok(D.summary().touched > 500, 'summary counts replaced verses ' + D.summary().touched);
  const exported = D.exportBooks();
  ok(exported.length === 66 && exported[0].chapters.length === 50, 'exportBooks shape');
  D.undo();
  ok(D.findLiteral('Եհովա').length === before && D.summary().touched === 0, 'undo of replace');

  // backup round trip
  D.setVerse(43, 3, 16, 'Փորձ');
  D.setBookName(43, 'Հովհ');
  const json = D.backupJson();
  D.revertAll();
  D.setBookName(43, '');
  ok(D.summary().touched === 0, 'reverted');
  const res = D.restoreBackup(json);
  ok(res.chapters === 1 && D.verses(43, 3)[15] === 'Փորձ' && D.bookName(43) === 'Հովհ', 'restore backup');
  let threw = false;
  try { D.restoreBackup('{"a":1}'); } catch (e) { threw = true; }
  ok(threw, 'foreign json rejected');
  try { D.restoreBackup('not json'); } catch (e) { threw = threw && true; }

  // diff details for a change inside a longer chapter
  const a = ['1', '2', '3', '4', '5'];
  const ops = D.diffVerses(a, ['1', '2x', '3', '5', '6']);
  ok(JSON.stringify(ops.map((o) => o.t)) === JSON.stringify(['chg', 'del', 'ins']) || ops.length === 3, 'diff ops ' + JSON.stringify(ops));

  if (bad) process.exit(1);
  console.log('data tests passed');
})();
