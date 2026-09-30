/*
 * Interface strings. The Russian text itself is the key: t('Править') returns the Russian string unless a
 * dictionary for the chosen language has a translation. An Armenian interface is added later with
 * AB.i18n.addDict('hy', {'Править': 'Խմբագրել', ...}) and AB.i18n.setLang('hy'); nothing else has to change.
 */
(function () {
  'use strict';
  const AB = (globalThis.AB = globalThis.AB || {});

  const dicts = {};
  let lang = 'ru';

  function t(s, params) {
    const d = dicts[lang];
    let out = (d && d[s]) || s;
    if (params) out = out.replace(/\{(\w+)\}/g, (m, k) => (params[k] != null ? params[k] : m));
    return out;
  }

  /** Russian plural: pl(5, 'стих', 'стиха', 'стихов') -> 'стихов'. */
  function pl(n, one, few, many) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return many;
    if (b > 1 && b < 5) return few;
    if (b === 1) return one;
    return many;
  }
  const num = (n, one, few, many) => n + ' ' + pl(n, one, few, many);

  AB.i18n = {
    t, pl, num,
    addDict(l, d) { dicts[l] = Object.assign(dicts[l] || {}, d); },
    setLang(l) { lang = l; },
    get lang() { return lang; },
  };
  AB.t = t;
})();
