/**
 * Penyimpanan lokal perangkat. Antarmuka ini sengaja kecil: web memakai IndexedDB, desktop/mobile nanti SQLite,
 * dan tes memakai `MemoryStore`. Nilai harus bisa diserialisasi ke JSON.
 */
export interface LocalStore {
  get<T>(bucket: string, key: string): Promise<T | undefined>;
  put<T>(bucket: string, key: string, value: T): Promise<void>;
  delete(bucket: string, key: string): Promise<void>;
  list<T>(bucket: string): Promise<{ key: string; value: T }[]>;
}

export class MemoryStore implements LocalStore {
  private readonly data = new Map<string, Map<string, string>>();

  private bucket(name: string): Map<string, string> {
    let b = this.data.get(name);
    if (!b) this.data.set(name, (b = new Map()));
    return b;
  }

  async get<T>(bucket: string, key: string): Promise<T | undefined> {
    const raw = this.bucket(bucket).get(key);
    return raw === undefined ? undefined : (JSON.parse(raw) as T);
  }
  async put<T>(bucket: string, key: string, value: T): Promise<void> {
    this.bucket(bucket).set(key, JSON.stringify(value));
  }
  async delete(bucket: string, key: string): Promise<void> {
    this.bucket(bucket).delete(key);
  }
  async list<T>(bucket: string): Promise<{ key: string; value: T }[]> {
    return [...this.bucket(bucket)].map(([key, raw]) => ({ key, value: JSON.parse(raw) as T }));
  }
}
