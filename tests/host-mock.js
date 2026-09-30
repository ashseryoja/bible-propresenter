/*
 * A fake `window.claude` (the claude.ai viewer runtime) for trying the hosted code paths locally.
 * Capabilities: db (documents kept in localStorage so they survive a reload, like the real cloud store),
 * user, downloads. Test hooks: window.__mock = { downloads:[], declineNext, offline }.
 */
(function () {
  'use strict';
  const KEY = 'mock-claude-db';
  const mock = window.__mock = { downloads: [], declineNext: false, dbCalls: 0, useCalls: [], nullFor: [] };
  let docs = {};
  try { docs = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { docs = {}; }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(docs)); } catch (e) { /* ignore */ } };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const err = (code, message) => Object.assign(new Error(message), { code, message });

  function snapOf(path) {
    const data = docs[path];
    return { id: path.split('/').pop(), exists: data !== undefined, data: () => (data === undefined ? undefined : clone(data)), metadata: { fromCache: false, hasPendingWrites: false } };
  }
  function childrenOf(path) {
    const depth = path.split('/').length + 1;
    return Object.keys(docs).filter((p) => p.startsWith(path + '/') && p.split('/').length === depth).sort();
  }
  function docRef(path) {
    if (path.split('/').length % 2 !== 0) throw new TypeError('doc path needs an even number of segments: ' + path);
    return {
      id: path.split('/').pop(), path,
      async get() { mock.dbCalls++; return snapOf(path); },
      async set(d) { mock.dbCalls++; if (JSON.stringify(d).length > 256 * 1024) throw err('invalid_argument', 'too large'); docs[path] = clone(d); persist(); },
      async update(d) { if (docs[path] === undefined) throw err('invalid_argument', 'no doc'); docs[path] = Object.assign(docs[path], clone(d)); persist(); },
      async delete() { delete docs[path]; persist(); },
      onSnapshot(next) { next(snapOf(path)); return () => {}; },
      collection: (p) => collRef(path + '/' + p),
    };
  }
  function collRef(path) {
    if (path.split('/').length % 2 !== 1) throw new TypeError('collection path needs an odd number of segments: ' + path);
    const snap = () => {
      const ids = childrenOf(path);
      return { docs: ids.map(snapOf), size: ids.length, empty: !ids.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } };
    };
    return {
      path,
      doc: (id) => docRef(path + '/' + (id || Math.random().toString(36).slice(2))),
      async get() { mock.dbCalls++; return snap(); },
      onSnapshot(next) { next(snap()); return () => {}; },
    };
  }

  const db = { doc: docRef, collection: collRef };
  const user = {
    async id() { return 'u_mock'; },
    async me() { return { id: 'u_mock', name: '', avatarUrl: '', color: '#888', email: null, isOwner: true, canEdit: true }; },
    async isOwner() { return true; }, async canEdit() { return true; }, async can() { return true; },
  };
  const downloads = {
    async save(req) {
      if (mock.declineNext) { mock.declineNext = false; throw err('declined', 'declined'); }
      if (!/\.(zip|json)$/.test(req.filename)) throw err('rejected_extension', 'extension');
      const size = req.data && req.data.size;
      const rec = { filename: req.filename, size, type: req.data && req.data.type, isBlob: req.data instanceof Blob };
      mock.downloads.push(rec);
      if (mock.receiver) {                                    // hand the bytes to a local receiver so they can be opened with real SQLite
        const r = await fetch(mock.receiver + '/' + req.filename, { method: 'POST', body: req.data });
        rec.received = await r.text();
      }
      return { status: 'saved' };
    },
  };

  window.claude = {
    // like the real one: resolves a namespace or null
    async use(name) {
      mock.useCalls.push(name);
      if (mock.nullFor.includes(name)) return null;
      return { db, user, downloads }[name] || null;
    },
  };
})();
