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
  const FONTS = ['montserrat', 'noto', 'arial', 'serif'];
  const settings = Object.assign({ fs: window.innerWidth < 480 ? 20 : 22, theme: 'auto', font: 'montserrat', hl: true, onboarded: false, name: '' }, store.get('ab.settings', {}));
  let navToken = 0;
  let sideNav = null;
  const els = {};

  // ---- settings --------------------------------------------------------------------------------------------------

  function applySettings() {
    const root = document.documentElement;
    root.style.setProperty('--fs', Math.min(FS_MAX, Math.max(FS_MIN, settings.fs)) + 'px');
    root.setAttribute('data-font', FONTS.includes(settings.font) ? settings.font : FONTS[0]);
    root.setAttribute('data-hl', settings.hl === false ? 'off' : 'on');
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
    els.review = h('button.icon-btn.review', { type: 'button', 'aria-pressed': 'false', onclick: () => toggleReview(state.b, state.c) }, icon('checkCircle'));
    els.search = h('button.icon-btn', { type: 'button', 'aria-label': t('Поиск'), title: t('Поиск') + ' ( / )', onclick: () => AB.viewTools.openSearch() }, icon('search'));
    els.badge = h('span.badge');
    els.badge.hidden = true;
    els.changes = h('button.icon-btn.has-text', { type: 'button', 'aria-haspopup': 'dialog', onclick: () => AB.viewTools.openChanges() }, icon('fileDown'), h('span.icon-text', t('Правки и экспорт')), els.badge);
    els.menu = h('button.icon-btn', { type: 'button', 'aria-label': t('Меню'), 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: () => openMenu() }, icon('more'));
    top.append(els.title, els.review, els.search, els.changes, els.menu);

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
    updateReviewBtn();
  }

  /** The check in the top bar: outline = not yet, filled green = this chapter has been read through. */
  function updateReviewBtn() {
    const on = D.isReviewed(state.b, state.c);
    const label = on ? t('Глава просмотрена. Снять отметку') : t('Отметить главу как просмотренную');
    els.review.classList.toggle('on', on);
    els.review.setAttribute('aria-pressed', String(on));
    els.review.setAttribute('aria-label', label);
    els.review.title = label;
    els.review.disabled = !!app.locked;
    clear(els.review);
    els.review.appendChild(icon(on ? 'checkDone' : 'checkCircle'));
  }

  /** Marks the chapter as read through, or takes the mark back. The screen changes at once; a refusal is reported and undone. */
  function toggleReview(b, c) {
    if (app.locked) { AB.ui.toast(t('Правки сейчас закрыты владельцем сайта.'), { kind: 'warn' }); return; }
    const on = !D.isReviewed(b, c);
    const p = D.setReviewed(b, c, on);
    AB.ui.toast(on ? t('Глава отмечена как просмотренная') : t('Отметка о просмотре снята'),
      { kind: on ? 'ok' : undefined, action: t('Отменить'), onAction: () => D.setReviewed(b, c, !on).catch(() => AB.ui.toast(t('Не получилось отменить.'), { kind: 'error' })) });
    p.catch((e) => {
      const refused = e && (e.code === 'permission-denied' || e.code === 'unauthenticated');
      AB.ui.toast(refused
        ? t('Сервер не принял отметку: правила доступа Firebase ещё не обновлены для отметок о просмотре (см. README).')
        : t('Не удалось сохранить отметку. Проверьте связь и попробуйте ещё раз.'), { kind: 'error', duration: 9000 });
    });
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
    /** A row of choices for one setting: [value, label, style?] */
    const segRow = (ico, label, key, choices, wrap) => {
      const seg = h('div.seg.small' + (wrap ? '.wrap' : ''), { role: 'group', 'aria-label': label });
      for (const [val, text, style] of choices) {
        const btn = h('button.seg-btn' + (settings[key] === val ? '.on' : ''), { type: 'button', 'aria-pressed': String(settings[key] === val), onclick: (e) => {
          setSetting(key, val);
          seg.querySelectorAll('.seg-btn').forEach((n) => { n.classList.remove('on'); n.setAttribute('aria-pressed', 'false'); });
          e.currentTarget.classList.add('on'); e.currentTarget.setAttribute('aria-pressed', 'true');
        } }, text);
        if (style) btn.style.fontFamily = style;
        seg.appendChild(btn);
      }
      return h('div.menu-row.stack', h('span.menu-lab', icon(ico), label), seg);
    };
    const items = [
      h('div.menu-row', h('span.menu-lab', icon('type'), t('Размер текста')), h('span.menu-stepper', minus, size, plus)),
      segRow('type', t('Шрифт'), 'font', [
        ['montserrat', 'Montserrat', "'Montserrat Arm', 'Noto Sans Armenian', Arial, sans-serif"],
        ['noto', 'Noto Sans', "'Noto Sans Armenian', Arial, sans-serif"],
        ['arial', 'Arial', "Arial, 'Helvetica Neue', sans-serif"],
        ['serif', t('С засечками'), "'Noto Serif Armenian', serif"]], true),
      segRow('pencil', t('Подсветка правок'), 'hl', [[true, t('Вкл')], [false, t('Выкл')]]),
    ];
    if (!AB.platform.hosted) items.push(segRow('sun', t('Тема'), 'theme', [['auto', t('Авто')], ['light', t('Светлая')], ['dark', t('Тёмная')]]));
    items.push(h('hr.menu-sep'));
    items.push(item('undo', D.canUndo() ? t('Отменить: {l}', { l: D.lastLabel() }) : t('Отменить последнее'), undo, !D.canUndo()));
    items.push(item('search', t('Найти и заменить'), () => AB.viewTools.openSearch({ replace: true })));
    items.push(item('languages', t('Названия книг'), () => AB.viewTools.openNames()));
    if (app.shared) items.push(item('pencil', settings.name ? t('Ваше имя: {n}', { n: settings.name }) : t('Ваше имя для истории'), openNameDialog));
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
    if (app.locked) { AB.ui.toast(t('Правки сейчас закрыты владельцем сайта.'), { kind: 'warn' }); return null; }
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
      app.shared = st.kind === 'shared';
      if (app.shared) {
        st.setAuthor(settings.name);
        st.onLock = (on) => setLocked(on);
        app.locked = !!st.locked;
        app.leftovers = st.leftovers || null;
        if (st.offlineStart) AB.ui.toast(t('Нет связи с общей версией. Показан текст, сохранённый на этом устройстве; свежие правки других появятся, когда связь вернётся.'), { kind: 'warn', duration: 10000 });
        window.addEventListener('offline', () => AB.ui.toast(t('Нет связи. Правки сохранятся на этом устройстве и отправятся, когда появится интернет.'), { duration: 6000 }));
      } else if (AB.config && AB.config.firebase && AB.store.sharedError) {
        AB.ui.toast(t('Общая версия сейчас недоступна: правки сохраняются только на этом устройстве.'), { kind: 'warn', duration: 9000 });
      }
      st.onStatus = (s) => {
        app.sync = s;
        // a refused change is taken back on this screen; that is not somebody else's edit
        if (s === 'locked' || s === 'denied' || s === 'error') app.muteRemoteUntil = Date.now() + 5000;
        if (s === 'locked') AB.ui.toast(t('Сейчас правки закрыты: изменения не сохранены.'), { kind: 'error', duration: 7000 });
        else if (s === 'denied') AB.ui.toast(t('Сервер не принял правку, она не сохранена. Обновите страницу и попробуйте ещё раз.'), { kind: 'error', duration: 9000 });
        else if (s === 'reconnected') AB.ui.toast(t('Связь с общей версией восстановлена, текст обновлён.'), { kind: 'ok' });
        else if (s === 'error' && !app.warnedStore) {
          app.warnedStore = true;
          AB.ui.toast(app.shared ? t('Не удалось связаться с общей версией. Правки сохранятся, когда связь появится.') : t('Не удалось сохранить правки. Сохраните копию правок в разделе «Правки и экспорт».'), { kind: 'error', duration: 9000 });
        }
        for (const fn of app.syncListeners) fn(s);
      };
    } catch (e) { console.error(e); AB.ui.toast(t('Хранилище правок недоступно: правки не сохранятся.'), { kind: 'error' }); }

    // edited books must be loaded so that the badge and the changes list are complete
    const start = parseHash() || store.get('ab.pos', null) || { b: 1, c: 1, v: 0 };
    const b0 = start.b >= 1 && start.b <= 66 ? start.b : 1;
    const edited = new Set(D.editedKeys.map((k) => Number(k.split(':')[0])));
    try { await ensureBook(b0); }
    catch (e) { showLoadError(() => boot()); return; }
    // the other edited books load in the background; the counter and the list of changes fill in when they are here
    app.editedLoaded = Promise.all([...edited].filter((i) => i !== b0).map((i) => ensureBook(i))).then(() => { updateBadge(); }, () => {});

    sideNav = AB.viewNav.buildNavigator({ onPick: (b, c, v) => goTo(b, c, v, { select: !!v, flash: !!v }), wide: true });
    document.getElementById('sidebar').append(h('div.side-head', icon('book'), h('span', t('Книги и главы'))), sideNav.el);
    D.onChange(onDataChange);
    await goTo(b0, start.c || 1, start.v || 0, { select: !!start.v, flash: !!start.v });
    document.documentElement.classList.add('ready');
  }

  function setLocked(on) {
    app.locked = on;
    updateReviewBtn();
    AB.reader.render({ keepScroll: true });
    AB.ui.toast(on ? t('Владелец сайта закрыл правки. Читать и скачивать можно.') : t('Правки снова открыты.'), { kind: on ? 'warn' : 'ok', duration: 6000 });
  }

  /** The reader chose what to do with edits made on this device before the shared version existed. */
  async function resolveLeftovers(add) {
    const lo = app.leftovers;
    if (!lo) return;
    try {
      if (add) {
        await loadAll();
        const changes = new Map();
        for (const [k, verses] of lo.chapters) { const ok = AB.sanitizeVerses(verses); if (ok) changes.set(k, ok); }
        if (changes.size) D.commit(changes, 'прежние правки');
      }
      await lo.local.clear();
      store.set('ab.leftoversHandled', true);
    } catch (e) { console.error(e); AB.ui.toast(t('Не получилось. Попробуйте ещё раз.'), { kind: 'error' }); return; }
    app.leftovers = null;
    AB.reader.render({ keepScroll: true });
    if (add) afterEdit(t('Прежние правки добавлены в общую версию'));
    else AB.ui.toast(t('Прежние правки удалены с этого устройства'));
  }

  function openNameDialog() {
    const input = h('input.field', { id: 'author-name', value: settings.name, maxlength: '40', placeholder: t('Например: Сергей'), autocomplete: 'off' });
    const save = () => {
      const v = input.value.replace(/\s+/g, ' ').trim().slice(0, 40);
      setSetting('name', v);
      if (D.store && D.store.setAuthor) D.store.setAuthor(v);
      sheet.close();
      AB.ui.toast(t('Имя сохранено'));
    };
    const body = h('div', h('p.muted', t('Это имя все увидят в истории изменений главы. Можно оставить пустым.')), h('label.lbl', { for: 'author-name' }, t('Ваше имя')), input);
    const sheet = AB.ui.openSheet({ title: t('Ваше имя'), className: 'compact', body, focus: () => input,
      footer: h('div.foot-row', h('button.btn.wide', { type: 'button', onclick: () => sheet.close() }, t('Отмена')), h('button.btn.primary.wide', { type: 'button', onclick: save }, t('Сохранить'))) });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    return sheet;
  }

  function onDataChange(e) {
    if (!e) return;
    if (e.type === 'remote' && app.shared && e.keys && e.keys.includes(state.b + ':' + state.c) && Date.now() > app.muteRemoteUntil) {
      AB.ui.toast(t('Эту главу только что изменил {who}', { who: e.by || t('другой человек') }), { duration: 4000 });
    }
    if (e.type === 'meta') { updateChrome(); if (sideNav) sideNav.refresh(); AB.reader.render({ keepScroll: true }); return; }
    if (e.type === 'stamp') {       // a reviewed chapter learned when it was last edited: the "edited after the review" hint
      if (e.keys && e.keys.includes(state.b + ':' + state.c)) AB.reader.render({ keepScroll: true });
      return;
    }
    if (e.type === 'review') {
      updateReviewBtn();
      if (sideNav) sideNav.refresh();
      if (e.keys && e.keys.includes(state.b + ':' + state.c)) {
        AB.reader.render({ keepScroll: true });
        if (e.remote && app.shared) {
          const who = e.by || t('Кто-то');
          AB.ui.toast(D.isReviewed(state.b, state.c) ? t('{who}: эта глава отмечена как просмотренная', { who }) : t('{who}: отметка о просмотре снята', { who }), { duration: 4000 });
        }
      }
      return;
    }
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
    state, settings, setSetting, goTo, step, loadAll, ensureBook, afterEdit, undo, openEditor, afterEditorClose, toggleReview,
    openChanges: (focus) => AB.viewTools.openChanges(focus),
    openSearch: (o) => AB.viewTools.openSearch(o),
    boot, warnedStore: false, shared: false, locked: false, leftovers: null, sync: 'saved', syncListeners: new Set(), resolveLeftovers, editedLoaded: Promise.resolve(), muteRemoteUntil: 0,
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
