/*
 * Search and replace, "Changes and export" (the main download button lives here), book names, help.
 */
(function () {
  'use strict';
  const AB = (globalThis.AB = globalThis.AB || {});
  const { h, icon, clear, highlight } = AB.ui;
  const { t, num } = AB.i18n;
  const D = () => AB.Data;
  const app = () => AB.app;

  const fmtInt = (n) => Number(n).toLocaleString('ru-RU');
  const fmtSize = (bytes) => (bytes / 1048576).toFixed(1).replace('.', ',') + '\u00a0' + t('МБ');
  const stamp = () => new Date().toISOString().slice(0, 10);
  const bookRu = (b) => AB.index.books[b - 1].ab;

  function refNode(b, c, v) {
    return h('span.hit-ref', h('span.hit-ru', bookRu(b) + ' ' + c + ':' + v), h('span.hit-hy', { lang: 'hy' }, D().bookName(b) + ' ' + c + ':' + v));
  }

  /** Cuts a long verse around the first highlighted place. Returns the DOM for it. */
  function snippet(text, ranges, max) {
    max = max || 210;
    if (text.length <= max) return highlight(text, ranges);
    const first = ranges.length ? ranges[0][0] : 0;
    let from = Math.max(0, first - 60);
    if (from > 0) { const sp = text.indexOf(' ', from); if (sp > 0 && sp < first) from = sp + 1; }
    let to = Math.min(text.length, from + max);
    if (to < text.length) { const sp = text.lastIndexOf(' ', to); if (sp > from + 40) to = sp; }
    const f = document.createDocumentFragment();
    if (from > 0) f.appendChild(document.createTextNode('\u2026'));
    f.appendChild(highlight(text, ranges, from, to));
    if (to < text.length) f.appendChild(document.createTextNode('\u2026'));
    return f;
  }

  function literalRanges(text, needle) {
    const out = [];
    if (!needle) return out;
    let pos = 0;
    while ((pos = text.indexOf(needle, pos)) >= 0) { out.push([pos, pos + needle.length]); pos += needle.length; }
    return out;
  }

  /** Marks the part that differs between two versions of a verse. */
  function inlineDiff(a, b) {
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    const mk = (txt) => {
      const f = document.createDocumentFragment();
      const mid = txt.slice(p, txt.length - s);
      let start = 0;
      if (p > 40) { start = txt.lastIndexOf(' ', p - 20); if (start < 0) start = 0; }
      if (start > 0) f.appendChild(document.createTextNode('\u2026'));
      f.appendChild(document.createTextNode(txt.slice(start, p)));
      if (mid) f.appendChild(h('mark', mid));
      f.appendChild(document.createTextNode(txt.slice(txt.length - s)));
      return f;
    };
    return { a: mk(a), b: mk(b) };
  }

  function loadingNote(sheetBody) {
    const bar = h('div.progress', h('span.progress-fill'));
    const label = h('p.load-label', t('Загружаю текст Библии…'));
    const box = h('div.loading', label, bar);
    sheetBody.insertBefore(box, sheetBody.children[1] || null);
    return {
      box,
      set(done, n) { label.textContent = t('Загружаю текст Библии… {d} из {n}', { d: done, n }); bar.firstChild.style.width = Math.round((done / n) * 100) + '%'; },
      remove() { box.remove(); },
    };
  }

  // ---- search and replace ----------------------------------------------------------------------------------------

  function openSearch(o) {
    o = o || {};
    let mode = o.replace ? 'replace' : 'search';
    let scope = 'all';
    let shown = 40;
    let last = { hits: [], toks: [] };
    let timer = null;

    const tabSearch = h('button.seg-btn', { type: 'button', role: 'tab', id: 'tab-search', onclick: () => setMode('search') }, icon('search'), t('Поиск'));
    const tabRepl = h('button.seg-btn', { type: 'button', role: 'tab', id: 'tab-replace', onclick: () => setMode('replace') }, icon('pencil'), t('Замена'));
    const tabs = h('div.seg', { role: 'tablist', 'aria-label': t('Режим') }, tabSearch, tabRepl);

    // search panel
    const input = h('input.field', { type: 'search', id: 'search-q', placeholder: t('Слово или часть слова'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'search', lang: 'hy', 'aria-label': t('Что искать') });
    const scopeAll = h('button.seg-btn.small', { type: 'button', onclick: () => setScope('all') }, t('Вся Библия'));
    const scopeBook = h('button.seg-btn.small', { type: 'button', onclick: () => setScope('book') }, '');
    const scopeSeg = h('div.seg.small', { role: 'group', 'aria-label': t('Где искать') }, scopeAll, scopeBook);
    const results = h('div.results');
    const jump = h('div.jump');
    const searchPanel = h('div.panel', h('div.search-top', input, scopeSeg), jump, results);

    // replace panel
    const findIn = h('input.field', { type: 'text', id: 'repl-find', placeholder: t('Что заменить'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', lang: 'hy', 'aria-label': t('Что заменить') });
    const replIn = h('input.field', { type: 'text', id: 'repl-with', placeholder: t('На что заменить (можно пусто)'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', lang: 'hy', 'aria-label': t('На что заменить') });
    const replInfo = h('p.repl-info');
    const replList = h('div.results');
    const replAction = h('div.repl-action');
    const replPanel = h('div.panel', h('p.muted', t('Ищет точное совпадение: с учётом регистра и старой орфографии. Перед заменой покажу все места.')),
      h('label.lbl', { for: 'repl-find' }, t('Найти')), findIn, h('label.lbl', { for: 'repl-with' }, t('Заменить на')), replIn, replInfo, replAction, replList);

    const body = h('div.searchbody', tabs, searchPanel, replPanel);
    const sheet = AB.ui.openSheet({ title: t('Поиск'), className: 'tall', body, focus: () => input });
    const loader = D().allLoaded() ? null : loadingNote(body);
    if (loader) {
      app().loadAll((d, n) => loader.set(d, n)).then(() => { loader.remove(); refreshAll(); }).catch(() => { loader.remove(); AB.ui.toast(t('Не удалось загрузить весь текст. Проверьте соединение.'), { kind: 'error' }); });
    }

    function setMode(m) {
      mode = m;
      tabSearch.setAttribute('aria-selected', String(m === 'search'));
      tabRepl.setAttribute('aria-selected', String(m === 'replace'));
      tabSearch.classList.toggle('on', m === 'search');
      tabRepl.classList.toggle('on', m === 'replace');
      searchPanel.hidden = m !== 'search';
      replPanel.hidden = m !== 'replace';
      sheet.setTitle(m === 'search' ? t('Поиск') : t('Найти и заменить'));
      (m === 'search' ? input : findIn).focus();
    }
    function setScope(s) {
      scope = s;
      scopeAll.classList.toggle('on', s === 'all');
      scopeBook.classList.toggle('on', s === 'book');
      scopeAll.setAttribute('aria-pressed', String(s === 'all'));
      scopeBook.setAttribute('aria-pressed', String(s === 'book'));
      shown = 40;
      runSearch();
    }
    scopeBook.textContent = t('Эта книга') + ': ' + bookRu(app().state.b);

    function hitButton(b, c, v, text, ranges) {
      return h('button.hit', { type: 'button', onclick: () => { sheet.close(); app().goTo(b, c, v, { select: true, flash: true }); } },
        refNode(b, c, v), h('span.hit-text', { lang: 'hy' }, snippet(text, ranges)));
    }

    function runSearch() {
      clear(results); clear(jump);
      const q = input.value.trim();
      if (!q) { results.appendChild(h('p.empty', t('Введите слово или часть слова. Орфография не важна: «Աստուած» найдёт и «Աստված».'))); return; }
      const r = AB.refs.parse(q);
      if (r && r.ok && r.hasChapter) {
        jump.appendChild(h('button.hit.jumpto', { type: 'button', onclick: () => { sheet.close(); app().goTo(r.b, r.c, r.v || 0, { select: !!r.v, flash: !!r.v }); } },
          icon('arrowRight'), h('span', t('Перейти: '), h('strong', D().bookName(r.b) + ' ' + r.c + (r.v ? ':' + r.v : '')), r.note ? ' \u00b7 ' + r.note : '')));
      }
      if (!D().allLoaded() && scope === 'all') { results.appendChild(h('p.empty', t('Текст ещё загружается, поиск начнётся сразу после этого.'))); return; }
      const res = D().search(q, scope === 'book' ? { book: app().state.b } : null);
      last = res;
      if (!res.toks.length) { results.appendChild(h('p.empty', t('Введите хотя бы одну букву.'))); return; }
      if (!res.hits.length) { results.appendChild(h('p.empty', t('Ничего не найдено.') + (scope === 'book' ? ' ' + t('Попробуйте искать по всей Библии.') : ''))); return; }
      results.appendChild(h('p.count', { role: 'status' }, num(res.hits.length, 'стих', 'стиха', 'стихов')));
      for (const hit of res.hits.slice(0, shown)) {
        const text = D().verses(hit.b, hit.c)[hit.v - 1];
        results.appendChild(hitButton(hit.b, hit.c, hit.v, text, AB.fold.ranges(text, res.toks)));
      }
      if (res.hits.length > shown) {
        results.appendChild(h('button.btn.wide', { type: 'button', onclick: () => { shown += 60; runSearch(); } }, t('Показать ещё {n}', { n: Math.min(60, res.hits.length - shown) })));
      }
    }

    // replace ----------------------------------------------------------------------------------------------------
    function runReplace() {
      clear(replList); clear(replAction);
      const needle = findIn.value;
      const repl = replIn.value;
      replInfo.textContent = '';
      if (!needle) { replInfo.textContent = t('Введите, что заменить.'); return; }
      if (!D().allLoaded()) { replInfo.textContent = t('Текст ещё загружается.'); return; }
      const hits = D().findLiteral(needle);
      if (!hits.length) { replInfo.textContent = t('Точных совпадений нет. Проверьте регистр и написание.'); return; }
      let total = 0;
      for (const hit of hits) total += D().verses(hit.b, hit.c)[hit.v - 1].split(needle).length - 1;
      replInfo.textContent = t('Найдено: {a} в {b}.', { a: num(total, 'раз', 'раза', 'раз'), b: num(hits.length, 'стихе', 'стихах', 'стихах') });
      replAction.appendChild(AB.ui.confirmButton('.btn.primary.wide', t('Заменить везде'), t('Нажмите ещё раз: заменить {n}', { n: total }), () => {
        const res = D().replaceLiteral(needle, repl);
        if (res.error === 'empty') { AB.ui.toast(t('Замена оставила бы стих пустым — ничего не изменено.'), { kind: 'warn' }); return; }
        app().afterEdit(t('Заменено: {n}', { n: num(res.count, 'раз', 'раза', 'раз') }));
        runReplace();
      }, 'check'));
      for (const hit of hits.slice(0, 30)) {
        const text = D().verses(hit.b, hit.c)[hit.v - 1];
        const after = text.split(needle).join(repl);
        replList.appendChild(h('button.hit', { type: 'button', onclick: () => { sheet.close(); app().goTo(hit.b, hit.c, hit.v, { select: true, flash: true }); } },
          refNode(hit.b, hit.c, hit.v),
          h('span.hit-text.was', { lang: 'hy' }, snippet(text, literalRanges(text, needle))),
          h('span.hit-text.will', { lang: 'hy' }, snippet(after, repl ? literalRanges(after, repl) : []))));
      }
      if (hits.length > 30) replList.appendChild(h('p.muted', t('Показаны первые 30 из {n}.', { n: hits.length })));
    }

    function refreshAll() { if (mode === 'search') runSearch(); else runReplace(); }

    input.addEventListener('input', () => { clearTimeout(timer); shown = 40; timer = setTimeout(runSearch, 220); });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const r = AB.refs.parse(input.value);
      if (r && r.ok && r.hasChapter) { sheet.close(); app().goTo(r.b, r.c, r.v || 0, { select: !!r.v, flash: !!r.v }); }
      else { clearTimeout(timer); runSearch(); input.blur(); }
    });
    findIn.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runReplace, 250); });
    replIn.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(runReplace, 250); });

    setScope('all');
    setMode(mode);
    if (o.query) { input.value = o.query; runSearch(); }
    return sheet;
  }

  // ---- changes and export ----------------------------------------------------------------------------------------

  function effectiveMeta() {
    return Object.assign({}, AB.exporter.DEFAULT_META, pick(D().getMeta(), ['name', 'abbr', 'slotAbbr']));
  }
  function pick(o, keys) { const r = {}; for (const k of keys) if (o && typeof o[k] === 'string' && o[k].trim()) r[k] = o[k]; return r; }

  /** Before/after rows for a list of diff operations (see Data.diffVerses). */
  function diffRows(ops, before, after) {
    const box = h('div.diff');
    let n = 0;
    for (const op of ops) {
      if (++n > 40) { box.appendChild(h('p.muted', t('…и ещё {n}', { n: ops.length - 40 }))); break; }
      if (op.t === 'chg') {
        const d = inlineDiff(before[op.a], after[op.b]);
        box.appendChild(h('div.d-row', h('span.d-num', String(op.b + 1)), h('div.d-cols', { lang: 'hy' }, h('p.d-old', h('span.d-tag', t('было')), d.a), h('p.d-new', h('span.d-tag', t('стало')), d.b))));
      } else if (op.t === 'ins') {
        box.appendChild(h('div.d-row', h('span.d-num', String(op.b + 1)), h('div.d-cols', { lang: 'hy' }, h('p.d-new', h('span.d-tag', t('добавлен')), after[op.b]))));
      } else {
        box.appendChild(h('div.d-row', h('span.d-num.del', '\u2013'), h('div.d-cols', { lang: 'hy' }, h('p.d-old', h('span.d-tag', t('удалён (был {n})', { n: op.a + 1 })), before[op.a]))));
      }
    }
    return box;
  }

  function syncLabel(state) {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return t('Нет связи: правки отправятся позже.');
    return ({ saving: t('Сохраняю…'), saved: t('Всё сохранено.'), error: t('Не удалось сохранить.'), locked: t('Правки закрыты.'), denied: t('Сервер не принял правку.') })[state] || '';
  }

  function storageNote() {
    const s = D().store;
    if (!s) return null;
    if (s.kind === 'shared') return { kind: 'ok', shared: true, text: t('Правки общие: их сразу видят все, кто открывает сайт. Каждая версия главы сохраняется в истории.') };
    if (s.kind === 'cloud') return { kind: 'ok', text: t('Правки сохраняются в вашем аккаунте Claude и доступны на других устройствах.') };
    if (s.persistent) return { kind: 'ok', text: t('Правки сохраняются в этом браузере. Чтобы перенести их на другой компьютер, сохраните копию правок ниже.') };
    return { kind: 'warn', text: t('Браузер не разрешает сохранять правки надолго. Сохраните копию правок ниже, чтобы не потерять работу.') };
  }

  function installSteps() {
    return h('ol.steps',
      h('li', t('Распакуйте скачанный архив.')),
      h('li', t('Закройте ProPresenter.')),
      h('li', t('Найдите папку установленной Библии «A Conservative Version» (ACV): C:\\ProgramData\\RenewedVision\\ProPresenter\\Bibles\\… (её имя записано в файле BibleData.proPref рядом).')),
      h('li', t('Замените в ней файлы bible.db3 и rvmetadata.xml файлами из архива. Старые лучше сначала сохранить.')),
      h('li', t('Откройте ProPresenter: в списке Библий появится ваша Библия.')),
      h('p.muted', t('Подробная инструкция есть в файле README.txt внутри архива.')));
  }

  function openChanges(focus) {
    const body = h('div.changes');
    const statusBox = h('div.export-status');
    statusBox.hidden = true;
    const btnLabel = h('span', t('Скачать для ProPresenter (.zip)'));
    const mainBtn = h('button.btn.primary.wide.big', { type: 'button', onclick: () => doExport() }, icon('download'), btnLabel);
    const footHint = h('p.foot-hint');
    const foot = h('div.foot-col', footHint, mainBtn);
    let busy = false;
    let off = () => {};
    let syncEl = null;
    const onSync = (st) => { if (syncEl) syncEl.textContent = ' ' + syncLabel(st); };
    app().syncListeners.add(onSync);
    const sheet = AB.ui.openSheet({ title: t('Правки и экспорт'), className: 'tall', body, footer: foot, onClose: () => { off(); app().syncListeners.delete(onSync); } });
    off = D().onChange((e) => {
      if (busy || sheet.closed) return;
      // typing in the export fields must not redraw them under the cursor
      if (e && e.type === 'meta' && body.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
      renderBody();
    });

    function setStatus(kind, content) {
      clear(statusBox);
      statusBox.className = 'export-status ' + kind;
      statusBox.hidden = !content;
      if (content) statusBox.appendChild(content);
      if (!statusBox.hidden) statusBox.scrollIntoView({ block: 'nearest' });
    }

    function issueList(items, limit) {
      const ul = h('ul.issues');
      for (const it of items.slice(0, limit || 8)) {
        const li = h('li', h('span', it.text));
        if (it.book && it.chapter) li.appendChild(h('button.btn.compact.quiet', { type: 'button', onclick: () => { sheet.close(); app().goTo(it.book, it.chapter, it.verse || 0, { select: !!it.verse, flash: !!it.verse }); } }, t('Открыть')));
        ul.appendChild(li);
      }
      if (items.length > (limit || 8)) ul.appendChild(h('li.muted', t('…и ещё {n}', { n: items.length - (limit || 8) })));
      return ul;
    }

    async function doExport() {
      if (busy) return;
      busy = true;
      mainBtn.disabled = true;
      const meta = effectiveMeta();
      try {
        setStatus('busy', h('p', h('span.spinner'), t('Загружаю текст Библии…')));
        await app().loadAll((d, n) => setStatus('busy', h('p', h('span.spinner'), t('Загружаю текст Библии… {d} из {n}', { d, n }))));
        setStatus('busy', h('p', h('span.spinner'), t('Проверяю текст…')));
        await AB.ui.tick();
        const books = D().exportBooks();
        const rep = AB.exporter.validate(books, meta);
        if (rep.errors.length) {
          setStatus('error', h('div', h('p', h('strong', t('Файл не создан: нужно исправить {n}.', { n: num(rep.errors.length, 'ошибку', 'ошибки', 'ошибок') }))), issueList(rep.errors)));
          return;
        }
        setStatus('busy', h('p', h('span.spinner'), t('Собираю файлы…')));
        await AB.ui.tick();
        const z = await AB.exporter.buildZip(books, meta);
        const res = await AB.platform.saveFile(z.filename, z.bytes, 'application/zip');
        if (res.status === 'declined') { setStatus('warn', h('p', t('Скачивание отменено. Файл не сохранён — нажмите кнопку ещё раз, когда будете готовы.'))); return; }
        if (res.status === 'attempted') {
          setStatus('warn', h('p', t('Похоже, во встроенном просмотре скачать файл нельзя. Откройте страницу в отдельной вкладке браузера и нажмите кнопку там.')));
          return;
        }
        D().setMeta({ exportedAt: new Date().toISOString() });
        const done = h('div',
          h('p.ok-line', icon('check'), h('strong', t('Файл готов: ')), z.filename),
          h('p.muted', t('{b} книг, {c} глав, {v} стихов · {s}', { b: z.stats.books, c: fmtInt(z.stats.chapters), v: fmtInt(z.stats.verses), s: fmtSize(z.bytes.length) })),
          rep.warnings.length ? h('div', h('p', icon('warn'), t(' Предупреждения ({n}): текст скачан, но проверьте эти места.', { n: rep.warnings.length })), issueList(rep.warnings, 6)) : null,
          h('h3.steps-h', t('Как установить в ProPresenter')), installSteps());
        setStatus('ok', done);
        btnLabel.textContent = t('Скачать ещё раз');
      } catch (e) {
        console.error(e);
        setStatus('error', h('p', h('strong', t('Не получилось создать файл. ')), (e && e.message) || ''));
      } finally {
        busy = false;
        mainBtn.disabled = false;
      }
    }

    function renderBody() {
      clear(body);
      const sum = D().summary();
      const renamed = sum.bookNames.length;
      const meta = effectiveMeta();

      body.appendChild(statusBox);

      // summary
      if (!sum.touched && !renamed) {
        body.appendChild(h('section.card.empty-card', h('h3', t('Правок пока нет')),
          h('p', t('Нажмите на любой стих и выберите «Править». Здесь появится список изменений.')),
          h('p.muted', t('Скачать Библию можно и без правок: получится тот же модуль, что вы уже получили.'))));
        footHint.textContent = '';
      } else {
        const chips = h('div.chips');
        if (sum.changed) chips.appendChild(h('span.chip.edit', num(sum.changed, 'изменён', 'изменено', 'изменено')));
        if (sum.inserted) chips.appendChild(h('span.chip.add', num(sum.inserted, 'добавлен', 'добавлено', 'добавлено')));
        if (sum.deleted) chips.appendChild(h('span.chip.del', num(sum.deleted, 'удалён', 'удалено', 'удалено')));
        if (renamed) chips.appendChild(h('span.chip', t('переименовано книг: {n}', { n: renamed })));
        body.appendChild(h('section.card', h('h3', (app().shared ? t('В общей версии изменено: {a} в {b}') : t('Изменено: {a} в {b}')).replace('{a}', num(sum.touched, 'стих', 'стиха', 'стихов')).replace('{b}', num(sum.chapters, 'главе', 'главах', 'главах'))), chips));
        footHint.textContent = t('В файл войдут все {n} правок.', { n: sum.touched + renamed });
      }
      const sn = storageNote();
      syncEl = sn && sn.shared ? h('strong.sync', ' ' + syncLabel(app().sync)) : null;
      if (sn) body.appendChild(h('p.storage-note.' + sn.kind, icon(sn.kind === 'ok' ? 'check' : 'warn'), h('span', sn.text, syncEl)));

      // list of changes
      if (sum.list.length) {
        body.appendChild(h('h3.sec', t('Что изменено')));
        const list = h('div.chg-list');
        const at = focus ? sum.list.findIndex((x) => x.b === focus.b && x.c === focus.c) : -1;
        const LIMIT = at >= 120 ? sum.list.length : 120;
        const show = (from, to) => { for (const item of sum.list.slice(from, to)) list.appendChild(chapterChange(item, focus && focus.b === item.b && focus.c === item.c)); };
        show(0, LIMIT);
        body.appendChild(list);
        if (sum.list.length > LIMIT) {
          const more = h('button.btn.wide', { type: 'button', onclick: () => { show(LIMIT, sum.list.length); more.remove(); } }, t('Показать все главы ({n})', { n: sum.list.length }));
          body.appendChild(more);
        }
      }
      if (renamed) {
        const box = h('div.chg-names');
        for (const r of sum.bookNames) box.appendChild(h('p', h('span.muted', bookRu(r.i) + ': '), h('span', { lang: 'hy' }, AB.index.books[r.i - 1].hy + ' \u2192 ' + r.name)));
        body.appendChild(h('section.card', h('h3', t('Названия книг')), box));
      }

      // export options
      const nameIn = h('input.field', { id: 'x-name', value: meta.name, autocomplete: 'off', spellcheck: 'false' });
      const abbrIn = h('input.field', { id: 'x-abbr', value: meta.abbr, autocomplete: 'off', spellcheck: 'false', maxlength: '12' });
      const slotIn = h('input.field', { id: 'x-slot', value: meta.slotAbbr, autocomplete: 'off', spellcheck: 'false', readonly: true, maxlength: '12' });
      const unlock = h('button.btn.compact.quiet', { type: 'button', onclick: () => { slotIn.readOnly = false; slotIn.focus(); unlock.hidden = true; } }, t('Изменить'));
      const save = (k, el) => el.addEventListener('change', () => { const val = el.value.trim(); D().setMeta({ [k]: val }); });
      save('name', nameIn); save('abbr', abbrIn); save('slotAbbr', slotIn);
      body.appendChild(h('details.opt', h('summary', icon('type'), t('Параметры экспорта')),
        h('div.opt-body',
          h('label.lbl', { for: 'x-name' }, t('Название Библии в ProPresenter')), nameIn,
          h('label.lbl', { for: 'x-abbr' }, t('Сокращение (латиницей)')), abbrIn,
          h('label.lbl', { for: 'x-slot' }, t('Сокращение заменяемой Библии')), h('div.row', slotIn, unlock),
          h('p.muted', t('Оставьте ACV: модуль подменяет файлы установленной Библии «A Conservative Version».')))));

      // backup, names, reset
      const fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true, id: 'backup-file' });
      fileIn.addEventListener('change', async () => {
        const f = fileIn.files && fileIn.files[0];
        fileIn.value = '';
        if (!f) return;
        try {
          const text = await AB.platform.readFileText(f);
          await app().loadAll();
          const r = D().restoreBackup(text);
          app().afterEdit(r.chapters ? t('Загружено глав с правками: {n}', { n: r.chapters }) + (r.skipped ? t(' (пропущено: {n})', { n: r.skipped }) : '') : t('В файле нет правок'));
        } catch (e) { AB.ui.toast(e.message || t('Не удалось прочитать файл.'), { kind: 'error' }); }
      });
      body.appendChild(h('section.card.tools',
        h('h3', t('Копия правок')),
        h('p.muted', app().shared
          ? t('Файл со всеми правками общей версии. Загрузка такого файла заменит главы в общей версии для всех.')
          : t('Небольшой файл только с вашими правками. Пригодится, чтобы не потерять работу или продолжить на другом компьютере.')),
        h('div.btn-row',
          h('button.btn', { type: 'button', onclick: async () => {
            try {
              const r = await AB.platform.saveFile('ararat-edits-' + stamp() + '.json', new TextEncoder().encode(D().backupJson()), 'application/json');
              if (r.status === 'saved') AB.ui.toast(t('Копия правок сохранена'), { kind: 'ok' });
              else if (r.status === 'attempted') AB.ui.toast(t('Здесь скачать файл нельзя. Откройте страницу в отдельной вкладке.'), { kind: 'warn' });
            } catch (e) { AB.ui.toast(e.message || t('Не удалось сохранить файл'), { kind: 'error' }); }
          } }, icon('save'), t('Сохранить копию')),
          h('button.btn', { type: 'button', onclick: () => fileIn.click() }, icon('upload'), t('Загрузить копию')), fileIn)));

      body.appendChild(h('section.card.tools',
        h('div.btn-row',
          h('button.btn', { type: 'button', onclick: () => openNames() }, icon('languages'), t('Названия книг')),
          !app().shared && (sum.touched || renamed) ? AB.ui.confirmButton('.btn.danger', t('Сбросить все правки'), t('Точно сбросить?'), () => {
            const n = D().revertAll();
            const m = D().getMeta();
            if (m.bookNames && Object.keys(m.bookNames).length) D().setMeta({ bookNames: {} });
            app().afterEdit(n || renamed ? t('Все правки сброшены') : t('Нечего сбрасывать'));
          }, 'reset') : null)));
    }

    function chapterChange(item, open) {
      const parts = [];
      if (item.changed) parts.push(num(item.changed, 'изменён', 'изменено', 'изменено'));
      if (item.inserted) parts.push(num(item.inserted, 'добавлен', 'добавлено', 'добавлено'));
      if (item.deleted) parts.push(num(item.deleted, 'удалён', 'удалено', 'удалено'));
      const det = h('details.chg', { open: open ? '' : null },
        h('summary', h('span.chg-ref', h('span', D().bookName(item.b) + ' ' + item.c), h('span.chg-ru', bookRu(item.b) + ' ' + item.c)), h('span.chg-sum', parts.join(' \u00b7 '))));
      let built = false;
      const buildBody = () => {
      built = true;
      const box = h('div.chg-body', diffRows(item.ops, D().baseVerses(item.b, item.c), D().verses(item.b, item.c)));
      box.appendChild(h('div.btn-row',
        h('button.btn.compact', { type: 'button', onclick: () => { sheet.close(); app().goTo(item.b, item.c, 0); } }, icon('book'), t('Открыть главу')),
        AB.ui.confirmButton('.btn.compact.danger', t('Вернуть главу'), t('Точно вернуть?'), () => { if (D().revertChapter(item.b, item.c)) app().afterEdit(t('Глава возвращена')); }, 'reset')));
      det.appendChild(box);
      };
      // the before/after text is built when a chapter is opened, so a list of hundreds of chapters stays light
      det.addEventListener('toggle', () => { if (det.open && !built) buildBody(); });
      if (open) { buildBody(); setTimeout(() => det.scrollIntoView({ block: 'center' }), 60); }
      return det;
    }

    renderBody();
    app().editedLoaded.then(() => { if (!sheet.closed && !busy) renderBody(); });
    return sheet;
  }

  // ---- history of a chapter (shared version) ---------------------------------------------------------------------

  function openHistory(b, c) {
    const status = h('p.muted', h('span.spinner'), t('Загружаю историю…'));
    const list = h('div.hist-list');
    const body = h('div.history', h('p.muted', t('Здесь сохраняются все версии этой главы: кто и когда её менял. Восстановление создаёт новую версию, старые остаются.')), status, list);
    const sheet = AB.ui.openSheet({ title: t('История главы'), subtitle: D().bookName(b) + ' ' + c, className: 'tall', body });

    function restore(verses) {
      D().setChapter(b, c, verses, 'восстановление версии');
      sheet.close();
      app().afterEdit(t('Версия восстановлена'));
    }

    function render(entries) {
      const base = D().baseVerses(b, c);
      const cur = D().verses(b, c);
      const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);
      if (!entries.length) list.appendChild(h('p.empty', t('Сохранённых версий пока нет. Здесь появятся правки, сделанные в общей версии.')));
      entries.forEach((en, i) => {
        const before = i + 1 < entries.length ? (entries[i + 1].verses || base) : base;
        const after = en.verses || base;
        const ops = D().diffVerses(before, after);
        const parts = [];
        const cnt = (k) => ops.filter((o) => o.t === k).length;
        if (en.verses === null) parts.push(t('возврат к исходному тексту'));
        else {
          if (cnt('chg')) parts.push(num(cnt('chg'), 'изменён', 'изменено', 'изменено'));
          if (cnt('ins')) parts.push(num(cnt('ins'), 'добавлен', 'добавлено', 'добавлено'));
          if (cnt('del')) parts.push(num(cnt('del'), 'удалён', 'удалено', 'удалено'));
        }
        const isCurrent = same(after, cur);
        const when = en.t ? new Date(en.t).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : t('только что');
        const det = h('details.chg', h('summary',
          h('span.chg-ref', h('span', when), h('span.chg-ru', en.by || t('Аноним'))),
          h('span.chg-sum', (isCurrent ? t('сейчас · ') : '') + (parts.join(' \u00b7 ') || t('без изменений')))));
        let built = false;
        det.addEventListener('toggle', () => {
          if (!det.open || built) return;
          built = true;
          det.appendChild(h('div.chg-body', diffRows(ops, before, after),
            h('div.btn-row', isCurrent ? h('p.muted', t('Эта версия сейчас в главе.')) : AB.ui.confirmButton('.btn.compact', t('Восстановить эту версию'), t('Точно восстановить?'), () => restore(en.verses), 'reset'))));
        });
        list.appendChild(det);
      });
      // the text of the module itself
      const orig = h('div.card', h('h3', t('Исходный текст')), h('p.muted', t('Как в модуле, с которого всё началось.')),
        D().isEdited(b, c) ? h('div.btn-row', AB.ui.confirmButton('.btn.compact', t('Вернуть исходный текст'), t('Точно вернуть?'), () => restore(null), 'reset')) : h('p.muted', t('Сейчас в главе исходный текст.')));
      list.appendChild(orig);
    }

    D().history(b, c, 40).then((entries) => { status.remove(); render(entries); }, () => { status.textContent = t('Не удалось загрузить историю. Проверьте соединение.'); });
    return sheet;
  }

  // ---- book names ------------------------------------------------------------------------------------------------

  function openNames() {
    const body = h('div.names', h('p.muted', t('Эти названия увидите в списке книг ProPresenter. Оставьте пустым, чтобы вернуть прежнее.')));
    const list = h('div.nm-list');
    for (const bm of AB.index.books) {
      const id = 'nm-' + bm.i;
      const input = h('input.field', { id, lang: 'hy', value: D().bookName(bm.i), placeholder: bm.hy, autocomplete: 'off', spellcheck: 'false', autocapitalize: 'off' });
      const reset = h('button.icon-btn.small', { type: 'button', 'aria-label': t('Вернуть название «{n}»', { n: bm.hy }), onclick: () => { D().setBookName(bm.i, ''); input.value = bm.hy; mark(); } }, icon('reset'));
      const mark = () => { const changed = D().bookName(bm.i) !== bm.hy; row.classList.toggle('changed', changed); reset.hidden = !changed; };
      const row = h('div.nm-row', h('label.nm-ru', { for: id }, bm.ru), input, reset);
      input.addEventListener('change', () => { D().setBookName(bm.i, input.value); input.value = D().bookName(bm.i); mark(); });
      mark();
      list.appendChild(row);
    }
    body.appendChild(list);
    return AB.ui.openSheet({ title: t('Названия книг'), className: 'tall', body });
  }

  // ---- help ------------------------------------------------------------------------------------------------------

  function openHelp() {
    const psalms = [['1\u20138', '1\u20138'], ['9\u201310', '9'], ['11\u2013113', '10\u2013112'], ['114\u2013115', '113'], ['116', '114\u2013115'], ['117\u2013146', '116\u2013145'], ['147', '146\u2013147'], ['148\u2013150', '148\u2013150']];
    const table = h('table.tbl', h('thead', h('tr', h('th', t('Здесь')), h('th', t('В русской Библии')))), h('tbody', psalms.map((r) => h('tr', h('td', r[0]), h('td', r[1])))));
    const body = h('div.help',
      h('h3', t('Как пользоваться')),
      h('ul', h('li', t('Название сверху открывает список книг и глав. Можно набрать ссылку: «Ин 3:16», «Быт 1», «Հով 3:16».')),
        h('li', t('Нажмите на стих: появятся «Править», «Копировать» и «Ещё».')),
        h('li', t('В редакторе можно разделить стих, объединить, вставить новый, удалить или перенести в соседнюю главу.')),
        h('li', t('После каждой правки внизу есть кнопка «Отменить».')),
        h('li', t('Изменённые стихи отмечены оранжевой полоской. Полный список — в «Правки и экспорт».')),
        h('li', t('Поиск не зависит от орфографии: «Աստված» найдёт и «Աստուած».')),
        h('li', t('Внизу главы (и галочкой в шапке) главу можно отметить как полностью просмотренную: в списке глав появится зелёная галочка. Жёлтая точка там же значит «есть правки».'))),
      app().shared ? h('h3', t('Общая версия')) : null,
      app().shared ? h('p', t('Правки общие: любой, кто открыл сайт, видит текст со всеми изменениями и может править. У каждой главы есть «История»: там видно, кто и когда менял, и можно восстановить любую версию. Имя для истории задаётся в меню «⋯».')) : null,
      h('h3', t('Как получить Библию для ProPresenter')),
      h('p', t('Значок с файлом вверху → кнопка «Скачать для ProPresenter (.zip)». В архиве два файла для ProPresenter и инструкция.')), installSteps(),
      h('h3', t('О тексте')),
      h('p', t('Текст из файла ArmBible-ՓՈՐՁ.spb («Աստվածաշունչ»), новая орфография. 66 книг, 1189 глав, 31 098 стихов. Слова не менялись; исправлены только знаки, набранные латиницей (` → ՝, ´ → ՛, : → ։), и убраны пометки сносок.')),
      h('h3', t('Нумерация псалмов')),
      h('p', t('Здесь Псалмы пронумерованы как в армянской Библии (по-еврейски). В русской Библии нумерация другая:')), h('div.tbl-wrap', table),
      h('h3', t('Клавиши на компьютере')),
      h('ul', h('li', h('kbd', '/'), t(' — поиск')), h('li', h('kbd', '\u2190'), ' ', h('kbd', '\u2192'), t(' — предыдущая и следующая глава')), h('li', h('kbd', 'Ctrl'), '+', h('kbd', 'Enter'), t(' — сохранить стих')),
        h('li', h('kbd', 'Ctrl'), '+', h('kbd', 'Z'), t(' — отменить последнее действие')), h('li', h('kbd', 'Esc'), t(' — закрыть окно'))));
    return AB.ui.openSheet({ title: t('Помощь и о тексте'), className: 'tall', body });
  }

  AB.viewTools = { openSearch, openChanges, openNames, openHelp, openHistory };
})();
