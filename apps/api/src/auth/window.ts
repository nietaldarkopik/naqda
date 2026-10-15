/**
 * Pembatas laju jendela geser di memori: setiap `hit` dihitung (bukan hanya kegagalan). Untuk satu proses;
 * dengan beberapa instance pindahkan ke penyimpanan bersama.
 */
export class WindowLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length > 0) this.hits.set(key, list);
    else this.hits.delete(key);
    return list;
  }

  /** Mencatat satu percobaan; mengembalikan false bila sudah melewati batas (percobaan itu tidak dihitung). */
  allow(key: string, now = Date.now()): boolean {
    const list = this.recent(key, now);
    if (list.length >= this.max) return false;
    list.push(now);
    this.hits.set(key, list);
    return true;
  }

  reset(): void {
    this.hits.clear();
  }
}
