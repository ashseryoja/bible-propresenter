/*
 * A small stand-in for the Firebase web SDK (auth + firestore parts the site uses), for local tests without a Firebase project.
 * The "database" lives in localStorage and is shared by all tabs of the same origin through a BroadcastChannel,
 * so two tabs behave like two devices. It also applies the main checks of firestore.rules, so payloads that the real rules
 * would refuse are refused here too.
 *
 * Test hooks: window.__mockFs = { reset(), dump(), offline(bool), latency }.
 */
const KEY = 'mock-fs-v1';
const chan = new BroadcastChannel('mock-fs');
let data = load();
const overlay = new Map();                 // this client's writes that the "server" has not confirmed yet
const listeners = new Set();
let offline = localStorage.getItem('mock-fs-offline') === '1';      // start the page without a connection: localStorage['mock-fs-offline'] = '1'
const queue = [];

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
function save() { localStorage.setItem(KEY, JSON.stringify(data)); }
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));
chan.onmessage = () => { data = load(); notifyAll(); };

// ---- refs ---------------------------------------------------------------------------------------------------------
const db = { __db: true };
const isDb = (x) => x === db || (x && x.__db);
function pathOf(args) { return args.filter((a) => typeof a === 'string').join('/').split('/').filter(Boolean); }
export function collection(base, ...seg) { const parts = isDb(base) ? pathOf(seg) : base.path.split('/').concat(pathOf(seg)); return { kind: 'collection', path: parts.join('/') }; }
export function doc(base, ...seg) {
  if (base && base.kind === 'collection' && !seg.length) return { kind: 'doc', path: base.path + '/' + Math.random().toString(36).slice(2, 12) };
  const parts = isDb(base) ? pathOf(seg) : base.path.split('/').concat(pathOf(seg));
  return { kind: 'doc', path: parts.join('/') };
}
export const serverTimestamp = () => ({ __serverTimestamp: true });
export const query = (ref, ...cons) => ({ kind: 'query', ref, cons });
export const orderBy = (field, dir) => ({ t: 'orderBy', field, dir: dir || 'asc' });
export const limit = (n) => ({ t: 'limit', n });

class Ts { constructor(ms) { this.ms = ms; } toMillis() { return this.ms; } }
function present(path, raw, pending) {
  const d = clone(raw);
  if (d && typeof d.t === 'number') d.t = new Ts(d.t);
  return { id: path.split('/').pop(), path, metadata: { hasPendingWrites: !!pending, fromCache: false }, exists: () => raw !== undefined, data: () => d };
}
function view(path) { return overlay.has(path) ? overlay.get(path).doc : data[path]; }
function childrenOf(collPath) {
  const depth = collPath.split('/').length + 1;
  const paths = new Set(Object.keys(data).concat([...overlay.keys()]));
  return [...paths].filter((p) => p.startsWith(collPath + '/') && p.split('/').length === depth && view(p) !== undefined).sort();
}

// ---- snapshots ----------------------------------------------------------------------------------------------------
export function onSnapshot(ref, ...rest) {
  let next, error;
  if (typeof rest[0] === 'function') { next = rest[0]; error = rest[1]; } else { next = rest[1]; error = rest[2]; }
  const l = { ref, next, prev: new Map(), n: 0, alive: true };
  listeners.add(l);
  // like the real SDK: first what is cached, then what the server says
  setTimeout(() => { if (l.alive) emit(l, true); }, 5);
  setTimeout(() => { if (l.alive) emit(l, false); }, offline ? 1e9 : (window.__mockFs.latency || 40));
  return () => { l.alive = false; listeners.delete(l); };
}
function emit(l, fromCache) {
  const ref = l.ref;
  const meta = { fromCache, hasPendingWrites: false };
  if (ref.kind === 'doc') {
    const p = ref.path;
    const snap = present(p, view(p), overlay.has(p));
    snap.metadata.fromCache = fromCache;
    const sig = JSON.stringify([view(p), overlay.has(p), fromCache]);
    if (l.sig === sig) return;
    l.sig = sig; l.next(snap);
    return;
  }
  const paths = childrenOf(ref.path);
  const docs = paths.map((p) => { const s = present(p, view(p), overlay.has(p)); s.metadata.fromCache = fromCache; return s; });
  const cur = new Map(paths.map((p) => [p, JSON.stringify([view(p), overlay.has(p)])]));
  const changes = [];
  for (const [p, sig] of cur) { if (!l.prev.has(p)) changes.push({ type: 'added', doc: docs[paths.indexOf(p)] }); else if (l.prev.get(p) !== sig) changes.push({ type: 'modified', doc: docs[paths.indexOf(p)] }); }
  for (const p of l.prev.keys()) if (!cur.has(p)) changes.push({ type: 'removed', doc: present(p, undefined, false) });
  const sigAll = JSON.stringify([[...cur], fromCache]);
  if (l.sig === sigAll && l.n) return;
  l.sig = sigAll; l.n += 1; l.prev = cur;
  l.next({ docs, size: docs.length, empty: !docs.length, metadata: meta, docChanges: () => changes });
}
function notifyAll() { for (const l of [...listeners]) if (l.alive && l.n !== undefined) { try { emit(l, false); } catch (e) { console.error(e); } } }

export async function getDocs(q) {
  const ref = q.kind === 'query' ? q.ref : q;
  let paths = childrenOf(ref.path);
  let docs = paths.map((p) => present(p, view(p), overlay.has(p)));
  if (q.kind === 'query') for (const c of q.cons) {
    if (c.t === 'orderBy') docs.sort((a, b) => { const x = a.data()[c.field], y = b.data()[c.field]; const xv = x && x.toMillis ? x.toMillis() : x, yv = y && y.toMillis ? y.toMillis() : y; return (xv < yv ? -1 : xv > yv ? 1 : 0) * (c.dir === 'desc' ? -1 : 1); });
    if (c.t === 'limit') docs = docs.slice(0, c.n);
  }
  await new Promise((r) => setTimeout(r, 20));
  return { docs, size: docs.length, empty: !docs.length };
}

// ---- rules (a port of the main checks of firestore.rules) ------------------------------------------------------------
function allowed(path, d, uid) {
  const seg = path.split('/');
  if (!uid) return 'not signed in';
  const lock = data['meta/lock'];
  if (lock && lock.on === true) return 'locked';
  const stamped = () => d && typeof d.by === 'string' && d.by.length <= 40 && d.u === uid && d.t !== undefined;
  const keysOk = (want) => d && Object.keys(d).length === want.length && want.every((k) => k in d);
  if ((seg[0] === 'chapters' && seg.length === 2) || (seg[0] === 'chapters' && seg[2] === 'history' && seg.length === 4)) {
    const m = /^(\d{1,2})_(\d{1,3})$/.exec(seg[1]);
    if (!m || +m[1] < 1 || +m[1] > 66 || +m[2] < 1 || +m[2] > 150) return 'bad chapter id';
    if (!keysOk(['v', 't', 'by', 'u']) || !stamped()) return 'bad chapter fields';
    if (d.v !== null && !(Array.isArray(d.v) && d.v.length >= 1 && d.v.length <= 200 && typeof d.v[0] === 'string' && typeof d.v[d.v.length - 1] === 'string')) return 'bad verses';
    if (seg.length === 2 && data[path] !== undefined && false) return 'x';
    return true;
  }
  if (seg[0] === 'reviews' && seg.length === 2) {
    const m = /^(\d{1,2})_(\d{1,3})$/.exec(seg[1]);
    if (!m || +m[1] < 1 || +m[1] > 66 || +m[2] < 1 || +m[2] > 150) return 'bad chapter id';
    if (!keysOk(['done', 't', 'by', 'u']) || !stamped()) return 'bad review fields';
    if (typeof d.done !== 'boolean') return 'bad done';
    return true;
  }
  if (seg[0] === 'meta' && seg[1] === 'site' && (seg.length === 2 || (seg[2] === 'history' && seg.length === 4))) {
    if (!keysOk(['bookNames', 't', 'by', 'u']) || !stamped()) return 'bad meta fields';
    if (!d.bookNames || typeof d.bookNames !== 'object' || Array.isArray(d.bookNames) || Object.keys(d.bookNames).length > 66) return 'bad names';
    return true;
  }
  return 'no rule';
}

export function writeBatch() {
  const ops = [];
  return {
    set(ref, value) { ops.push([ref.path, value]); },
    async commit() {
      const uid = currentUid();
      const now = Date.now();
      const stamped = ops.map(([p, v]) => [p, JSON.parse(JSON.stringify(v, (k, x) => (x && x.__serverTimestamp ? now : x)))]);
      const id = Math.random().toString(36).slice(2);
      // like the real SDK: the change shows up here at once, the server decides afterwards
      for (const [p, v] of stamped) overlay.set(p, { doc: v, id });
      notifyAll();
      await new Promise((resolve) => { queue.push(resolve); flush(); });
      for (const [p, v] of stamped) {
        const ok = allowed(p, v, uid);
        if (ok !== true) {
          for (const [q] of stamped) if (overlay.get(q) && overlay.get(q).id === id) overlay.delete(q);
          notifyAll();                                   // the change is taken back
          window.__mockFs.denied = (window.__mockFs.denied || 0) + 1;
          const e = new Error('Missing or insufficient permissions (' + ok + ')'); e.code = 'permission-denied'; throw e;
        }
      }
      for (const [p] of stamped) { if (overlay.get(p) && overlay.get(p).id === id) overlay.delete(p); }
      for (const [p, v] of stamped) data[p] = v;
      save(); chan.postMessage(1); notifyAll();
    },
  };
}
function flush() { if (offline) return; const rs = queue.splice(0); setTimeout(() => rs.forEach((r) => r()), window.__mockFs.latency || 40); }

// ---- firestore setup no-ops ----------------------------------------------------------------------------------------
export const initializeFirestore = () => db;
export const getFirestore = () => db;
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const connectFirestoreEmulator = () => {};

// ---- app and auth ------------------------------------------------------------------------------------------------------
export const initializeApp = (cfg) => ({ cfg });
let user = null;
function currentUid() { return user && user.uid; }
export const getAuth = () => authObj;
export const connectAuthEmulator = () => {};
const authObj = { get currentUser() { return user; }, authStateReady: async () => {} };
export async function signInAnonymously() {
  await new Promise((r) => setTimeout(r, 30));
  let uid = sessionStorage.getItem('mock-uid');
  if (!uid) { uid = 'anon_' + Math.random().toString(36).slice(2, 8); sessionStorage.setItem('mock-uid', uid); }
  user = { uid };
  return { user };
}

window.__mockFs = {
  latency: 40,
  denied: 0,
  reset() { data = {}; save(); chan.postMessage(1); notifyAll(); },
  dump() { return clone(data); },
  set(path, value) { data[path] = value; save(); chan.postMessage(1); notifyAll(); },
  remove(path) { delete data[path]; save(); chan.postMessage(1); notifyAll(); },
  offline(v) { offline = !!v; if (!offline) { flush(); notifyAll(); } },
};
