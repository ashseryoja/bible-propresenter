// Node test for the export pipeline: node tests/test-export.js OUT_DIR
// Builds several databases/zips with the same code the website uses and writes them to OUT_DIR;
// tests/validate_db.py then opens them with the real SQLite and checks every table.
'use strict';
const fs = require('fs');
const path = require('path');

globalThis.AB = {};
for (const f of ['sqlite-writer', 'zip', 'exporter']) require(path.join(__dirname, '..', 'js', f + '.js'));
const AB = globalThis.AB;

const out = process.argv[2];
if (!out) { console.error('usage: node tests/test-export.js OUT_DIR'); process.exit(2); }
fs.mkdirSync(out, { recursive: true });

const index = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'json', '../index.js'), 'utf8').replace(/^window\.AB=window\.AB\|\|\{\};AB\.index=/, '').replace(/;\s*$/, ''));
function loadBooks() {
  return index.books.map((b) => ({
    idx: b.i,
    name: b.hy,
    chapters: JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'json', 'b' + String(b.i).padStart(2, '0') + '.json'), 'utf8')),
  }));
}
const clone = (x) => JSON.parse(JSON.stringify(x));
const assert = (c, m) => { if (!c) { console.error('ASSERT FAILED:', m); process.exit(1); } };

(async () => {
  // 1. baseline: unedited text must reproduce the delivered module row for row
  const base = loadBooks();
  let t0 = Date.now();
  const built = AB.exporter.buildModule(base, {});
  console.log('baseline db built in', Date.now() - t0, 'ms;', built.db.length, 'bytes;', JSON.stringify(built.stats));
  fs.writeFileSync(path.join(out, 'baseline.db3'), built.db);
  fs.writeFileSync(path.join(out, 'baseline.xml'), built.xml);
  assert(built.stats.books === 66 && built.stats.chapters === 1189 && built.stats.verses === 31097, 'baseline stats');

  // 2. edited: change text, insert, delete, rename, long verse
  const ed = clone(base);
  ed[18].chapters[22][0] = 'Փորձնական ստուգում. Տէրն է իմ հովիւը։';           // Psalm 23:1
  ed[18].chapters[22].push('Նոր ավելացրած չորրորդ վեց։');                        // extra verse at the end
  ed[0].chapters[0].splice(2, 1);                                                   // delete Genesis 1:3
  ed[43].chapters[0][0] = 'Ա'.repeat(1200);                                        // long verse (2400 bytes)
  ed[5].name = 'Յեսու';
  const built2 = AB.exporter.buildModule(ed, { name: 'Test & "Ararat" <edit>', abbr: 'TST' });
  fs.writeFileSync(path.join(out, 'edited.db3'), built2.db);
  fs.writeFileSync(path.join(out, 'edited.xml'), built2.xml);
  fs.writeFileSync(path.join(out, 'edited.expected.json'), JSON.stringify(ed.map((b) => ({ idx: b.idx, name: b.name, chapters: b.chapters.map((c) => c.map(AB.exporter.cleanText)) }))));
  assert(built2.stats.verses === 31097, 'edited verse count (one added, one removed)');
  assert(built2.xml.includes('Test &amp; &quot;Ararat&quot; &lt;edit&gt;'), 'xml escaping');

  // 3. zip
  t0 = Date.now();
  const z = await AB.exporter.buildZip(base, {}, new Date('2026-10-01T12:00:00Z'));
  console.log('zip built in', Date.now() - t0, 'ms;', z.bytes.length, 'bytes;', z.filename);
  fs.writeFileSync(path.join(out, 'baseline.zip'), z.bytes);

  // 4. validation errors are reported
  const bad = clone(base);
  bad[3].chapters[0][0] = '   ';
  let threw = false;
  try { AB.exporter.buildModule(bad, {}); } catch (e) { threw = true; assert(e.report && e.report.errors[0].code === 'verse-empty', 'error code'); }
  assert(threw, 'empty verse must block the export');
  const bad2 = clone(base);
  bad2[3].chapters[0][0] = 'Ա'.repeat(2500);
  threw = false;
  try { AB.exporter.buildModule(bad2, {}); } catch (e) { threw = true; assert(e.report.errors[0].code === 'verse-long', 'long code'); }
  assert(threw, 'too long verse must block the export');
  const w = AB.exporter.validate(Object.assign(clone(base), {}), {});
  assert(w.errors.length === 0, 'baseline has no errors');

  // 5. tiny synthetic Bible for the writer alone (single-page trees, empty-ish edge cases)
  const tiny = [{ idx: 1, name: 'A', chapters: [['x']] }, { idx: 2, name: 'Բ', chapters: [['a', 'b'], ['c']] }];
  fs.writeFileSync(path.join(out, 'tiny.db3'), AB.sqlite.buildModuleDb(tiny, { name: 'Tiny' }));
  fs.writeFileSync(path.join(out, 'tiny.expected.json'), JSON.stringify(tiny));

  // 6. big synthetic Bible: forces 3-level table trees and multi-level index trees
  const big = [];
  for (let b = 1; b <= 3; b++) {
    const chs = [];
    for (let c = 1; c <= 300; c++) {
      const vs = [];
      for (let v = 1; v <= 120; v++) vs.push('Book ' + b + ' chapter ' + c + ' verse ' + v + ' ' + 'x'.repeat((v * 7 + c) % 300));
      chs.push(vs);
    }
    big.push({ idx: b, name: 'Big ' + b, chapters: chs });
  }
  fs.writeFileSync(path.join(out, 'big.db3'), AB.sqlite.buildModuleDb(big, { name: 'Big' }));
  fs.writeFileSync(path.join(out, 'big.expected.json'), JSON.stringify(big));
  console.log('all node checks passed');
})();
