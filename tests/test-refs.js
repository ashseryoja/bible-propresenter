// node tests/test-refs.js — understanding typed references and the Psalm numbering table
'use strict';
const fs = require('fs');
const path = require('path');
globalThis.AB = {};
const root = path.join(__dirname, '..');
new Function(fs.readFileSync(path.join(root, 'data', 'index.js'), 'utf8').replace(/^window\.AB=window\.AB\|\|\{\};/, ''))();   // AB.index
globalThis.window = globalThis;
new Function('AB', fs.readFileSync(path.join(root, 'data', 'index.js'), 'utf8').replace(/^window\.AB=window\.AB\|\|\{\};/, '')).call(globalThis, globalThis.AB);
for (const f of ['fold', 'i18n', 'refs']) require(path.join(root, 'js', f + '.js'));
const AB = globalThis.AB;
AB.Data = { bookMeta: (i) => AB.index.books[i - 1], bookName: (i) => AB.index.books[i - 1].hy };

let bad = 0;
const eq = (name, got, want) => { const ok = JSON.stringify(got) === JSON.stringify(want); if (!ok) { bad++; console.error('FAIL', name, 'got', JSON.stringify(got), 'want', JSON.stringify(want)); } };
const P = (s) => { const r = AB.refs.parse(s); return r && r.ok ? [r.b, r.c, r.v] : r; };

eq('Ин 3:16', P('Ин 3:16'), [43, 3, 16]);
eq('Ин.3:16', P('Ин.3:16'), [43, 3, 16]);
eq('ин 3 16', P('ин 3 16'), [43, 3, 16]);
eq('Иоанна 3', P('Иоанна 3'), [43, 3, 0]);
eq('От Иоанна 3:16', P('От Иоанна 3:16'), [43, 3, 16]);
eq('1 Кор 13', P('1 Кор 13'), [46, 13, 0]);
eq('1кор 13:4', P('1кор 13:4'), [46, 13, 4]);
eq('1 Ин 4:8', P('1 Ин 4:8'), [62, 4, 8]);
eq('Быт 1', P('Быт 1'), [1, 1, 0]);
eq('Бытие 1:3', P('Бытие 1:3'), [1, 1, 3]);
eq('Быт 1:3-5', P('Быт 1:3-5'), [1, 1, 3]);
eq('Откр 22:21', P('Откр 22:21'), [66, 22, 21]);
eq('Иов 1', P('Иов 1'), [18, 1, 0]);
eq('Ис 53', P('Ис 53'), [23, 53, 0]);
eq('Иез 1', P('Иез 1'), [26, 1, 0]);
eq('Деян 2:1', P('Деян 2:1'), [44, 2, 1]);
eq('Псалом 22 (rus numbering) -> 23', P('Псалом 22'), [19, 23, 0]);
eq('Пс 50 -> 51', P('Пс 50'), [19, 51, 0]);
eq('Псалтирь 118 -> 119', P('Псалтирь 118'), [19, 119, 0]);
eq('Սաղմոս 23 (this Bible numbering)', P('Սաղմոս 23'), [19, 23, 0]);
eq('Հով 3:16 (Armenian)', P('Հով 3:16'), [43, 3, 16]);
eq('Յովհաննէս 3:16', P('Յովհաննէս 3:16'), [43, 3, 16]);
eq('Ծննդոց 2', P('Ծննդոց 2'), [1, 2, 0]);
eq('chapter clamp', P('Быт 99'), [1, 50, 0]);
eq('empty', AB.refs.parse('  '), null);
eq('unknown', AB.refs.parse('Абракадабра 3').ok, false);
eq('ambiguous prefix', AB.refs.parse('Ио 3').ok, false);

// Psalm numbering: Hebrew (this Bible) <-> Russian
const toRu = AB.refs.psalmToRu;
eq('1', toRu(1), '1'); eq('8', toRu(8), '8'); eq('9', toRu(9), '9'); eq('10', toRu(10), '9'); eq('11', toRu(11), '10');
eq('23', toRu(23), '22'); eq('51', toRu(51), '50'); eq('113', toRu(113), '112'); eq('114', toRu(114), '113'); eq('115', toRu(115), '113');
eq('116', toRu(116), '114–115'); eq('117', toRu(117), '116'); eq('119', toRu(119), '118'); eq('146', toRu(146), '145'); eq('147', toRu(147), '146–147');
eq('148', toRu(148), '148'); eq('150', toRu(150), '150');
for (let r = 1; r <= 150; r++) {
  const n = AB.refs.psalmFromRu(r);
  const back = toRu(n);
  const inRange = back === String(r) || (back.includes('–') && Number(back.split('–')[0]) <= r && r <= Number(back.split('–')[1])) || (n === 9 && r === 9) ;
  if (!inRange) { bad++; console.error('FAIL psalm round trip', r, n, back); }
}
if (bad) { console.error(bad + ' failures'); process.exit(1); }
console.log('refs tests passed');
