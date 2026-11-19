import type { SourceDefinition } from "./catalog";
import {
  loadSource,
  validateSourceBundle,
  type SourceBundle,
} from "./source-loader";

const DATABASE = "atlas-source-cache-v1";
const STORE = "sources";
export const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
type Entry = { id: string; cachedAt: number; bundle: SourceBundle };
export type SourceResult = {
  bundle: SourceBundle;
  cacheHit: boolean;
  cacheAvailable: boolean;
};

async function openCache(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return null;
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve(null);
    }, 1500);
    try {
      const request = indexedDB.open(DATABASE, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE))
          request.result.createObjectStore(STORE, { keyPath: "id" });
      };
      request.onerror = request.onblocked = () => {
        clearTimeout(timer);
        settled = true;
        resolve(null);
      };
      request.onsuccess = () => {
        clearTimeout(timer);
        if (settled) request.result.close();
        else {
          settled = true;
          resolve(request.result);
        }
      };
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}
async function cacheOperation<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openCache();
  if (!db) return null;
  return new Promise((resolve) => {
    let result: T | null = null;
    let done = false;
    const finish = (value: T | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      db.close();
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 1500);
    try {
      const transaction = db.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => {
        result = request.result;
      };
      transaction.oncomplete = () => finish(result);
      transaction.onerror = transaction.onabort = () => finish(null);
    } catch {
      finish(null);
    }
  });
}
export async function getCachedSource(
  def: SourceDefinition,
  now = Date.now(),
): Promise<SourceBundle | null> {
  const entry = await cacheOperation<Entry | undefined>("readonly", (store) =>
    store.get(def.id),
  );
  if (
    !entry ||
    !Number.isFinite(entry.cachedAt) ||
    now - entry.cachedAt > CACHE_TTL ||
    now < entry.cachedAt
  )
    return null;
  try {
    return validateSourceBundle(entry.bundle, def);
  } catch {
    return null;
  }
}
export async function cacheSource(
  bundle: SourceBundle,
  now = Date.now(),
): Promise<boolean> {
  // IDBObjectStore.put returns a key; successful transaction completion guarantees durability.
  return (
    (await cacheOperation<IDBValidKey>("readwrite", (store) =>
      store.put({ id: bundle.sourceId, cachedAt: now, bundle } satisfies Entry),
    )) !== null
  );
}
export async function forgetCachedSource(id: string): Promise<void> {
  await cacheOperation("readwrite", (store) => store.delete(id));
}
export async function requestSource(
  def: SourceDefinition,
  options: { signal?: AbortSignal; refresh?: boolean } = {},
): Promise<SourceResult> {
  options.signal?.throwIfAborted();
  if (!options.refresh) {
    const cached = await getCachedSource(def);
    options.signal?.throwIfAborted();
    if (cached) return { bundle: cached, cacheHit: true, cacheAvailable: true };
  }
  const bundle = await loadSource(def, {
    signal: options.signal,
    mode: "live",
  });
  options.signal?.throwIfAborted();
  // A failed refresh must not overwrite a more recent cache with the bundled fallback.
  const cacheAvailable =
    options.refresh && bundle.fallbackReason
      ? false
      : await cacheSource(bundle);
  options.signal?.throwIfAborted();
  return { bundle, cacheHit: false, cacheAvailable };
}
