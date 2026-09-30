/*
 * The application shell: start-up, current position, header, chapter pager, menu, settings, keyboard, URL hash.
 */
(function () {
  'use strict';
  const AB = (globalThis.AB = globalThis.AB || {});
  const { h, icon, clear } = AB.ui;
  const { t } = AB.i18n;
  const D = AB.Data;
  const store = AB.platform.safeStorage;

  const FS_MIN = 16, FS_MAX = 36, FS_STEP = 2;
  const state = { b: 1, c: 1, sel: 0 };
  const settings = Object.assign({ fs: window.innerWidth < 480 ? 20 : 22, theme: 'auto', onboarded: false }, store.get('ab.settings', {}));
  let navToken = 0;
  let sideNav = null;
  const els = {};

  // ---- settings --------------------------------------------------------------------------------------------------

  function applySettings() {
    const root = document.documentElement;
    root.style.setProperty('--fs', Math.min(FS_MAX, Math.max(FS_MIN, settings.fs)) + 'px');
    if (!AB.platform.hosted) {            // inside the viewer the theme belongs to the viewer
      if (settings.theme === 'light' || settings.theme === 'dark') root.setAttribute('data-theme', settings.theme);
      else root.removeAttribute('data-theme');
    }
  }
  function setSetting(k, v) {
    settings[k] = v;
    store.set('ab.settings', settings);
    applySettings();
  }

  // ---- books loading ---------------------------------------------------------------------------------------------

  const tidied = new Set();
  async function ensureBook(i) {
    await D.loadBook(i);
    if (!tidied.has(i)) { tidied.add(i); D.tidy(i); }
  }

  let allPromise = null;
  const progressFns = new Set();
  /** Loads every book (needed for search, replace and export). Several callers share one run. */
  function loadAll(progress) {
    if (D.allLoaded()) return Promise.resolve();
    if (progress) progressFns.add(progress);
    if (!allPromise) {
      allPromise = (async () => {
        let done = 0;
        const n = AB.index.books.length;
        for (const bm of AB.index.books) {
          await ensureBook(bm.i);
          done += 1;
          for (const fn of progressFns) fn(done, n);
        }
      })().finally(() => { allPromise = null; progressFns.clear(); });
    }
    return allPromise;
  }

  // ---- position --------------------------------------------------------------------------------------------------

  function parseHash() {
    const m = /^#p(\d+)\.(\d+)(?:\.(\d+))?$/.exec(location.hash || '');
    if (!m) return null;
    const b = Number(m[1]), c = Number(m[2]);
    if (!(b >= 1 && b <= 66) || !(c >= 1 && c <= D.chapterCount(b))) return null;
    return { b, c, v: m[3] ? Number(m[3]) : 0 };
  }

  function syncHash() {
    if (AB.ui.sheetDepth) return;
    AB.ui.whenIdle(() => {
      const hash = '#p' + state.b + '.' + state.c + (state.sel ? '.' + state.sel : '');
      try { if (location.hash !== hash) history.replaceState(history.state, '', hash); } catch (e) { /* the frame may not allow it */ }
    });
  }

  /**
   * Shows a chapter.
   * @param {{select?:boolean, flash?:boolean, quiet?:boolean}} [o]  quiet: only switch the text (the editor moving between verses)
   */
  async function goTo(b, c, v, o) {
    o = o || {};
    b = Math.min(66, Math.max(1, b | 0));
    c = Math.min(D.chapterCount(b), Math.max(1, c | 0));
    const token = ++navToken;
    const changedChapter = b !== state.b || c !== state.c;
    state.b = b; state.c = c;
    state.sel = o.select && v ? v : 0;
    updateChrome();
    if (!D.isLoaded(b)) {
      AB.reader.render();
      try { await ensureBook(b); } catch (e) { if (token === navToken) showLoadError(() => goTo(b, c, v, o)); return; }
      if (token !== navToken) return;
    }
    const count = D.verseCount(b, c);
    if (state.sel > count) state.sel = count;
    if (v > count) v = count;
    AB.reader.render();
    if (sideNav && wide()) sideNav.follow();
    store.set('ab.pos', { b, c });
    if (o.quiet) { if (state.sel) AB.reader.applySelection(); return; }
    if (v) { AB.reader.scrollToVerse(v, false); if (o.flash) AB.reader.flash(v); }
    else if (changedChapter) window.scrollTo(0, 0);
    syncHash();
  }

  function showLoadError(retry) {
    const host = document.getElementById('reader');
    clear(host);
    host.appendChild(h('div.error-card', h('h2', t('Не удалось загрузить книгу')), h('p', t('Проверьте соединение и попробуйте ещё раз.')),
      h('button.btn.primary', { type: 'button', onclick: retry }, t('Повторить'))));
  }

  function neighbour(d) {
    let { b, c } = state;
    c += d;
    if (c < 1) { if (b === 1) return null; b -= 1; c = D.chapterCount(b); }
    else if (c > D.chapterCount(b)) { if (b === 66) return null; b += 1; c = 1; }
    return { b, c };
  }
  const step = (d) => { const n = neighbour(d); if (n) goTo(n.b, n.c, 0); };

  // ---- chrome (header and pager) ---------------------------------------------------------------------------------

  function buildChrome() {
    const top = document.getElementById('topbar');
    els.titleMain = h('span.t-main', { lang: 'hy' });
    els.titleSub = h('span.t-sub');
    els.title = h('button.title-btn', { type: 'button', 'aria-haspopup': 'dialog', onclick: () => (wide() ? sideNav.focusField() : openNavigator()) },
      h('span.t-text', els.titleMain, els.titleSub), icon('down', 'title-chev'));
    els.search = h('button.icon-btn', { type: 'button', 'aria-label': t('Поиск'), title: t('Поиск') + ' ( / )', onclick: () => AB.viewTools.openSearch() }, icon('search'));
    els.badge = h('span.badge');
    els.badge.hidden = true;
    els.changes = h('button.icon-btn.has-text', { type: 'button', 'aria-haspopup': 'dialog', onclick: () => AB.viewTools.openChanges() }, icon('fileDown'), h('span.icon-text', t('Правки и экспорт')), els.badge);
    els.menu = h('button.icon-btn', { type: 'button', 'aria-label': t('Меню'), 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => openMenu() }, icon('more'));
    top.append(els.title, els.search, els.changes, els.menu);

    const pager = document.getElementById('pager');
    els.prev = h('button.pg-btn', { type: 'button', onclick: () => step(-1) }, icon('left'), h('span.pg-lab'));
    els.pos = h('button.pg-pos', { type: 'button', 'aria-haspopup': 'dialog', onclick: () => (wide() ? sideNav.focusField() : openNavigator()) });
    els.next = h('button.pg-btn.next', { type: 'button', onclick: () => step(1) }, h('span.pg-lab'), icon('right'));
    pager.append(els.prev, els.pos, els.next);
  }

  const wide = () => window.matchMedia('(min-width: 1000px)').matches;

  function updateChrome() {
    const bm = D.bookMeta(state.b);
    els.titleMain.textContent = D.bookName(state.b) + ' ' + state.c;
    els.titleSub.textContent = bm.ru + (state.b === 19 ? ' · ' + t('рус. {n}', { n: AB.refs.psalmToRu(state.c) }) : '');
    els.title.setAttribute('aria-label', t('Выбрать книгу и главу. Сейчас: {n}', { n: bm.ru + ' ' + state.c }));
    const label = (n) => (n.b === state.b ? t('Гл. {n}', { n: n.c }) : AB.index.books[n.b - 1].ab + ' ' + n.c);
    for (const [btn, d] of [[els.prev, -1], [els.next, 1]]) {
      const n = neighbour(d);
      btn.disabled = !n;
      btn.querySelector('.pg-lab').textContent = n ? label(n) : '';
      btn.setAttribute('aria-label', n ? (d < 0 ? t('Предыдущая глава') : t('Следующая глава')) + ': ' + (D.bookName(n.b) + ' ' + n.c) : (d < 0 ? t('Это первая глава') : t('Это последняя глава')));
    }
    clear(els.pos);
    els.pos.append(h('strong', String(state.c)), ' ' + t('из') + ' ' + D.chapterCount(state.b));
    els.pos.setAttribute('aria-label', t('Глава {c} из {n}. Открыть список глав', { c: state.c, n: D.chapterCount(state.b) }));
    updateBadge();
  }

  function updateBadge() {
    let n = 0;
    try { const s = D.summary(); n = s.touched + s.bookNames.length; } catch (e) { n = 0; }
    els.badge.hidden = !n;
    els.badge.textContent = n > 99 ? '99+' : String(n);
    els.changes.setAttribute('aria-label', t('Правки и экспорт') + (n ? ', ' + t('правок: {n}', { n }) : ''));
    els.changes.classList.toggle('dirty', n > 0);
  }

  // ---- sheets and menus ------------------------------------------------------------------------------------------

  function openNavigator() {
    let sheet = null;
    const nav = AB.viewNav.buildNavigator({ onPick: (b, c, v) => { sheet.close(); goTo(b, c, v, { select: !!v, flash: !!v }); } });
    sheet = AB.ui.openSheet({ title: t('Книги и главы'), className: 'tall', body: nav.el });
    nav.showCurrent();
    return sheet;
  }

  function openMenu() {
    const pop = () => AB.ui.closePopover();
    if (els.menu.getAttribute('aria-expanded') === 'true') { pop(); return; }
    const size = h('span.menu-size', { 'aria-live': 'polite' });
    const setSize = (d) => { setSetting('fs', Math.min(FS_MAX, Math.max(FS_MIN, settings.fs + d))); size.textContent = String(settings.fs); minus.disabled = settings.fs <= FS_MIN; plus.disabled = settings.fs >= FS_MAX; };
    const minus = h('button.icon-btn.small', { type: 'button', 'aria-label': t('Меньше'), onclick: () => setSize(-FS_STEP) }, h('span.a-small', 'A'));
    const plus = h('button.icon-btn.small', { type: 'button', 'aria-label': t('Крупнее'), onclick: () => setSize(FS_STEP) }, h('span.a-big', 'A'));
    size.textContent = String(settings.fs);
    const item = (ico, label, fn, disabled) => h('button.menu-item', { type: 'button', role: 'menuitem', disabled: disabled ? true : null, onclick: () => { pop(); fn(); } }, icon(ico), h('span', label));
    const items = [
      h('div.menu-row', h('span.menu-lab', icon('type'), t('Размер текста')), h('span.menu-stepper', minus, size, plus)),
    ];
    if (!AB.platform.hosted) {
      const seg = h('div.seg.small', { role: 'group', 'aria-label': t('Тема') });
      for (const [val, label] of [['auto', t('Авто')], ['light', t('Светлая')], ['dark', t('Тёмная')]]) {
        seg.appendChild(h('button.seg-btn' + (settings.theme === val ? '.on' : ''), { type: 'button', 'aria-pressed': String(settings.theme === val), onclick: (e) => {
          setSetting('theme', val);
          seg.querySelectorAll('.seg-btn').forEach((n) => { n.classList.remove('on'); n.setAttribute('aria-pressed', 'false'); });
          e.currentTarget.classList.add('on'); e.currentTarget.setAttribute('aria-pressed', 'true');
        } }, label));
      }
      items.push(h('div.menu-row.stack', h('span.menu-lab', icon('sun'), t('Тема')), seg));
    }
    items.push(h('hr.menu-sep'));
    items.push(item('undo', D.canUndo() ? t('Отменить: {l}', { l: D.lastLabel() }) : t('Отменить последнее'), undo, !D.canUndo()));
    items.push(item('search', t('Найти и заменить'), () => AB.viewTools.openSearch({ replace: true })));
    items.push(item('languages', t('Названия книг'), () => AB.viewTools.openNames()));
    items.push(item('help', t('Помощь и о тексте'), () => AB.viewTools.openHelp()));
    AB.ui.openPopover(els.menu, h('div.menu', items));
    setSize(0);
  }

  // ---- editing helpers used by the views -------------------------------------------------------------------------

  function afterEdit(message) {
    AB.ui.toast(message, { action: t('Отменить'), onAction: undo });
  }

  function undo() {
    if (!D.canUndo()) { AB.ui.toast(t('Отменять пока нечего.')); return; }
    const label = D.undo();
    AB.ui.toast(t('Отменено: {l}', { l: label }));
  }

  function openEditor(b, c, v, o) {
    if (b !== state.b || c !== state.c) goTo(b, c, v, { select: true, quiet: true });
    else if (!(o && o.mode === 'new') && state.sel !== v) { state.sel = v; AB.reader.applySelection(); }
    return AB.viewEdit.openEditor(b, c, v, o);
  }

  function afterEditorClose(b, c, v) {
    if (state.b === b && state.c === c) {
      const target = state.sel || v;
      setTimeout(() => { const row = document.getElementById('v' + target); if (row) row.scrollIntoView({ block: 'nearest' }); }, 40);
    }
  }

  // ---- keyboard --------------------------------------------------------------------------------------------------

  function onKey(e) {
    if (e.defaultPrevented || e.altKey) return;
    const el = document.activeElement;
    const typing = el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
      if (typing || AB.ui.sheetDepth || !D.canUndo()) return;
      e.preventDefault(); undo(); return;
    }
    if (typing || AB.ui.sheetDepth || e.ctrlKey || e.metaKey) return;
    if (e.key === '/') { e.preventDefault(); AB.viewTools.openSearch(); }
    else if (e.key === 'ArrowLeft') { step(-1); }
    else if (e.key === 'ArrowRight') { step(1); }
    else if ((e.key === 'e' || e.key === 'E') && state.sel) { e.preventDefault(); openEditor(state.b, state.c, state.sel); }
    else if (e.key === 'Escape' && state.sel) { state.sel = 0; AB.reader.applySelection(); syncHash(); }
  }

  // ---- start-up --------------------------------------------------------------------------------------------------

  function status(text) {
    const host = document.getElementById('reader');
    clear(host);
    host.appendChild(h('div.boot', h('span.spinner'), h('p', text)));
  }

  async function boot() {
    applySettings();
    buildChrome();
    AB.reader.init();
    document.addEventListener('keydown', onKey);
    AB.ui.setEmptyHook(syncHash);
    window.addEventListener('hashchange', () => {
      const p = parseHash();
      if (p && (p.b !== state.b || p.c !== state.c) && !AB.ui.sheetDepth) goTo(p.b, p.c, p.v, { select: !!p.v, flash: !!p.v });
    });

    status(t('Открываю Библию…'));
    try {
      const st = await D.init();
      st.onStatus = (s) => {
        if (s === 'error' && !app.warnedStore) {
          app.warnedStore = true;
          AB.ui.toast(t('Не удалось сохранить правки. Сохраните копию правок в разделе «Правки и экспорт».'), { kind: 'error', duration: 9000 });
        }
      };
    } catch (e) { console.error(e); AB.ui.toast(t('Хранилище правок недоступно: правки не сохранятся.'), { kind: 'error' }); }

    // edited books must be loaded so that the badge and the changes list are complete
    const start = parseHash() || store.get('ab.pos', null) || { b: 1, c: 1, v: 0 };
    const b0 = start.b >= 1 && start.b <= 66 ? start.b : 1;
    const edited = new Set(D.editedKeys.map((k) => Number(k.split(':')[0])));
    edited.add(b0);
    try { await Promise.all([...edited].map((i) => ensureBook(i))); }
    catch (e) { showLoadError(() => boot()); return; }

    sideNav = AB.viewNav.buildNavigator({ onPick: (b, c, v) => goTo(b, c, v, { select: !!v, flash: !!v }), wide: true });
    document.getElementById('sidebar').append(h('div.side-head', icon('book'), h('span', t('Книги и главы'))), sideNav.el);
    D.onChange(onDataChange);
    await goTo(b0, start.c || 1, start.v || 0, { select: !!start.v, flash: !!start.v });
    document.documentElement.classList.add('ready');
  }

  function onDataChange(e) {
    if (!e) return;
    if (e.type === 'meta') { updateChrome(); if (sideNav) sideNav.refresh(); AB.reader.render({ keepScroll: true }); return; }
    const need = (e.keys || []).map((k) => Number(k.split(':')[0])).filter((i) => !D.isLoaded(i));
    const go = () => {
      if (state.sel > D.verseCount(state.b, state.c)) state.sel = 0;
      const k = state.b + ':' + state.c;
      if (!e.keys || !e.keys.length || e.keys.includes(k)) AB.reader.render({ keepScroll: true });
      updateBadge();
      if (sideNav) sideNav.refresh();
    };
    if (need.length) Promise.all(need.map(ensureBook)).then(go).catch(() => {}); else go();
  }

  const app = AB.app = {
    state, settings, setSetting, goTo, step, loadAll, ensureBook, afterEdit, undo, openEditor, afterEditorClose,
    openChanges: (focus) => AB.viewTools.openChanges(focus),
    openSearch: (o) => AB.viewTools.openSearch(o),
    boot, warnedStore: false,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
