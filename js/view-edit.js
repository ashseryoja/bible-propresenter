/*
 * Verse editor (a bottom sheet on the phone, a dialog on wide screens) and the "more" list of verse actions:
 * insert after, merge with next, split, move to the neighbouring chapter, delete, restore the original.
 */
(function () {
  'use strict';
  const AB = (globalThis.AB = globalThis.AB || {});
  const { h, icon } = AB.ui;
  const { t } = AB.i18n;
  const D = () => AB.Data;
  const app = () => AB.app;

  const MAX_BYTES = 3800;            // same limit the exporter enforces
  const WARN_BYTES = 3300;
  const MARKS = [
    ['։', t('точка')], ['՝', t('запятая')], ['՞', t('вопрос')], ['՜', t('восклицание')], ['՛', t('ударение')],
    ['եւ', t('«ев»')], ['ու', t('«у»')],
  ];
  const enc = new TextEncoder();

  /** What this verse was in the delivered text: {kind:'same'|'changed'|'new', text}. */
  function origFor(b, c, v) {
    const cur = D().verses(b, c);
    if (!D().isEdited(b, c)) return { kind: 'same', text: cur[v - 1] };
    for (const o of D().chapterDiff(b, c)) {
      if (o.t !== 'del' && o.b === v - 1) return o.t === 'chg' ? { kind: 'changed', text: D().baseVerses(b, c)[o.a] } : { kind: 'new', text: null };
    }
    return { kind: 'same', text: cur[v - 1] };
  }

  const refLabel = (b, c, v) => AB.index.books[b - 1].ru + ' ' + c + ':' + v;

  // ---- verse actions ---------------------------------------------------------------------------------------------

  function opsFor(b, c, v, fromEditor) {
    const vs = D().verses(b, c);
    const n = vs.length;
    const rows = [];
    rows.push({ id: 'insert', ico: 'plus', label: t('Вставить новый стих после этого'), desc: t('Следующие стихи сдвинутся на один номер.') });
    if (v < n) rows.push({ id: 'merge', ico: 'merge', label: t('Объединить со следующим стихом'), desc: t('Стихи {a} и {b} станут одним.', { a: v, b: v + 1 }) });
    if (!fromEditor) rows.push({ id: 'split', ico: 'split', label: t('Разделить на два стиха'), desc: t('Откроется редактор: поставьте курсор и нажмите «Разделить по курсору».') });
    if (v === 1 && c > 1 && n > 1) rows.push({ id: 'toPrev', ico: 'arrowLeft', label: t('Перенести в предыдущую главу'), desc: t('Станет последним стихом главы {c}.', { c: c - 1 }) });
    if (v === n && c < D().chapterCount(b) && n > 1) rows.push({ id: 'toNext', ico: 'arrowRight', label: t('Перенести в следующую главу'), desc: t('Станет первым стихом главы {c}.', { c: c + 1 }) });
    if (origFor(b, c, v).kind === 'changed' && D().baseVerses(b, c).length === n) rows.push({ id: 'revert', ico: 'reset', label: t('Вернуть исходный текст'), desc: t('Стих станет таким, каким он был в модуле.') });
    rows.push({ id: 'delete', ico: 'trash', danger: true, disabled: n <= 1, label: t('Удалить стих'), desc: n <= 1 ? t('В главе должен остаться хотя бы один стих.') : t('Следующие стихи сдвинутся на один номер. Действие можно отменить.') });
    return rows;
  }

  /** Runs one action. Returns {message, sel?, reopen?} or null when nothing happened. */
  function runOp(id, b, c, v) {
    switch (id) {
      case 'merge': return D().mergeWithNext(b, c, v) ? { message: t('Стихи {a} и {b} объединены', { a: v, b: v + 1 }), sel: v } : null;
      case 'delete': return D().deleteVerse(b, c, v) ? { message: t('Стих {n} удалён', { n: v }), sel: Math.min(v, D().verses(b, c).length) } : null;
      case 'toPrev': return D().moveFirstToPrev(b, c) ? { message: t('Стих перенесён в главу {c}', { c: c - 1 }), goto: { b, c: c - 1, v: D().verses(b, c - 1).length } } : null;
      case 'toNext': return D().moveLastToNext(b, c) ? { message: t('Стих перенесён в главу {c}', { c: c + 1 }), goto: { b, c: c + 1, v: 1 } } : null;
      case 'revert': return D().revertVerse(b, c, v) ? { message: t('Исходный текст возвращён'), sel: v } : null;
      default: return null;
    }
  }

  /**
   * The "more" list.
   * @param {{fromEditor?:boolean, prepare?:()=>void, done?:()=>void}} [o]  prepare saves an unsaved draft first
   */
  function openOps(b, c, v, o) {
    o = o || {};
    if (app().locked) { AB.ui.toast(t('Правки сейчас закрыты владельцем сайта.'), { kind: 'warn' }); return null; }
    const body = h('div.ops');
    const sheet = AB.ui.openSheet({ title: t('Стих {n}', { n: v }), subtitle: D().bookName(b) + ' ' + c + ':' + v, className: 'compact', body });
    for (const r of opsFor(b, c, v, o.fromEditor)) {
      const btn = h('button.op' + (r.danger ? '.danger' : ''), { type: 'button', disabled: r.disabled, onclick: () => {
        if (o.prepare && o.prepare() === false) return;
        sheet.close();
        if (r.id === 'insert') { if (o.done) o.done(); app().openEditor(b, c, v, { mode: 'new' }); return; }
        if (r.id === 'split') { app().openEditor(b, c, v, { splitHint: true }); return; }
        const res = runOp(r.id, b, c, v);
        if (o.done) o.done();
        if (!res) { AB.ui.toast(t('Не получилось выполнить действие.'), { kind: 'warn' }); return; }
        if (res.goto) app().goTo(res.goto.b, res.goto.c, res.goto.v, { select: true });
        else if (res.sel) { app().state.sel = res.sel; AB.reader.applySelection(); }
        app().afterEdit(res.message);
      } },
      icon(r.ico, 'op-ico'), h('span.op-text', h('span.op-label', r.label), h('span.op-desc', r.desc)));
      body.appendChild(btn);
    }
    return sheet;
  }

  // ---- editor ----------------------------------------------------------------------------------------------------

  /**
   * @param {{mode?:'edit'|'new', splitHint?:boolean}} [o]  'new' = a new verse after v
   */
  function openEditor(b, c, v, o) {
    o = o || {};
    if (!D().isLoaded(b)) return;
    const cur = { b, c, v, mode: o.mode === 'new' ? 'new' : 'edit' };
    let initial = '';

    const ta = h('textarea.ed-text', { id: 'verse-text', lang: 'hy', spellcheck: 'false', autocapitalize: 'off', autocorrect: 'off', autocomplete: 'off', rows: '4', enterkeyhint: 'done', 'aria-label': t('Текст стиха') });
    const counter = h('span.ed-count');
    const msg = h('p.ed-msg', { role: 'status' });
    msg.hidden = true;
    const prevBtn = h('button.icon-btn', { type: 'button', 'aria-label': t('Предыдущий стих'), onclick: () => step(-1) }, icon('left'));
    const nextBtn = h('button.icon-btn', { type: 'button', 'aria-label': t('Следующий стих'), onclick: () => step(1) }, icon('right'));
    const posLabel = h('span.ed-pos');
    const nav = h('div.ed-nav', prevBtn, posLabel, nextBtn);
    const origBox = h('div.orig');
    const marks = h('div.marks', { role: 'group', 'aria-label': t('Армянские знаки') });
    for (const [ch, name] of MARKS) {
      const isMod = ch.length === 1 && ch >= '\u055b' && ch <= '\u055e';
      const b2 = h('button.mark', { type: 'button', title: name, 'aria-label': name + ' ' + ch }, isMod ? h('span.mk-base', '\u25cc') : null, ch);
      b2.addEventListener('mousedown', (e) => e.preventDefault());          // keep the cursor and the keyboard
      b2.addEventListener('click', () => { insertAtCursor(ch); });
      marks.appendChild(b2);
    }
    const splitBtn = h('button.btn.compact', { type: 'button', onclick: doSplit }, icon('split'), t('Разделить по курсору'));
    const moreBtn = h('button.btn.compact', { type: 'button', 'aria-haspopup': 'dialog', onclick: () => {
      openOps(cur.b, cur.c, cur.v, { fromEditor: true, prepare: saveDraftQuietly, done: () => sheet.close() });
    } }, icon('more'), t('Ещё'));
    const actions = h('div.ed-actions', splitBtn, moreBtn);
    const remoteBox = h('div.remote-box', { role: 'alert' });
    remoteBox.hidden = true;
    const body = h('div.editor', nav, remoteBox, h('div.ed-field', ta, h('div.ed-meta', counter)), marks, msg, origBox, actions);

    const saveBtn = h('button.btn.primary.wide', { type: 'button', onclick: () => save() }, icon('check'), t('Сохранить'));
    const cancelBtn = h('button.btn.wide', { type: 'button', onclick: () => sheet.requestClose() }, t('Отмена'));
    const footNormal = h('div.foot-row', cancelBtn, saveBtn);

    const sheet = AB.ui.openSheet({
      title: '', className: 'editor-sheet', body, footer: footNormal, focus: () => ta,
      beforeClose: () => { if (!dirty()) return true; askDiscard(); return false; },
      onClose: () => { offRemote(); app().afterEditorClose(cur.b, cur.c, cur.v); },
    });
    // somebody else changed this verse while it is open here
    const offRemote = D().onChange((e) => { if (e && e.type === 'remote' && (e.keys || []).includes(cur.b + ':' + cur.c)) checkRemote(); });

    const norm = (s) => D().cleanVerse(s);
    const dirty = () => (cur.mode === 'new' ? !!norm(ta.value) : norm(ta.value) !== norm(initial));

    function say(text, kind) { msg.textContent = text || ''; msg.className = 'ed-msg' + (kind ? ' ' + kind : ''); msg.hidden = !text; }

    function askDiscard() {
      const row = h('div.foot-row.discard', h('p.discard-text', t('Есть несохранённые правки. Отбросить их?')),
        h('div.foot-row', h('button.btn.wide', { type: 'button', onclick: () => { sheet.setFooter(footNormal); ta.focus(); } }, t('Продолжить править')),
          h('button.btn.danger.wide', { type: 'button', onclick: () => sheet.close() }, t('Отбросить'))));
      sheet.setFooter(row);
    }

    function updateMeta() {
      const bytes = enc.encode(norm(ta.value)).length;
      const chars = norm(ta.value).length;
      counter.textContent = t('{n} знаков', { n: chars });
      counter.className = 'ed-count' + (bytes > MAX_BYTES ? ' bad' : bytes > WARN_BYTES ? ' warn' : '');
      const tooLong = bytes > MAX_BYTES;
      saveBtn.disabled = tooLong || (cur.mode === 'edit' && !dirty()) || (cur.mode === 'new' && !norm(ta.value));
      if (tooLong) say(t('Стих слишком длинный для базы ProPresenter (около 1900 знаков). Разделите его.'), 'bad');
      else if (msg.classList.contains('bad')) say('');
    }

    function autosize() {
      ta.style.height = 'auto';
      ta.style.height = Math.min(ta.scrollHeight + 2, Math.round((window.visualViewport ? window.visualViewport.height : window.innerHeight) * 0.42)) + 'px';
    }

    function insertAtCursor(text) {
      ta.focus();
      const s = ta.selectionStart, e = ta.selectionEnd;
      ta.setRangeText(text, s, e, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function renderOrig() {
      AB.ui.clear(origBox);
      origBox.hidden = true;
      if (cur.mode === 'new') return;
      const o2 = origFor(cur.b, cur.c, cur.v);
      if (o2.kind === 'same') return;
      origBox.hidden = false;
      if (o2.kind === 'new') { origBox.appendChild(h('p.orig-note', icon('info'), t('Это добавленный стих — в исходном тексте его нет.'))); return; }
      const same = norm(ta.value) === norm(o2.text);
      origBox.appendChild(h('div.orig-head', h('span.orig-title', t('Исходный текст')),
        h('button.btn.compact.quiet', { type: 'button', disabled: same, onclick: () => { ta.value = o2.text; ta.dispatchEvent(new Event('input', { bubbles: true })); ta.focus(); } }, icon('reset'), t('Вернуть'))));
      origBox.appendChild(h('p.orig-text', { lang: 'hy' }, o2.text));
    }

    function checkRemote() {
      if (cur.mode !== 'edit' || sheet.closed) return;
      const now = D().verses(cur.b, cur.c)[cur.v - 1];
      if (now === initial) { remoteBox.hidden = true; return; }
      AB.ui.clear(remoteBox);
      remoteBox.hidden = false;
      if (now === undefined) {
        remoteBox.append(h('p', h('strong', t('Этот стих удалил другой человек. ')), t('Сохранить нельзя. Скопируйте свой текст, если он нужен, и закройте окно.')), h('button.btn.compact', { type: 'button', onclick: () => sheet.close() }, t('Закрыть')));
        saveBtn.disabled = true;
        return;
      }
      remoteBox.append(
        h('p', h('strong', t('Пока вы правили, этот стих изменил другой человек. ')), t('Сейчас в общей версии:')),
        h('p.remote-text', { lang: 'hy' }, now),
        h('div.btn-row', h('button.btn.compact', { type: 'button', onclick: () => { initial = now; ta.value = now; remoteBox.hidden = true; updateMeta(); autosize(); renderOrig(); } }, t('Взять новый текст')),
          h('button.btn.compact', { type: 'button', onclick: () => { initial = now; remoteBox.hidden = true; updateMeta(); renderOrig(); } }, t('Оставить мой'))));
    }

    function load() {
      remoteBox.hidden = true;
      const vs = D().verses(cur.b, cur.c);
      if (cur.mode === 'new') {
        initial = '';
        sheet.setTitle(t('Новый стих'), D().bookName(cur.b) + ' ' + cur.c + ':' + (cur.v + 1));
        posLabel.textContent = t('после стиха {n}', { n: cur.v });
        prevBtn.hidden = nextBtn.hidden = true;
        splitBtn.hidden = moreBtn.hidden = true;
      } else {
        initial = vs[cur.v - 1] || '';
        sheet.setTitle(refLabel(cur.b, cur.c, cur.v), D().bookName(cur.b) + ' ' + cur.c + ':' + cur.v);
        posLabel.textContent = t('Стих {n} из {m}', { n: cur.v, m: vs.length });
        prevBtn.hidden = nextBtn.hidden = false;
        prevBtn.disabled = cur.v === 1 && cur.c === 1;
        nextBtn.disabled = cur.v === vs.length && cur.c === D().chapterCount(cur.b);
        splitBtn.hidden = moreBtn.hidden = false;
      }
      ta.value = initial;
      say(o.splitHint ? t('Поставьте курсор там, где стих должен закончиться, и нажмите «Разделить по курсору».') : '', o.splitHint ? 'info' : '');
      o.splitHint = false;
      renderOrig();
      updateMeta();
      autosize();
    }

    /** Saves a changed draft as its own step. Returns false if the draft cannot be saved. */
    function saveDraftQuietly() {
      if (cur.mode === 'new') {
        if (!norm(ta.value)) return true;
        return false;
      }
      if (!dirty()) return true;
      const text = norm(ta.value);
      if (!text) { say(t('Стих не может быть пустым. Чтобы убрать стих, выберите «Ещё» → «Удалить стих».'), 'bad'); return false; }
      if (enc.encode(text).length > MAX_BYTES) return false;
      D().setVerse(cur.b, cur.c, cur.v, text);
      initial = text;
      return true;
    }

    function step(d) {
      if (cur.mode !== 'edit') return;
      if (!saveDraftQuietly()) return;
      let { c, v } = cur;
      const n = D().verses(cur.b, c).length;
      v += d;
      if (v < 1) { if (c === 1) return; c -= 1; v = D().verses(cur.b, c).length; }
      else if (v > n) { if (c === D().chapterCount(cur.b)) return; c += 1; v = 1; }
      cur.c = c; cur.v = v;
      app().goTo(cur.b, c, v, { select: true, quiet: true });
      load();
      if (!window.matchMedia('(pointer: coarse)').matches) ta.focus();
    }

    function save() {
      if (!remoteBox.hidden) { say(t('Сначала выберите: взять новый текст или оставить свой.'), 'warn'); return; }
      const text = norm(ta.value);
      if (!text) { say(t('Стих не может быть пустым. Чтобы убрать стих, выберите «Ещё» → «Удалить стих».'), 'bad'); ta.focus(); return; }
      if (enc.encode(text).length > MAX_BYTES) return;
      if (cur.mode === 'new') {
        D().insertAfter(cur.b, cur.c, cur.v, text);
        cur.v += 1;
        cur.mode = 'edit';
        initial = text;
        sheet.close();
        app().state.sel = cur.v;
        AB.reader.applySelection();
        app().afterEdit(t('Стих добавлен'));
        return;
      }
      if (text !== norm(initial)) {
        D().setVerse(cur.b, cur.c, cur.v, text);
        initial = text;
        sheet.close();
        app().afterEdit(t('Стих сохранён'));
      } else sheet.close();
    }

    function doSplit() {
      if (cur.mode !== 'edit') return;
      if (!remoteBox.hidden) { say(t('Сначала выберите: взять новый текст или оставить свой.'), 'warn'); return; }
      const pos = ta.selectionStart;
      const left = ta.value.slice(0, pos), right = ta.value.slice(pos);
      if (!norm(left) || !norm(right)) { say(t('Поставьте курсор внутри текста, там, где стих должен закончиться.'), 'warn'); ta.focus(); return; }
      if (D().splitAt(cur.b, cur.c, cur.v, left, right)) {
        initial = norm(ta.value);
        sheet.close();
        app().state.sel = cur.v;
        AB.reader.applySelection();
        app().afterEdit(t('Стих {n} разделён на два', { n: cur.v }));
      }
    }

    ta.addEventListener('input', () => { if (msg.classList.contains('bad') || msg.classList.contains('warn') || msg.classList.contains('info')) say(''); updateMeta(); autosize(); renderOrig(); });
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (e.ctrlKey || e.metaKey) { if (!saveBtn.disabled) save(); }
        else if (window.matchMedia('(pointer: coarse)').matches) ta.blur();
      } else if (e.altKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1); }
    });
    ta.addEventListener('focus', () => setTimeout(() => { try { ta.scrollIntoView({ block: 'nearest' }); } catch (e) { /* ignore */ } }, 250));
    ta.addEventListener('paste', () => setTimeout(() => { ta.value = ta.value.replace(/\s*\n+\s*/g, ' '); updateMeta(); autosize(); }, 0));

    load();
    ta.setSelectionRange(ta.value.length, ta.value.length);
    return sheet;
  }

  AB.viewEdit = { openEditor, openOps, origFor };
})();
