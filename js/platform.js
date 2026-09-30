/*
 * Where the page runs decides how it saves files and where the edits are kept.
 *  - inside the claude.ai viewer: `window.claude.use(...)` gives the `downloads` and `db` capabilities
 *  - anywhere else (opened from disk, any web host): plain browser download and IndexedDB
 */
(function () {
  'use strict';
  const AB = (globalThis.AB = globalThis.AB || {});

  // Evaluated on every use: the viewer may attach `window.claude` a moment after the first script run.
  const isHosted = () => typeof window !== 'undefined' && !!(window.claude && typeof window.claude.use === 'function');
  const caps = {};

  /** Resolves once we know whether the viewer's runtime is there (inside a frame it may show up a moment late). */
  function ready() {
    if (isHosted() || typeof window === 'undefined' || window.top === window) return Promise.resolve(isHosted());
    return new Promise((resolve) => {
      let waited = 0;
      const timer = setInterval(() => {
        waited += 100;
        if (isHosted() || waited >= 1500) { clearInterval(timer); resolve(isHosted()); }
      }, 100);
    });
  }

  function withTimeout(p, ms) {
    return Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(null), ms))]);
  }

  /** Resolves the capability namespace or null (design for absence). */
  async function cap(name) {
    if (!isHosted()) return null;
    if (!(name in caps)) {
      try { caps[name] = await withTimeout(window.claude.use(name), 8000); } catch (e) { caps[name] = null; }
    }
    return caps[name];
  }

  /**
   * Hands a generated file to the viewer.
   * @returns {Promise<{status:'saved'|'declined'|'attempted'}>}
   */
  async function saveFile(filename, bytes, mime) {
    const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    if (isHosted()) {
      const dl = await cap('downloads');
      if (dl) {
        try {
          const r = await dl.save({ filename, data: blob });
          return { status: 'saved' };
        } catch (e) {
          if (e && e.code === 'declined') return { status: 'declined' };
          const err = new Error((e && e.message) || 'Не удалось сохранить файл');
          err.code = e && e.code;
          throw err;
        }
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    return { status: isHosted() ? 'attempted' : 'saved' };
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fall through to the selection fallback */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand && document.execCommand('copy');
      ta.remove();
      return !!ok;
    } catch (e) {
      return false;
    }
  }

  function readFileText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error || new Error('Не удалось прочитать файл'));
      r.readAsText(file, 'utf-8');
    });
  }

  /** localStorage that never throws (private windows, blocked storage). */
  const safeStorage = {
    get(k, fallback) {
      try { const v = localStorage.getItem(k); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
    },
    remove(k) {
      try { localStorage.removeItem(k); } catch (e) { /* ignore */ }
    },
  };

  AB.platform = { get hosted() { return isHosted(); }, ready, cap, saveFile, copyText, readFileText, safeStorage };
})();
