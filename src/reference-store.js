const DATABASE_NAME = 'buddygym-personal-references';
const STORE_NAME = 'videos';
// Pose già calcolate dei video di riferimento, per disegnare le linee senza rianalizzarli.
const POSE_STORE = 'poses';

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('IndexedDB non disponibile')); return; }
    const request = indexedDB.open(DATABASE_NAME, 2);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) database.createObjectStore(STORE_NAME, { keyPath: 'exerciseId' });
      if (!database.objectStoreNames.contains(POSE_STORE)) database.createObjectStore(POSE_STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(mode, action, storeName = STORE_NAME) {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = database.transaction(storeName, mode);
      const request = action(transaction.objectStore(storeName));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { database.close(); }
}

export function getCachedPose(key) {
  return withStore('readonly', (store) => store.get(key), POSE_STORE);
}

export function saveCachedPose(key, packed) {
  return withStore('readwrite', (store) => store.put(packed, key), POSE_STORE);
}

export function deleteCachedPosesWithPrefix(prefix) {
  return withStore('readwrite', (store) => store.delete(IDBKeyRange.bound(prefix, `${prefix}\uffff`)), POSE_STORE);
}

export function getPersonalReference(exerciseId) {
  return withStore('readonly', (store) => store.get(exerciseId));
}

export function savePersonalReference(reference) {
  return withStore('readwrite', (store) => store.put(reference));
}

export function deletePersonalReference(exerciseId) {
  return withStore('readwrite', (store) => store.delete(exerciseId));
}

// Elimina tutti i video personali di un account (chiavi `account:<id>:…`).
export function deletePersonalReferencesWithPrefix(prefix) {
  return withStore('readwrite', (store) => store.delete(IDBKeyRange.bound(prefix, `${prefix}￿`)));
}
