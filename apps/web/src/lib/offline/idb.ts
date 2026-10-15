import { MemoryStore, type LocalStore } from "@naqdi/sync";

/**
 * `LocalStore` di atas IndexedDB. Satu object store "kv" dengan kunci `bucket\u0000key`.
 * Semua operasi bersifat transaksional per panggilan; nilai disimpan sebagai objek terstruktur.
 */
const DB_NAME = "naqdi-pos";
const STORE = "kv";
const SEP = "\u0000";

const wrap = <T,>(req: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export class IdbStore implements LocalStore {
  private opened: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    this.opened ??= new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE);
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error("indexeddb blocked"));
    });
    return this.opened;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.db()).transaction(STORE, mode).objectStore(STORE);
  }

  async get<T>(bucket: string, key: string): Promise<T | undefined> {
    return (await wrap((await this.store("readonly")).get(`${bucket}${SEP}${key}`))) as T | undefined;
  }

  async put<T>(bucket: string, key: string, value: T): Promise<void> {
    const store = await this.store("readwrite");
    await new Promise<void>((resolve, reject) => {
      const tx = store.transaction;
      store.put(value, `${bucket}${SEP}${key}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async delete(bucket: string, key: string): Promise<void> {
    const store = await this.store("readwrite");
    await new Promise<void>((resolve, reject) => {
      const tx = store.transaction;
      store.delete(`${bucket}${SEP}${key}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async list<T>(bucket: string): Promise<{ key: string; value: T }[]> {
    const store = await this.store("readonly");
    const range = IDBKeyRange.bound(`${bucket}${SEP}`, `${bucket}${SEP}￿`);
    const [keys, values] = await Promise.all([wrap(store.getAllKeys(range)), wrap(store.getAll(range))]);
    return keys.map((k, i) => ({ key: String(k).slice(bucket.length + 1), value: values[i] as T }));
  }
}

/** IndexedDB bila tersedia; kalau tidak (mis. mode privat tertentu) memori saja, dan `persistent` bernilai false. */
export const openLocalStore = async (): Promise<{ store: LocalStore; persistent: boolean }> => {
  try {
    if (typeof indexedDB === "undefined") throw new Error("no indexedDB");
    const store = new IdbStore();
    await store.get("meta", "probe");
    return { store, persistent: true };
  } catch {
    return { store: new MemoryStore(), persistent: false };
  }
};
