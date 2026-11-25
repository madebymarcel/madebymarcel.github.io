import { GENESIS, mergeGenerations, type Generation } from './generations';

const DB_NAME = 'made-by-marcel-canoe-polo-v1';
const STORE = 'generations';

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Generation database is blocked by another tab.'));
  });
}

export async function loadGenerations(): Promise<Generation[]> {
  const db = await database();
  try {
    const entries = await new Promise<Generation[]>((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return mergeGenerations([GENESIS], entries);
  } finally {
    db.close();
  }
}

export async function saveGenerations(generations: readonly Generation[]): Promise<void> {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error ?? new Error('Generation storage failed.'));
      const store = tx.objectStore(STORE);
      for (const generation of generations) {
        const request = store.get(generation.id);
        request.onsuccess = () => {
          const existing = request.result as Generation | undefined;
          if (existing && JSON.stringify(existing) !== JSON.stringify(generation)) {
            tx.abort();
          } else if (!existing) {
            store.add(generation);
          }
        };
      }
    });
  } finally {
    db.close();
  }
}
