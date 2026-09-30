/*
 * Navigator (books and chapters, "book or reference" field) and the reader (one chapter, tap a verse for actions).
 */
(function () {
  'use strict';
  const AB = (globalThis.AB = globalThis.AB || {});
  const { h, icon, clear } = AB.ui;
  const { t, num } = AB.i18n;
  const D = () => AB.Data;
  const app = () => AB.app;

  // ---- navigator -------------------------------------------------------------------------------------------------

  /**
   * @param {{onPick:(b:number,c:number,v:number)=>void, wide?:boolean}} opts
   * @returns {{el:HTMLElement, refresh:()=>void, focusField:()=>void}}
   */
  function buildNavigator(opts) {
    let openBook = app().state.b;
    let filter = null;
    const field = h('input.field', { type: 'text', id: 'nav-q-' + (opts.wide ? 'side' : 'sheet'), placeholder: t('Книга или ссылка, например Ин 3:16'), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', enterkeyhint: 'go', 'aria-label': t('Книга или ссылка') });
    const goBtn = h('button.btn.primary.compact', { type: 'button' }, t('Перейти'));
    const msg = h('p.nav-msg', { role: 'status' });
    msg.hidden = true;
    const list = h('div.nav-list');
    const el = h('div.navigator', h('form.nav-search', { onsubmit: (e) => { e.preventDefault(); submit(); } }, field, goBtn), msg, list);
    goBtn.addEventListener('click', (e) => { e.preventDefault(); submit(); });

    function say(text) { msg.textContent = text || ''; msg.hidden = !text; }

    function submit() {
      const q = field.value;
      const r = AB.refs.parse(q);
      if (!r) { say(t('Введите название книги или ссылку, например «Ин 3:16».')); field.focus(); return; }
      if (!r.ok) {
        if (r.candidates && r.candidates.length > 1) say(t('Подходит несколько книг — выберите из списка ниже.'));
        else say(t('Не нашёл такую книгу. Попробуйте по-русски («Быт», «Ин») или по-армянски.'));
        return;
      }
      if (!r.hasChapter) { openBook = r.b; filter = new Set([r.b]); say(t('Выберите главу.')); render(); scrollToOpen(); return; }
      say(r.note || '');
      opts.onPick(r.b, r.c, r.v || 0);
    }

    field.addEventListener('input', () => {
      say('');
      const q = AB.refs.bookPart(field.value);
      filter = q.trim() ? AB.refs.filterBooks(q) : null;
      if (filter && filter.size === 1) openBook = [...filter][0];
      render();
    });

    function editedBooks() {
      const s = new Set();
      for (const k of D().editedKeys) s.add(Number(k.split(':')[0]));
      return s;
    }

    function scrollToOpen() {
      const n = list.querySelector('.ch.cur') || list.querySelector('.nb.open');
      if (n && n.scrollIntoView) n.scrollIntoView({ block: 'center' });
    }

    function render() {
      clear(list);
      const edited = editedBooks();
      const cur = app().state;
      let lastOt = null;
      let shown = 0;
      for (const bm of AB.index.books) {
        if (filter && !filter.has(bm.i)) continue;
        shown += 1;
        if (bm.ot !== lastOt) {
          lastOt = bm.ot;
          list.appendChild(h('h3.nb-group', bm.ot ? t('Ветхий Завет') : t('Новый Завет')));
        }
        const isOpen = openBook === bm.i;
        const head = h('button.nb-head', { type: 'button', 'aria-expanded': isOpen ? 'true' : 'false', onclick: () => { openBook = isOpen ? 0 : bm.i; render(); if (!isOpen) scrollToOpen(); } },
          h('span.nb-names', h('span.nb-hy', { lang: 'hy' }, D().bookName(bm.i)), h('span.nb-ru', bm.ru)),
          edited.has(bm.i) ? h('span.dot', { title: t('В этой книге есть правки'), 'aria-label': t('есть правки') }) : null,
          h('span.nb-count', String(bm.vs.length)),
          icon(isOpen ? 'up' : 'down', 'nb-chev'));
        const row = h('div.nb' + (isOpen ? '.open' : '') + (cur.b === bm.i ? '.current' : ''), head);
        if (isOpen) {
          const grid = h('div.ch-grid', { role: 'group', 'aria-label': t('Главы') });
          for (let c = 1; c <= bm.vs.length; c++) {
            const isCur = cur.b === bm.i && cur.c === c;
            grid.appendChild(h('button.ch' + (isCur ? '.cur' : '') + (D().isEdited(bm.i, c) ? '.edited' : ''), {
              type: 'button', 'aria-label': t('Глава {n}', { n: c }) + (D().isEdited(bm.i, c) ? ', ' + t('есть правки') : ''), 'aria-current': isCur ? 'true' : null,
              onclick: () => opts.onPick(bm.i, c, 0),
            }, String(c)));
          }
          row.appendChild(grid);
        }
        list.appendChild(row);
      }
      if (!shown) list.appendChild(h('p.empty', t('Такой книги нет в списке.')));
    }

    render();
    return {
      el,
      refresh() { openBook = openBook || app().state.b; render(); },
      focusField() { field.focus(); field.select(); },
      /** After navigation elsewhere: open the current book and bring the current chapter into view. */
      follow() { openBook = app().state.b; render(); scrollToOpen(); },
      showCurrent() { openBook = app().state.b; filter = null; field.value = ''; say(''); render(); scrollToOpen(); },
    };
  }

  // ---- reader ----------------------------------------------------------------------------------------------------

  const notesFor = (b, c) => {
    const out = [];
    const notes = AB.index.notes || {};
    for (const k of Object.keys(notes)) {
      const [nb, nc, nv] = k.split(':').map(Number);
      if (nb === b && nc === c) out.push({ v: nv, text: notes[k] });
    }
    return out;
  };

  function notesSummary(list) {
    // group verses that share a note: "41–46"
    const byText = new Map();
    for (const n of list) { if (!byText.has(n.text)) byText.set(n.text, []); byText.get(n.text).push(n.v); }
    return [...byText.entries()].map(([text, vs]) => {
      vs.sort((a, b) => a - b);
      const parts = [];
      let s = vs[0], p = vs[0];
      for (let i = 1; i <= vs.length; i++) {
        if (vs[i] === p + 1) { p = vs[i]; continue; }
        parts.push(s === p ? String(s) : s + '–' + p);
        s = vs[i]; p = vs[i];
      }
      return { text, verses: parts.join(', '), count: vs.length };
    });
  }

  function chapterHead(b, c, changedCount) {
    const bm = D().bookMeta(b);
    const kids = [
      h('div.ch-titles',
        h('h1.ch-book', { lang: 'hy' }, D().bookName(b)),
        h('p.ch-sub', bm.ru + ' · ' + t('глава {n}', { n: c }))),
    ];
    const hint = [];
    if (b === 19) hint.push(t('В русской Библии: Пс. {n}', { n: AB.refs.psalmToRu(c) }));
    const wrap = h('div.chead', kids, hint.length ? h('p.ch-hint', icon('info'), hint.join(' ')) : null);
    if (changedCount) {
      wrap.appendChild(h('button.chip.edit', { type: 'button', onclick: () => app().openChanges({ b, c }) }, h('span.dot'), t('Изменено в этой главе: {n}', { n: changedCount }), icon('right')));
    }
    return wrap;
  }

  function onboardingBanner() {
    if (app().settings.onboarded) return null;
    const close = h('button.icon-btn.small', { type: 'button', 'aria-label': t('Закрыть подсказку'), onclick: () => { app().setSetting('onboarded', true); box.remove(); } }, icon('x'));
    const box = h('div.hint-card', { role: 'note' },
      icon('pencil', 'hint-ico'),
      h('div.hint-text', h('strong', t('Как править')), h('p', t('Нажмите на любой стих и выберите «Править». Готовую Библию для ProPresenter скачайте через значок с файлом вверху.'))),
      close);
    return box;
  }

  function buildBar(b, c, v, text) {
    const bar = h('div.vbar', { role: 'group', 'aria-label': t('Действия со стихом {n}', { n: v }) },
      h('button.btn.primary.compact', { type: 'button', onclick: (e) => { e.stopPropagation(); app().openEditor(b, c, v); } }, icon('pencil'), t('Править')),
      h('button.btn.compact', { type: 'button', onclick: async (e) => {
        e.stopPropagation();
        const ref = D().bookName(b) + ' ' + c + ':' + v;
        const ok = await AB.platform.copyText(ref + ' — ' + text);
        AB.ui.toast(ok ? t('Скопировано') : t('Не удалось скопировать'), { kind: ok ? 'ok' : 'warn' });
      } }, icon('copy'), t('Копировать')),
      h('button.btn.compact.icon-only', { type: 'button', 'aria-haspopup': 'dialog', 'aria-label': t('Ещё'), title: t('Ещё: вставить, объединить, удалить, перенести'), onclick: (e) => { e.stopPropagation(); AB.viewEdit.openOps(b, c, v); } }, icon('more')));
    return bar;
  }

  const reader = {
    host: null,

    /** Draws the current chapter. opts.keepScroll keeps the scroll position (after an edit). */
    render(opts) {
      const host = this.host || (this.host = document.getElementById('reader'));
      const { b, c } = app().state;
      const y = window.scrollY;
      clear(host);
      if (!D().isLoaded(b)) {
        host.appendChild(h('div.skeleton', { 'aria-busy': 'true', 'aria-label': t('Загрузка текста') }, h('div.sk.w1'), h('div.sk.w2'), h('div.sk.w3'), h('div.sk.w2'), h('div.sk.w3')));
        return;
      }
      const vs = D().verses(b, c);
      const ops = D().chapterDiff(b, c);
      const changed = new Set();
      let touched = 0;
      for (const o of ops) { if (o.t !== 'del') changed.add(o.b); touched += 1; }
      const notes = notesFor(b, c);
      const noteVerses = new Set(notes.map((n) => n.v));

      host.appendChild(chapterHead(b, c, touched));
      const ob = onboardingBanner();
      if (ob) host.appendChild(ob);
      for (const s of notesSummary(notes)) {
        host.appendChild(h('div.note-card', { role: 'note' }, icon('warn', 'note-ico'), h('p', h('strong', t('Стихи {v}. ', { v: s.verses })), s.text)));
      }

      const body = h('div.verses', { lang: 'hy' });
      vs.forEach((text, i) => {
        const v = i + 1;
        const isCh = changed.has(i);
        const row = h('article.verse' + (isCh ? '.edited' : ''), { id: 'v' + v, 'data-v': String(v), tabindex: '0', 'aria-label': t('Стих {n}', { n: v }) + (isCh ? ', ' + t('изменён') : '') },
          h('span.vn', { 'aria-hidden': 'true' }, String(v)),
          h('div.vbody', h('p.vtext', text),
            (isCh || noteVerses.has(v)) ? h('span.vflags', isCh ? h('span.vflag.edit', t('изменён')) : null, noteVerses.has(v) ? h('span.vflag.warn', { title: t('Сверить с печатной Библией') }, icon('warn'), t('сверить')) : null) : null));
        body.appendChild(row);
      });
      host.appendChild(body);
      host.appendChild(h('p.ch-end', vs.length === 0 ? '' : num(vs.length, 'стих', 'стиха', 'стихов') + ' · ' + t('конец главы')));

      this.applySelection();
      if (opts && opts.keepScroll) window.scrollTo(0, y);
    },

    /** Shows the action bar under the selected verse (only that verse changes in the DOM). */
    applySelection() {
      const host = this.host || (this.host = document.getElementById('reader'));
      host.querySelectorAll('.verse.sel').forEach((n) => { n.classList.remove('sel'); const bar = n.querySelector('.vbar'); if (bar) bar.remove(); n.removeAttribute('aria-current'); });
      const { b, c, sel } = app().state;
      if (!sel || !D().isLoaded(b)) return;
      const row = host.querySelector('#v' + sel);
      if (!row) return;
      row.classList.add('sel');
      row.setAttribute('aria-current', 'true');
      row.querySelector('.vbody').appendChild(buildBar(b, c, sel, D().verses(b, c)[sel - 1]));
    },

    flash(v) {
      const row = document.getElementById('v' + v);
      if (!row) return;
      row.classList.remove('flash');
      void row.offsetWidth;
      row.classList.add('flash');
      setTimeout(() => row.classList.remove('flash'), 2200);
    },

    scrollToVerse(v, smooth) {
      const row = document.getElementById('v' + v);
      if (row) row.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
    },

    /** Wires taps once. */
    init() {
      const host = this.host = document.getElementById('reader');
      host.addEventListener('click', (e) => {
        const row = e.target.closest('.verse');
        if (!row || e.target.closest('.vbar')) return;
        const sel = window.getSelection && window.getSelection();
        if (sel && !sel.isCollapsed && row.contains(sel.anchorNode) && String(sel).trim()) return;   // the reader is selecting text
        const v = Number(row.dataset.v);
        app().state.sel = app().state.sel === v ? 0 : v;
        this.applySelection();
      });
      host.addEventListener('dblclick', (e) => {
        const row = e.target.closest('.verse');
        if (!row || e.target.closest('.vbar')) return;
        app().openEditor(app().state.b, app().state.c, Number(row.dataset.v));
      });
      host.addEventListener('keydown', (e) => {
        const row = e.target.closest && e.target.closest('.verse');
        if (!row || e.target !== row) return;
        const v = Number(row.dataset.v);
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (app().state.sel === v && e.key === 'Enter') app().openEditor(app().state.b, app().state.c, v);
          else { app().state.sel = v; this.applySelection(); }
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          const n = document.getElementById('v' + (v + (e.key === 'ArrowDown' ? 1 : -1)));
          if (n) n.focus();
        }
      });
    },
  };

  AB.viewNav = { buildNavigator };
  AB.reader = reader;
})();
