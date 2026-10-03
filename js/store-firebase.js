/*
 * The shared edits: one common version of the text for everybody who opens the site, kept in Firebase Firestore.
 * Nobody has to sign in: every browser gets an anonymous identity, the security rules (firestore.rules) decide what may be written.
 *
 * Firestore layout
 *   chapters/{book}_{chapter}                 { v: [verses] | null (= original text), t: server time, by: name, u: uid }
 *   chapters/{book}_{chapter}/history/{auto}  the same fields, one document per saved version (create-only)
 *   meta/site                                 { bookNames: {idx: name}, t, by, u }      (book titles are shared)
 *   reviews/{book}_{chapter}                  { done: bool, t, by, u }   "this chapter has been read through" (no history)
 *   meta/lock                                 { on: true }  -- set by hand in the Firebase console to freeze editing
 * Export settings (name, abbreviations) and other device-only values stay in this browser.
 *
 * Same interface as the other stores in store.js: init(), putChapter(), putMeta(), onRemote, onStatus.
 */
(function () {
  'use strict';
  const AB = (globalThis.AB = globalThis.AB || {});

  const SDK_BASE = 'https://www.gstatic.com/firebasejs/12.19.0/';
  const ID_RE = /^(\d{1,2})_(\d{1,3})$/;
  const LOCAL_META_KEY = 'ab.localMeta';
  const LOCAL_ONLY = ['name', 'abbr', 'slotAbbr', 'exportedAt'];
  const clean = (s) => String(s).replace(/\s+/g, ' ').trim();

  /** A chapter as it may enter the text: an array of non-empty strings, or null (back to the original). undefined = invalid. */
  function sanitizeVerses(v) {
    if (v === null) return null;
    if (!Array.isArray(v) || !v.length || v.length > 250) return undefined;
    const out = [];
    for (const x of v) {
      if (typeof x !== 'string') return undefined;
      const s = clean(x);
      if (!s) return undefined;
      out.push(s);
    }
    return out;
  }

  const millis = (ts) => (ts && typeof ts.toMillis === 'function' ? ts.toMillis() : 0);

  class FirebaseStore {
    constructor(cfg) {
      this.kind = 'shared';
      this.persistent = true;
      this.cfg = cfg;
      this.onStatus = () => {};
      this.onRemote = null;
      this.onLock = () => {};
      this.locked = false;
      this.pending = 0;
      this.author = '';
      this.uid = '';
      this.stamps = new Map();
      this.ready = false;
    }

    async init() {
      const cfg = this.cfg;
      const base = cfg.sdkBase || SDK_BASE;
      const [appM, authM, fsM] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-auth.js'), import(base + 'firebase-firestore.js')]);
      this.fs = fsM;
      const app = appM.initializeApp(cfg.app);
      const auth = authM.getAuth(app);
      this.auth = auth;
      this.authM = authM;
      if (cfg.emulator) authM.connectAuthEmulator(auth, cfg.emulator.auth, { disableWarnings: true });
      let db;
      try {
        db = fsM.initializeFirestore(app, { localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }) });
      } catch (e) {
        db = fsM.getFirestore(app);            // private windows and old browsers: no offline cache, still works online
      }
      if (cfg.emulator) fsM.connectFirestoreEmulator(db, cfg.emulator.host, cfg.emulator.port);
      this.db = db;

      // sign in in the background: reading needs no identity, only writing does
      this.authReady = (async () => {
        await auth.authStateReady();
        if (!auth.currentUser) await authM.signInAnonymously(auth);
        this.uid = auth.currentUser.uid;
      })();
      this.authReady.catch((e) => { console.warn('anonymous sign-in failed', e); this.onStatus('error'); });

      const chapters = new Map();
      const reviews = new Map();
      let shared = {};
      const answers = await Promise.all([
        this._firstSnapshot(fsM.collection(db, 'chapters'), (snap) => {
          chapters.clear();
          snap.docs.forEach((d) => { const c = this._parse(d); if (c && c.verses) chapters.set(c.key, c.verses); if (c) this.stamps.set(c.key, c.t); });
        }, (snap) => this._chapterChanges(snap)),
        this._firstSnapshot(fsM.doc(db, 'meta', 'site'), (snap) => { shared = this._parseMeta(snap); }, (snap) => {
          if (snap.metadata.hasPendingWrites) return;
          shared = this._parseMeta(snap);
          if (this.onRemote) this.onRemote({ type: 'meta', meta: this._mergeMeta(shared) });
        }),
        this._firstSnapshot(fsM.doc(db, 'meta', 'lock'), (snap) => { this.locked = !!(snap.exists() && snap.data().on === true); }, (snap) => {
          const on = !!(snap.exists() && snap.data().on === true);
          if (on !== this.locked) { this.locked = on; this.onLock(on); }
        }),
        // review marks are optional: a project whose rules do not know the collection yet must still open
        this._firstSnapshot(fsM.collection(db, 'reviews'), (snap) => {
          snap.docs.forEach((d) => { const r = this._parseReview(d); if (r) reviews.set(r.key, r); });
        }, (snap) => this._reviewChanges(snap), (err) => { console.warn('review marks unavailable', err); this.reviewsUnavailable = true; }),
      ]);
      this.sharedMeta = shared;
      this.ready = true;
      this.offlineStart = !answers[0];          // the text below came from this device's cache, the server did not answer yet
      return { chapters, meta: this._mergeMeta(shared), reviews };
    }

    /** Resolves with the first answer from the server (or from the cache when offline / slow), then keeps calling onChange.
     *  The value is true when the server answered. */
    _firstSnapshot(ref, onFirst, onChange, onError) {
      return new Promise((resolve) => {
        let first = true;
        let served = false;
        const finish = () => { if (first) { first = false; clearTimeout(timer); resolve(served); } };
        const timer = setTimeout(finish, 8000);
        this.fs.onSnapshot(ref, { includeMetadataChanges: true }, (snap) => {
          if (first) {
            onFirst(snap);
            served = served || !snap.metadata.fromCache;
            if (served || navigator.onLine === false) finish();
          } else onChange(snap);
        }, (err) => { if (onError) onError(err); else { console.warn('listener failed', err); this._fail(err); } finish(); });
      });
    }

    _parseReview(d) {
      const m = ID_RE.exec(d.id);
      if (!m) return null;
      const b = Number(m[1]), c = Number(m[2]);
      const meta = AB.index && AB.index.books[b - 1];
      if (!meta || c < 1 || c > meta.vs.length) return null;
      const data = d.data({ serverTimestamps: 'estimate' }) || {};
      return { key: b + ':' + c, done: data.done === true, t: millis(data.t), by: typeof data.by === 'string' ? data.by : '' };
    }

    _reviewChanges(snap) {
      snap.docChanges().forEach((ch) => {
        if (ch.doc.metadata.hasPendingWrites) return;
        const r = this._parseReview(ch.doc);
        if (!r) return;
        if (this.onRemote) this.onRemote({ type: 'review', key: r.key, review: ch.type === 'removed' ? null : r });
      });
    }

    _parse(d) {
      const m = ID_RE.exec(d.id);
      if (!m) return null;
      const b = Number(m[1]), c = Number(m[2]);
      const meta = AB.index && AB.index.books[b - 1];
      if (!meta || c < 1 || c > meta.vs.length) return null;
      const data = d.data({ serverTimestamps: 'estimate' }) || {};
      const verses = sanitizeVerses(data.v === undefined ? null : data.v);
      if (verses === undefined) return null;
      return { key: b + ':' + c, verses, t: millis(data.t), by: typeof data.by === 'string' ? data.by : '' };
    }

    _chapterChanges(snap) {
      if (this.offlineStart && !snap.metadata.fromCache) { this.offlineStart = false; this.onStatus('reconnected'); }
      snap.docChanges().forEach((ch) => {
        if (ch.doc.metadata.hasPendingWrites) return;            // our own change on its way to the server
        const c = this._parse(ch.doc);
        if (!c) return;
        this.stamps.set(c.key, c.t);
        if (this.onRemote) this.onRemote({ type: 'chapter', key: c.key, verses: ch.type === 'removed' ? null : c.verses, by: c.by });
      });
    }

    _parseMeta(snap) {
      const d = snap.exists() ? snap.data() : null;
      const names = {};
      if (d && d.bookNames && typeof d.bookNames === 'object') {
        for (const [k, v] of Object.entries(d.bookNames)) if (/^\d{1,2}$/.test(k) && typeof v === 'string' && clean(v)) names[k] = clean(v);
      }
      return { bookNames: names };
    }

    _localMeta() { return AB.platform.safeStorage.get(LOCAL_META_KEY, {}) || {}; }
    _mergeMeta(shared) { return Object.assign({}, this._localMeta(), { bookNames: (shared && shared.bookNames) || {} }); }

    setAuthor(name) { this.author = clean(name || '').slice(0, 40); }

    _track(promise) {
      this.pending += 1;
      this.onStatus('saving');
      promise.then(() => { this.pending -= 1; if (!this.pending) this.onStatus('saved'); }, (err) => { this.pending -= 1; this._fail(err); });
    }

    _fail(err) {
      console.warn(err);
      const code = err && err.code;
      if (code === 'permission-denied' || code === 'unauthenticated') this.onStatus(this.locked ? 'locked' : 'denied');
      else this.onStatus('error');
    }

    /** A saved identity can be gone (an old device, a cleared account): get a fresh anonymous one. */
    async _reauth() {
      try { await this.auth.currentUser.getIdToken(true); }
      catch (e) { await this.authM.signInAnonymously(this.auth); }
      this.uid = this.auth.currentUser.uid;
    }

    async _write(refDoc, histCol, payload) {
      await this.authReady;
      for (let attempt = 0; ; attempt += 1) {
        try {
          const batch = this.fs.writeBatch(this.db);
          const stamped = Object.assign({ t: this.fs.serverTimestamp(), by: this.author, u: this.uid }, payload);
          batch.set(refDoc, stamped);
          batch.set(this.fs.doc(histCol), stamped);
          await batch.commit();
          return;
        } catch (e) {
          const refused = e && (e.code === 'permission-denied' || e.code === 'unauthenticated');
          if (attempt === 0 && refused && !this.locked) { await this._reauth(); continue; }
          throw e;
        }
      }
    }

    putChapter(key, verses) {
      const id = key.replace(':', '_');
      const fs = this.fs;
      this._track(this._write(fs.doc(this.db, 'chapters', id), fs.collection(this.db, 'chapters', id, 'history'), { v: verses ? verses.slice() : null }));
      return Promise.resolve();
    }

    putMeta(meta) {
      const local = {};
      for (const k of LOCAL_ONLY) if (meta[k] !== undefined) local[k] = meta[k];
      AB.platform.safeStorage.set(LOCAL_META_KEY, local);
      const names = {};
      for (const [k, v] of Object.entries(meta.bookNames || {})) if (typeof v === 'string' && clean(v)) names[k] = clean(v);
      if (JSON.stringify(names) !== JSON.stringify((this.sharedMeta && this.sharedMeta.bookNames) || {})) {
        this.sharedMeta = { bookNames: names };
        const fs = this.fs;
        this._track(this._write(fs.doc(this.db, 'meta', 'site'), fs.collection(this.db, 'meta', 'site', 'history'), { bookNames: names }));
      }
      return Promise.resolve();
    }

    /** "This chapter has been read through" (or the mark taken back). Rejects when the server refuses, so the screen can undo. */
    async putReview(key, done) {
      const id = key.replace(':', '_');
      this.pending += 1;
      this.onStatus('saving');
      try {
        await this.authReady;
        for (let attempt = 0; ; attempt += 1) {
          try {
            const batch = this.fs.writeBatch(this.db);
            batch.set(this.fs.doc(this.db, 'reviews', id), { done: !!done, t: this.fs.serverTimestamp(), by: this.author, u: this.uid });
            await batch.commit();
            break;
          } catch (e) {
            const refused = e && (e.code === 'permission-denied' || e.code === 'unauthenticated');
            if (attempt === 0 && refused && !this.locked) { await this._reauth(); continue; }
            throw e;
          }
        }
        this.pending -= 1;
        if (!this.pending) this.onStatus('saved');
      } catch (e) {
        this.pending -= 1;
        console.warn(e);
        if (this.locked && e && e.code === 'permission-denied') this.onStatus('locked');
        else this.onStatus(this.pending ? 'saving' : 'saved');     // the caller tells the reader; the text itself is fine
        throw e;
      }
    }

    /** Saved versions of a chapter, newest first: [{verses|null, t, by}] */
    async history(key, limit) {
      const fs = this.fs;
      const id = key.replace(':', '_');
      const snap = await fs.getDocs(fs.query(fs.collection(this.db, 'chapters', id, 'history'), fs.orderBy('t', 'desc'), fs.limit(limit || 30)));
      const out = [];
      snap.docs.forEach((d) => {
        const data = d.data({ serverTimestamps: 'estimate' }) || {};
        const verses = sanitizeVerses(data.v === undefined ? null : data.v);
        if (verses === undefined) return;
        out.push({ verses, t: millis(data.t), by: typeof data.by === 'string' ? data.by : '' });
      });
      return out;
    }

    async clear() { /* the shared text is never cleared from here */ }
  }

  AB.FirebaseStore = FirebaseStore;
  AB.sanitizeVerses = sanitizeVerses;
})();
