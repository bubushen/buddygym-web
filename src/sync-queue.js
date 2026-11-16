// Coda persistente delle modifiche da caricare sul cloud, separata per utente.
// Non lancia mai: se lo storage non è disponibile, la sincronizzazione resta prudente.

// Stessa chiave usata in passato da app.js: il vecchio valore "1" non è JSON
// e viene quindi interpretato come "tutto da ricaricare".
const dirtyKey = (userId) => `buddygym:account-pending:${userId}`;
const printsKey = (userId) => `buddygym:account-session-prints:${userId}`;
// Metadati interni attaccati allo snapshot, non enumerabili: i chiamanti vedono solo { all, keys }.
const ALL_STAMP = Symbol('allStamp');
const KEY_VERSIONS = Symbol('keyVersions');

function getItem(storage, key) {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}

function setItem(storage, key, value) {
  try {
    if (!storage?.setItem) return false;
    storage.setItem(key, value);
    return true;
  } catch { return false; }
}

// found distingue "prima volta" (all true) da uno stato vecchio o corrotto (all true).
function readState(storage, userId) {
  const raw = getItem(storage, dirtyKey(userId));
  if (raw === null) return { found: false, valid: false, state: null };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || typeof parsed.all !== 'boolean' || !Array.isArray(parsed.keys)) {
      return { found: true, valid: false, state: null };
    }
    const rawVersions = parsed.versions && typeof parsed.versions === 'object' && !Array.isArray(parsed.versions)
      ? parsed.versions : {};
    const keys = [];
    const versions = {};
    for (const key of parsed.keys) {
      if (typeof key !== 'string' || keys.includes(key)) continue;
      keys.push(key);
      const version = Number(rawVersions[key]);
      versions[key] = Number.isFinite(version) && version >= 0 ? version : 1;
    }
    const stamp = Number(parsed.allStamp);
    return {
      found: true,
      valid: true,
      state: {
        all: parsed.all,
        keys,
        versions,
        allStamp: Number.isFinite(stamp) && stamp >= 0 ? stamp : 0,
      },
    };
  } catch { return { found: true, valid: false, state: null }; }
}

function writeState(storage, userId, state) {
  try {
    return setItem(storage, dirtyKey(userId), JSON.stringify({
      all: state.all,
      keys: state.keys,
      versions: state.versions,
      allStamp: state.allStamp,
    }));
  } catch { return false; }
}

export function readDirty(storage, userId) {
  const parsed = readState(storage, userId);
  if (!parsed.valid) {
    const snapshot = { all: true, keys: [] };
    Object.defineProperty(snapshot, ALL_STAMP, { value: 0 });
    Object.defineProperty(snapshot, KEY_VERSIONS, { value: {} });
    return snapshot;
  }
  const snapshot = { all: parsed.state.all, keys: [...parsed.state.keys] };
  Object.defineProperty(snapshot, ALL_STAMP, { value: parsed.state.allStamp });
  Object.defineProperty(snapshot, KEY_VERSIONS, { value: { ...parsed.state.versions } });
  return snapshot;
}

export function markDirty(storage, userId, key) {
  if (typeof key !== 'string' || !key) return false;
  const parsed = readState(storage, userId);
  // Al primo utilizzo si parte incrementali; uno stato vecchio/corrotto resta "tutto da caricare".
  const state = parsed.valid
    ? parsed.state
    : { all: parsed.found, keys: [], versions: {}, allStamp: 0 };
  if (!state.keys.includes(key)) state.keys.push(key);
  state.versions[key] = (Number(state.versions[key]) || 0) + 1;
  return writeState(storage, userId, state);
}

export function markAllDirty(storage, userId) {
  const parsed = readState(storage, userId);
  const state = parsed.valid
    ? parsed.state
    : { all: true, keys: [], versions: {}, allStamp: 0 };
  state.all = true;
  // Una nuova richiesta "tutto" arrivata durante un upload completo non deve
  // essere cancellata dal clearDirty di quell'upload.
  state.allStamp += 1;
  return writeState(storage, userId, state);
}

export function clearDirty(storage, userId, snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return false;
  const snapshotKeys = Array.isArray(snapshot.keys)
    ? snapshot.keys.filter((key) => typeof key === 'string') : [];
  const versions = snapshot[KEY_VERSIONS] && typeof snapshot[KEY_VERSIONS] === 'object'
    ? snapshot[KEY_VERSIONS] : null;
  const stamp = Number.isFinite(snapshot[ALL_STAMP]) ? snapshot[ALL_STAMP] : null;
  const parsed = readState(storage, userId);
  if (!parsed.valid) {
    // Upload completo riuscito: anche uno stato vecchio/corrotto può essere ripulito.
    if (!snapshot.all) return false;
    return writeState(storage, userId, { all: false, keys: [], versions: {}, allStamp: stamp ?? 0 });
  }
  const state = parsed.state;
  const removed = new Set();
  for (const key of snapshotKeys) {
    // Una chiave modificata di nuovo durante l'upload ha una versione diversa e resta in coda.
    if (versions && Object.prototype.hasOwnProperty.call(versions, key)) {
      if ((state.versions[key] ?? 0) === versions[key]) removed.add(key);
    } else {
      removed.add(key);
    }
  }
  state.keys = state.keys.filter((key) => !removed.has(key));
  for (const key of removed) delete state.versions[key];
  if (snapshot.all) {
    const changedDuringUpload = stamp !== null && state.allStamp !== stamp;
    state.all = state.all && changedDuringUpload;
  }
  return writeState(storage, userId, state);
}

export function sessionFingerprints(storage, userId) {
  const raw = getItem(storage, printsKey(userId));
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const map = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (typeof value === 'string') map[id] = value;
    }
    return map;
  } catch { return {}; }
}

export function saveSessionFingerprints(storage, userId, map) {
  const clean = {};
  if (map && typeof map === 'object' && !Array.isArray(map)) {
    for (const [id, value] of Object.entries(map)) {
      if (typeof value === 'string') clean[id] = value;
    }
  }
  try {
    return setItem(storage, printsKey(userId), JSON.stringify(clean));
  } catch { return false; }
}

// JSON canonico: oggetti con le stesse proprietà hanno la stessa impronta
// anche se l'ordine delle chiavi cambia.
function canonical(value, seen) {
  if (value === null || typeof value !== 'object') return value;
  if (typeof value.toJSON === 'function') return canonical(value.toJSON(), seen);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  let result;
  if (Array.isArray(value)) result = value.map((item) => canonical(item, seen));
  else {
    result = {};
    for (const key of Object.keys(value).sort()) result[key] = canonical(value[key], seen);
  }
  seen.delete(value);
  return result;
}

export function fingerprint(value) {
  let text;
  try { text = JSON.stringify(canonical(value, new Set())); } catch { text = String(value); }
  if (text === undefined) text = 'undefined';
  // FNV-1a a 32 bit, abbastanza corto da essere salvato per ogni seduta.
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}
