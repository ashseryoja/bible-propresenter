/*
 * Where the edits live. Only what the reader changed is stored — the base text ships with the page.
 *   chapters: Map  "book:chapter" -> array of verse strings (the whole edited chapter)
 *   meta:     { name, abbr, slotAbbr, bookNames:{idx:name}, exportedAt }
 * LocalStore keeps them in this browser (IndexedDB, then localStorage, then memory).
 * CloudStore keeps them in the artifact's private per-viewer area of the `db` capability, so they follow
 * the person to their other devices.
 */
(function () {
  'use strict';
  const AB = (globalThis.AB = globalThis.AB || {});

  const IDB_NAME = 'ararat-bible-edits';

  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB is not available')); return; }
      let req;
      try { req = indexedDB.open(IDB_NAME, 1); } catch (e) { reject(e); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore('chapters', { keyPath: 'key' });
        db.createObjectStore('meta', { keyPath: 'k' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB is blocked'));
    });
  }

  function idbTx(db, storeName, mode, fn) {
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const s = t.objectStore(storeName);
      let result;
      const req = fn(s);
      if (req) req.onsuccess = () => { result = req.result; };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('transaction aborted'));
    });
  }

  class LocalStore {
    constructor() {
      this.kind = 'local';
      this.persistent = false;
      this.db = null;
      this.useLs = false;
      this.onStatus = () => {};
      this.onRemote = null;
    }

    async init() {
      const chapters = new Map();
      let meta = {};
      try {
        this.db = await idbOpen();
        const rows = (await idbTx(this.db, 'chapters', 'readonly', (s) => s.getAll())) || [];
        for (const r of rows) if (r && r.key && Array.isArray(r.verses)) chapters.set(r.key, r.verses);
        const m = await idbTx(this.db, 'meta', 'readonly', (s) => s.get('meta'));
        if (m && m.value) meta = m.value;
        this.persistent = true;
      } catch (e) {
        this.db = null;
        try {
          const raw = AB.platform.safeStorage.get('ab.edits', null);
          if (raw) {
            for (const [k, v] of Object.entries(raw.chapters || {})) if (Array.isArray(v)) chapters.set(k, v);
            meta = raw.meta || {};
          }
          this.useLs = AB.platform.safeStorage.set('ab.probe', 1);
          this.persistent = this.useLs;
        } catch (e2) { this.persistent = false; }
      }
      this.mem = { chapters: new Map(chapters), meta: Object.assign({}, meta) };
      return { chapters, meta };
    }

    _persistLs() {
      const chapters = {};
      for (const [k, v] of this.mem.chapters) chapters[k] = v;
      const ok = AB.platform.safeStorage.set('ab.edits', { chapters, meta: this.mem.meta });
      this.persistent = ok;
      if (!ok) this.onStatus('error');
    }

    async putChapter(key, verses) {
      if (verses) this.mem.chapters.set(key, verses); else this.mem.chapters.delete(key);
      try {
        if (this.db) {
          await idbTx(this.db, 'chapters', 'readwrite', (s) => (verses ? s.put({ key, verses }) : s.delete(key)));
        } else if (this.useLs) this._persistLs();
        this.onStatus('saved');
      } catch (e) {
        this.onStatus('error');
      }
    }

    async putMeta(meta) {
      this.mem.meta = Object.assign({}, meta);
      try {
        if (this.db) await idbTx(this.db, 'meta', 'readwrite', (s) => s.put({ k: 'meta', value: meta }));
        else if (this.useLs) this._persistLs();
        this.onStatus('saved');
      } catch (e) {
        this.onStatus('error');
      }
    }

    async clear() {
      this.mem = { chapters: new Map(), meta: {} };
      try {
        if (this.db) {
          await idbTx(this.db, 'chapters', 'readwrite', (s) => s.clear());
          await idbTx(this.db, 'meta', 'readwrite', (s) => s.clear());
        } else if (this.useLs) AB.platform.safeStorage.remove('ab.edits');
      } catch (e) { this.onStatus('error'); }
    }
  }

  class CloudStore {
    constructor(db, uid) {
      this.kind = 'cloud';
      this.persistent = true;
      this.col = db.collection('data/users/' + uid);
      this.pending = new Map();
      this.stamps = new Map();
      this.timer = null;
      this.flushing = false;
      this.onStatus = () => {};
      this.onRemote = null;
    }

    docId(key) { return 'c_' + key.replace(':', '_'); }

    async init() {
      const snap = await this.col.get();
      const chapters = new Map();
      let meta = {};
      snap.docs.forEach((d) => {
        const data = d.data();
        if (!data) return;
        if (d.id === 'meta') { meta = data.meta || {}; this.stamps.set('meta', data.t || 0); }
        else if (data.k && Array.isArray(data.verses)) { chapters.set(data.k, data.verses.slice()); this.stamps.set(data.k, data.t || 0); }
      });
      this.unsub = this.col.onSnapshot((s) => this._remote(s), () => {});
      return { chapters, meta };
    }

    _remote(snap) {
      if (!this.onRemote) return;
      snap.docChanges().forEach((ch) => {
        if (ch.doc.metadata && ch.doc.metadata.hasPendingWrites) return;
        const id = ch.doc.id;
        const data = ch.doc.data();
        if (id === 'meta') {
          if (data && (data.t || 0) > (this.stamps.get('meta') || 0) && !this.pending.has('meta')) {
            this.stamps.set('meta', data.t || 0);
            this.onRemote({ type: 'meta', meta: data.meta || {} });
          }
          return;
        }
        const key = data && data.k;
        if (ch.type === 'removed') {
          const k = 'c' === id[0] ? id.slice(2).replace('_', ':') : null;
          if (k && !this.pending.has(id)) { this.stamps.set(k, Date.now()); this.onRemote({ type: 'chapter', key: k, verses: null }); }
          return;
        }
        if (!key || !Array.isArray(data.verses)) return;
        if (this.pending.has(id)) return;
        if ((data.t || 0) <= (this.stamps.get(key) || 0)) return;
        this.stamps.set(key, data.t || 0);
        this.onRemote({ type: 'chapter', key, verses: data.verses.slice() });
      });
    }

    _schedule() {
      if (this.timer) clearTimeout(this.timer);
      this.timer = setTimeout(() => this._flush(), 700);
    }

    async _flush() {
      if (this.flushing) return;
      this.flushing = true;
      this.onStatus('saving');
      let failed = false;
      try {
        while (this.pending.size) {
          const [id, job] = this.pending.entries().next().value;
          this.pending.delete(id);
          try {
            const ref = this.col.doc(id);
            if (job.remove) await ref.delete();
            else if (id === 'meta') await ref.set({ meta: job.meta, t: job.t });
            else await ref.set({ k: job.key, verses: job.verses, t: job.t });
          } catch (e) {
            failed = true;
            if (e && e.code === 'unavailable') { this.pending.set(id, job); await new Promise((r) => setTimeout(r, 1500)); }
            else if (!this.pending.has(id)) this.pending.set(id, job);
            if (e && e.code !== 'unavailable') break;
          }
        }
      } finally {
        this.flushing = false;
        this.onStatus(failed ? 'error' : 'saved');
        if (failed && this.pending.size) this._schedule();
      }
    }

    async putChapter(key, verses) {
      const t = Date.now();
      this.stamps.set(key, t);
      const id = this.docId(key);
      this.pending.set(id, verses ? { key, verses, t } : { key, remove: true, t });
      this.onStatus('saving');
      this._schedule();
    }

    async putMeta(meta) {
      const t = Date.now();
      this.stamps.set('meta', t);
      this.pending.set('meta', { meta, t });
      this.onStatus('saving');
      this._schedule();
    }

    async clear() {
      this.pending.clear();
      const snap = await this.col.get();
      this.onStatus('saving');
      try {
        for (const d of snap.docs) await this.col.doc(d.id).delete();
        this.onStatus('saved');
      } catch (e) { this.onStatus('error'); }
    }

    async flushNow() {
      if (this.timer) clearTimeout(this.timer);
      await this._flush();
    }
  }

  /** Everybody edits one shared text (Firebase) when the page is configured for it and can reach it. */
  async function createShared() {
    const cfg = AB.config && AB.config.firebase;
    if (!cfg || !AB.FirebaseStore || AB.platform.hosted || location.protocol === 'file:') return null;
    try {
      const store = new AB.FirebaseStore(cfg);
      const loaded = await store.init();
      // edits made on this device before the shared version existed: offered to the reader once
      if (!AB.platform.safeStorage.get('ab.leftoversHandled', false)) {
        try {
          const local = new LocalStore();
          const mine = await local.init();
          if (mine.chapters.size) store.leftovers = { chapters: mine.chapters, local };
        } catch (e) { /* nothing to offer */ }
      }
      return { store, loaded };
    } catch (e) {
      console.warn('The shared version is not reachable, working on this device only.', e);
      AB.store.sharedError = e;
      return null;
    }
  }

  /** Chooses the shared store, else the cloud store when this view has `db` + `user`, else the browser store. */
  async function create() {
    await AB.platform.ready();
    const shared = await createShared();
    if (shared) return shared;
    try {
      const db = await AB.platform.cap('db');
      const user = await AB.platform.cap('user');
      if (db && user) {
        const uid = await user.id();
        if (uid) {
          const store = new CloudStore(db, uid);
          // a consent prompt or a stalled connection must not keep the page from opening
          const loaded = await Promise.race([store.init(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 15000))]);
          return { store, loaded };
        }
      }
    } catch (e) { /* fall back to the local store */ }
    const store = new LocalStore();
    const loaded = await store.init();
    return { store, loaded };
  }

  AB.store = { create, LocalStore, CloudStore };
})();
