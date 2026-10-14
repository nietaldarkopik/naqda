/**
 * Pembatas percobaan masuk di memori: hanya menghitung kegagalan.
 * Cukup untuk satu proses; untuk beberapa instance pindahkan ke penyimpanan bersama.
 */
export class LoginLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly maxFailures = 10,
    private readonly windowMs = 15 * 60_000,
  ) {}

  private recent(key: string, now: number): number[] {
    const list = (this.failures.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length > 0) this.failures.set(key, list);
    else this.failures.delete(key);
    return list;
  }

  isBlocked(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= this.maxFailures;
  }

  recordFailure(key: string, now = Date.now()): void {
    const list = this.recent(key, now);
    list.push(now);
    this.failures.set(key, list);
  }

  reset(key?: string): void {
    if (key === undefined) this.failures.clear();
    else this.failures.delete(key);
  }
}
