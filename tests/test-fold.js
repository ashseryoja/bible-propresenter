'use strict';
const path = require('path');
globalThis.AB = {};
require(path.join(__dirname, '..', 'js', 'fold.js'));
const F = globalThis.AB.fold;
let bad = 0;
const eq = (a, b, m) => { if (a !== b) { bad++; console.error('FAIL', m, JSON.stringify(a), '!=', JSON.stringify(b)); } };

// classical and reformed spelling fold to the same string
eq(F.fold('Աստուած'), F.fold('Աստված'), 'Աստուած/Աստված');
eq(F.fold('եւ'), F.fold('և'), 'եւ/և');
eq(F.fold('թագաւոր'), F.fold('թագավոր'), 'թագաւոր/թագավոր');
eq(F.fold('մէջ'), F.fold('մեջ'), 'մէջ/մեջ');
eq(F.fold('մօտ'), F.fold('մոտ'), 'մօտ/մոտ');
eq(F.fold('փրկութիւն'), F.fold('փրկություն'), 'փրկութիւն/փրկություն');
eq(F.fold('Տէրն է իմ հովիւը.').trim(), F.fold('տերն է իմ հովիվը').trim(), 'sentence');
// capitals, marks and punctuation are ignored
eq(F.fold('Ո՞վ է սա։').trim(), F.fold('ով է սա').trim(), 'question mark');
eq(F.fold('օր'), 'օր', 'initial օ stays');
// tokens
eq(JSON.stringify(F.tokens('  Աստուած   սէր ')), JSON.stringify(F.tokens('աստված սեր')), 'tokens');
// ranges map back to the original text
const txt = 'Եւ Աստուած ասեց, Լոյս լինի.';
const r = F.ranges(txt, F.tokens('Աստված'));
eq(r.length, 1, 'one range');
eq(txt.slice(r[0][0], r[0][1]), 'Աստուած', 'range text');
const r2 = F.ranges(txt, F.tokens('և'));
eq(txt.slice(r2[0][0], r2[0][1]), 'Եւ', 'եւ range');
// russian
eq(F.fold('Ёлка'), F.fold('елка'), 'ё');
if (bad) process.exit(1);
console.log('fold tests passed');
