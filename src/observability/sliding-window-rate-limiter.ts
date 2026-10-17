export type RateLimitDecision = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAtMs: number;
};

/**
 * Per-key sliding window: counts hits in the last `windowMs` rather than
 * a fixed calendar bucket. Bounded by `maxKeys` with LRU eviction and
 * expired-window pruning to prevent unbounded heap growth.
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly maxHits: number,
    private readonly maxKeys = 10_000,
  ) {}

  get size(): number {
    return this.hits.size;
  }

  hit(key: string, nowMs = Date.now()): RateLimitDecision {
    const cutoff = nowMs - this.windowMs;
    const prior = this.hits.get(key) ?? [];
    const recent = prior.filter((ts) => ts > cutoff);
    recent.push(nowMs);

    // Refresh insertion order for LRU behavior
    if (this.hits.has(key)) {
      this.hits.delete(key);
    }
    this.hits.set(key, recent);

    if (this.hits.size > this.maxKeys) {
      this.prune(cutoff);
    }

    const remaining = Math.max(0, this.maxHits - recent.length);
    const oldest = recent[0] ?? nowMs;
    return {
      allowed: recent.length <= this.maxHits,
      limit: this.maxHits,
      remaining,
      resetAtMs: oldest + this.windowMs,
    };
  }

  private prune(cutoff: number): void {
    for (const [k, timestamps] of this.hits.entries()) {
      const last = timestamps[timestamps.length - 1];
      if (last === undefined || last <= cutoff) {
        this.hits.delete(k);
      }
      if (this.hits.size <= this.maxKeys) {
        return;
      }
    }

    // Evict oldest LRU keys if still above capacity
    while (this.hits.size > this.maxKeys) {
      const oldestKey = this.hits.keys().next().value;
      if (oldestKey === undefined) {
        break;
      }
      this.hits.delete(oldestKey);
    }
  }
}
