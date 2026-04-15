/**
 * IndexedDB-backed store of raw audio bytes for the "Recently played" list.
 *
 * Why IndexedDB rather than localStorage: localStorage is capped at ~5–10 MB
 * and stringifies values (2× bloat). IndexedDB handles ArrayBuffers natively
 * and routinely allows hundreds of MB.
 *
 * Scope: local file uploads only. URL / Suno entries are replayable from
 * their source URL and never need byte storage. Enabling file replay means
 * the user can drop a file once, score, and replay from the Recents list
 * on the next visit without re-picking — subject to a FIFO cap below.
 *
 * Cap: MAX_ENTRIES newest. Older file uploads drop out of byte storage but
 * their score metadata (title, points, stats) stays in the 50-entry
 * `recentSongs` localStorage list until it too evicts them. The UI hides
 * the replay button for file entries whose bytes are no longer available.
 */

const DB_NAME = 'vibez.surf';
const STORE = 'audioBytes';
const DB_VERSION = 1;
const MAX_ENTRIES = 10;

interface StoredEntry {
  id: string;
  bytes: ArrayBuffer;
  savedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id' });
        os.createIndex('savedAt', 'savedAt');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function awaitTx(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}

export async function saveAudioBytes(id: string, bytes: ArrayBuffer): Promise<void> {
  const db = await openDb();
  try {
    const entry: StoredEntry = { id, bytes, savedAt: Date.now() };
    const writeTx = db.transaction(STORE, 'readwrite');
    writeTx.objectStore(STORE).put(entry);
    await awaitTx(writeTx);
    await evictBeyondCap(db);
  } finally {
    db.close();
  }
}

/**
 * Walk the savedAt index newest-first; anything past MAX_ENTRIES gets deleted.
 * Index handles are transaction-scoped so the deletes run inside the same tx.
 */
async function evictBeyondCap(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const cursorReq = store.index('savedAt').openKeyCursor(null, 'prev');
  let count = 0;
  cursorReq.onsuccess = () => {
    const cursor = cursorReq.result;
    if (!cursor) return;
    count++;
    if (count > MAX_ENTRIES) store.delete(cursor.primaryKey);
    cursor.continue();
  };
  await awaitTx(tx);
}

export async function loadAudioBytes(id: string): Promise<ArrayBuffer | null> {
  const db = await openDb();
  try {
    return await new Promise<ArrayBuffer | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => {
        const v = req.result as StoredEntry | undefined;
        resolve(v ? v.bytes : null);
      };
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

/** Returns the set of stored ids, so the UI knows which file entries are replayable. */
export async function listStoredAudioIds(): Promise<Set<string>> {
  const db = await openDb();
  try {
    return await new Promise<Set<string>>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAllKeys();
      req.onsuccess = () => resolve(new Set(req.result as string[]));
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

export async function clearAllAudioBytes(): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    await awaitTx(tx);
  } finally {
    db.close();
  }
}
