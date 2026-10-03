/*
 * Small UI toolkit: DOM helper, icons, bottom sheets / dialogs, toasts, popover menu.
 * No framework. Text is always set with textContent, never innerHTML.
 */
(function () {
  'use strict';
  const AB = (globalThis.AB = globalThis.AB || {});
  const t = AB.t;

  // ---- DOM helper ------------------------------------------------------------------------------------------------

  /** h('button.btn.primary', {onclick, disabled:true}, 'text', childNode, [more]) */
  function h(sel, attrs, ...kids) {
    const m = /^([a-z0-9]+)?((?:\.[\w-]+)*)$/i.exec(sel);
    const el = document.createElement((m && m[1]) || 'div');
    if (m && m[2]) el.className = m[2].slice(1).replace(/\./g, ' ');
    if (attrs != null && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) { kids.unshift(attrs); attrs = null; }
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (v === false || v == null) continue;
        if (k === 'class') el.className += (el.className ? ' ' : '') + v;
        else if (k === 'style') el.style.cssText = v;
        else if (k === 'value' || k === 'checked' || k === 'indeterminate') el[k] = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    append(el, kids);
    return el;
  }
  function append(el, kids) {
    for (const k of kids) {
      if (k == null || k === false) continue;
      if (Array.isArray(k)) append(el, k);
      else el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    }
  }
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  const frag = (...kids) => { const f = document.createDocumentFragment(); append(f, kids); return f; };

  // ---- icons (Lucide-style strokes) ------------------------------------------------------------------------------

  const ICONS = {
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" x2="12" y1="15" y2="3"/>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>',
    more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="m18 15-6-6-6 6"/>',
    left: '<path d="m15 18-6-6 6-6"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
    pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
    copy: '<rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    checkCircle: '<circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/>',
    checkDone: '<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/><path d="m8.3 12.4 2.5 2.5 5-5.2" style="stroke:#fff" stroke-width="2.6"/>',
    warn: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    split: '<path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/>',
    merge: '<path d="m8 6 4-4 4 4"/><path d="M12 2v10.3a4 4 0 0 1-1.172 2.872L4 22"/><path d="m20 22-5-5"/>',
    arrowRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    arrowLeft: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    reset: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
    fileDown: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M12 18v-6"/><path d="m9 15 3 3 3-3"/>',
    type: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" x2="15" y1="20" y2="20"/><line x1="12" x2="12" y1="4" y2="20"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    languages: '<path d="m5 8 6 6"/><path d="m4 14 6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="m22 22-5-10-5 10"/><path d="M14 18h6"/>',
    save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7"/><path d="M7 3v4a1 1 0 0 0 1 1h7"/>',
    list: '<path d="M8 6h13"/><path d="M8 12h13"/><path d="M8 18h13"/><path d="M3 6h.01"/><path d="M3 12h.01"/><path d="M3 18h.01"/>',
  };
  const iconCache = {};
  function icon(name, cls) {
    let tpl = iconCache[name];
    if (!tpl) {
      const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      s.setAttribute('viewBox', '0 0 24 24');
      s.setAttribute('fill', 'none');
      s.setAttribute('stroke', 'currentColor');
      s.setAttribute('stroke-width', '2');
      s.setAttribute('stroke-linecap', 'round');
      s.setAttribute('stroke-linejoin', 'round');
      s.setAttribute('aria-hidden', 'true');
      s.setAttribute('focusable', 'false');
      s.innerHTML = ICONS[name] || '';
      tpl = iconCache[name] = s;
    }
    const c = tpl.cloneNode(true);
    c.setAttribute('class', 'ico' + (cls ? ' ' + cls : ''));
    return c;
  }

  // ---- history (so the phone's back button closes a sheet) --------------------------------------------------------

  let ignorePop = 0;
  const idleQueue = [];
  function whenIdle(fn) { if (ignorePop === 0) fn(); else idleQueue.push(fn); }
  function flushIdle() { while (ignorePop === 0 && idleQueue.length) idleQueue.shift()(); }

  function pushHist() {
    try { history.pushState({ abSheet: true }, ''); return true; } catch (e) { return false; }
  }
  function popHist() {
    try { ignorePop += 1; history.back(); return true; } catch (e) { ignorePop = Math.max(0, ignorePop - 1); return false; }
  }

  // ---- sheets ----------------------------------------------------------------------------------------------------

  const stack = [];
  let uid = 0;

  function overlayRoot() {
    let o = document.getElementById('overlay');
    if (!o) { o = h('div#overlay'); document.body.appendChild(o); }
    return o;
  }

  let emptyHook = null;
  function applyInert() {
    const app = document.getElementById('app');
    if (app) app.inert = stack.length > 0;
    stack.forEach((s, i) => { s.root.inert = i < stack.length - 1; });
    document.documentElement.classList.toggle('sheet-open', stack.length > 0);
  }

  /**
   * @param {{title:string, subtitle?:string, body:Node, footer?:Node, className?:string, leading?:Node,
   *          beforeClose?:()=>boolean|void, onClose?:()=>void, focus?:Element|(()=>Element)}} o
   * beforeClose returning false keeps the sheet open (the sheet shows its own confirmation).
   */
  function openSheet(o) {
    const id = 'sheet-title-' + (++uid);
    const opener = document.activeElement;
    const titleEl = h('h2.sheet-title', { id }, o.title);
    const subEl = h('p.sheet-sub', o.subtitle || '');
    if (!o.subtitle) subEl.hidden = true;
    const closeBtn = h('button.icon-btn', { type: 'button', 'aria-label': t('Закрыть') }, icon('x'));
    const head = h('header.sheet-head', h('div.grab', { 'aria-hidden': 'true' }), h('div.sheet-head-row', o.leading || null, h('div.sheet-titles', titleEl, subEl), closeBtn));
    const body = h('div.sheet-body', o.body || null);
    const footer = h('footer.sheet-foot', o.footer || null);
    if (!o.footer) footer.hidden = true;
    const panel = h('section.sheet' + (o.className ? '.' + o.className.split(' ').join('.') : ''), { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id, tabindex: '-1' }, head, body, footer);
    const backdrop = h('div.backdrop');
    const root = h('div.sheet-root', backdrop, panel);
    const api = { el: panel, root, body, footer, closed: false, hist: false };

    function finish() {
      if (api.closed) return;
      api.closed = true;
      const i = stack.indexOf(api);
      if (i >= 0) stack.splice(i, 1);
      root.classList.add('closing');
      const done = () => { root.remove(); };
      root.addEventListener('animationend', (e) => { if (e.target === panel || e.target === backdrop) done(); });
      setTimeout(done, 260);
      applyInert();
      if (o.onClose) { try { o.onClose(); } catch (e) { console.error(e); } }
      if (!stack.length && emptyHook) whenIdle(emptyHook);
      if (opener && opener.isConnected && typeof opener.focus === 'function' && !stack.length) { try { opener.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
      else if (stack.length) stack[stack.length - 1].el.focus({ preventScroll: true });
    }

    /** Close from a button, backdrop, Escape or swipe. Returns false when the sheet asked to stay open. */
    api.requestClose = () => {
      if (api.closed) return true;
      if (o.beforeClose && o.beforeClose() === false) return false;
      api.close();
      return true;
    };
    api.close = () => {
      if (api.closed) return;
      const hadHist = api.hist;
      finish();
      if (hadHist) popHist();
    };
    /** The back button already popped our history entry. */
    api.closeFromHistory = () => {
      if (api.closed) return;
      if (o.beforeClose && o.beforeClose() === false) { pushHist(); return; }
      api.hist = false;
      finish();
    };
    api.setTitle = (title, sub) => {
      titleEl.textContent = title;
      subEl.textContent = sub || '';
      subEl.hidden = !sub;
    };
    api.setFooter = (node) => { clear(footer); if (node) { footer.appendChild(node); footer.hidden = false; } else footer.hidden = true; };
    api.top = () => stack[stack.length - 1] === api;

    closeBtn.addEventListener('click', () => api.requestClose());
    backdrop.addEventListener('click', () => api.requestClose());
    enableSwipeToClose(head, panel, api);

    stack.push(api);
    overlayRoot().appendChild(root);
    api.hist = pushHist();
    applyInert();
    const f = typeof o.focus === 'function' ? o.focus() : o.focus;
    try { (f || panel).focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    return api;
  }

  /** Dragging the header down closes a bottom sheet (touch and pen; on narrow screens only). */
  function enableSwipeToClose(head, panel, api) {
    let startY = 0, dy = 0, dragging = false, startT = 0;
    head.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' || e.target.closest('button, input, textarea, a')) return;
      if (!window.matchMedia('(max-width: 719px)').matches) return;
      dragging = true; startY = e.clientY; dy = 0; startT = Date.now();
      try { head.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
      panel.style.transition = 'none';
    });
    head.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      dy = Math.max(0, e.clientY - startY);
      panel.style.transform = 'translateY(' + dy + 'px)';
    });
    const end = () => {
      if (!dragging) return;
      dragging = false;
      panel.style.transition = '';
      const fast = dy > 40 && (Date.now() - startT) < 250;
      if (dy > 110 || fast) { panel.style.transform = ''; api.requestClose(); }
      else panel.style.transform = '';
    };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);
  }

  window.addEventListener('popstate', () => {
    if (ignorePop > 0) { ignorePop -= 1; flushIdle(); return; }
    const top = stack[stack.length - 1];
    if (top) top.closeFromHistory();
  });

  document.addEventListener('keydown', (e) => {
    const top = stack[stack.length - 1];
    if (!top) return;
    if (e.key === 'Escape' && !e.defaultPrevented) {
      if (pop.active) return;
      e.preventDefault();
      top.requestClose();
    } else if (e.key === 'Tab') {
      // keep focus inside the open sheet
      const nodes = [...top.el.querySelectorAll('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])')].filter((n) => !n.disabled && n.offsetParent !== null);
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === top.el)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  // The on-screen keyboard: keep the overlay exactly over the visible part of the page.
  function trackViewport() {
    const vv = window.visualViewport;
    if (!vv) return;
    const set = () => {
      const r = document.documentElement.style;
      r.setProperty('--vv-h', vv.height + 'px');
      r.setProperty('--vv-top', vv.offsetTop + 'px');
      r.setProperty('--vv-left', vv.offsetLeft + 'px');
      r.setProperty('--vv-w', vv.width + 'px');
    };
    vv.addEventListener('resize', set);
    vv.addEventListener('scroll', set);
    set();
  }
  trackViewport();

  // ---- toasts ----------------------------------------------------------------------------------------------------

  let toastTimer = null;
  let toastEl = null;
  function toastHost() {
    let host = document.getElementById('toasts');
    if (!host) { host = h('div#toasts', { role: 'status', 'aria-live': 'polite' }); document.body.appendChild(host); }
    return host;
  }
  /** @param {{action?:string, onAction?:()=>void, duration?:number, kind?:'ok'|'warn'|'error'}} [o] */
  function toast(message, o) {
    o = o || {};
    const host = toastHost();
    dismissToast();
    const el = h('div.toast' + (o.kind ? '.' + o.kind : ''), h('span.toast-text', message));
    if (o.action) {
      el.appendChild(h('button.toast-action', { type: 'button', onclick: () => { dismissToast(); if (o.onAction) o.onAction(); } }, o.action));
    }
    host.appendChild(el);
    toastEl = el;
    toastTimer = setTimeout(dismissToast, o.duration || (o.action ? 8000 : 4500));
    return el;
  }
  function dismissToast() {
    clearTimeout(toastTimer);
    if (toastEl) { toastEl.remove(); toastEl = null; }
  }

  // ---- popover menu ----------------------------------------------------------------------------------------------

  const pop = { active: null };
  function closePopover() {
    if (!pop.active) return;
    const p = pop.active;
    pop.active = null;
    p.el.remove();
    document.removeEventListener('pointerdown', p.onDown, true);
    document.removeEventListener('keydown', p.onKey, true);
    window.removeEventListener('resize', closePopover);
    if (p.anchor && p.anchor.isConnected) p.anchor.setAttribute('aria-expanded', 'false');
    if (p.restoreFocus && p.anchor && p.anchor.isConnected) { try { p.anchor.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
  }
  function openPopover(anchor, content, o) {
    closePopover();
    const el = h('div.popover', { role: 'menu' }, content);
    document.body.appendChild(el);
    const r = anchor.getBoundingClientRect();
    const w = el.offsetWidth;
    const left = Math.min(Math.max(8, (o && o.align === 'left') ? r.left : r.right - w), window.innerWidth - w - 8);
    el.style.top = Math.round(r.bottom + 6) + 'px';
    el.style.left = Math.round(left) + 'px';
    anchor.setAttribute('aria-expanded', 'true');
    const p = {
      el, anchor, restoreFocus: true,
      onDown: (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) { p.restoreFocus = false; closePopover(); } },
      onKey: (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closePopover(); } },
    };
    pop.active = p;
    document.addEventListener('pointerdown', p.onDown, true);
    document.addEventListener('keydown', p.onKey, true);
    window.addEventListener('resize', closePopover);
    const first = el.querySelector('button:not([disabled])');
    if (first) first.focus({ preventScroll: true });
    return { close: closePopover, el };
  }

  // ---- misc helpers ----------------------------------------------------------------------------------------------

  /** A button that needs a second tap within 3 s ("Сбросить" -> "Точно сбросить?"). */
  function confirmButton(cls, label, confirmLabel, onConfirm, iconName) {
    let armed = false, timer = null;
    const text = h('span', label);
    const btn = h('button' + cls, { type: 'button' }, iconName ? icon(iconName) : null, text);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!armed) {
        armed = true;
        text.textContent = confirmLabel;
        btn.classList.add('armed');
        timer = setTimeout(reset, 3500);
      } else { reset(); onConfirm(); }
    });
    function reset() { armed = false; clearTimeout(timer); text.textContent = label; btn.classList.remove('armed'); }
    btn.addEventListener('blur', reset);
    return btn;
  }

  /** Text with the matched ranges wrapped in <mark>. */
  function highlight(text, ranges, from, to) {
    const out = document.createDocumentFragment();
    let pos = from == null ? 0 : from;
    const end = to == null ? text.length : to;
    for (const [a, b] of ranges) {
      if (b <= pos || a >= end) continue;
      const s = Math.max(a, pos), e = Math.min(b, end);
      if (s > pos) out.appendChild(document.createTextNode(text.slice(pos, s)));
      out.appendChild(h('mark', text.slice(s, e)));
      pos = e;
    }
    if (pos < end) out.appendChild(document.createTextNode(text.slice(pos, end)));
    return out;
  }

  const tick = () => new Promise((r) => setTimeout(r, 30));

  AB.ui = {
    h, clear, frag, icon, openSheet, toast, dismissToast, openPopover, closePopover, confirmButton, highlight, whenIdle, tick,
    setEmptyHook(fn) { emptyHook = fn; },
    get sheetDepth() { return stack.length; },
    get topSheet() { return stack[stack.length - 1] || null; },
  };
})();
