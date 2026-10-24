export interface BoundedRateLimiterOptions {
  windowMs?: number;
  maxBuckets?: number;
}

interface Bucket {
  attempts: number[];
  lastSeen: number;
}

/**
 * Fixed-window counter per key with bounded memory: expired buckets are pruned
 * lazily and the bucket count is capped by evicting the least recently seen key.
 */
export class BoundedRateLimiter {
  private readonly windowMs: number;
  private readonly maxBuckets: number;
  private readonly buckets = new Map<string, Bucket>();
  private lastPrune = 0;

  constructor(options: BoundedRateLimiterOptions = {}) {
    this.windowMs = options.windowMs ?? 60_000;
    this.maxBuckets = options.maxBuckets ?? 10_000;
  }

  public get size(): number {
    return this.buckets.size;
  }

  public tryConsume(key: string, limit: number, now: number = Date.now()): boolean {
    this.pruneExpired(now);
    let bucket = this.buckets.get(key);
    if (bucket) {
      bucket.attempts = bucket.attempts.filter(
        (timestamp) => now - timestamp < this.windowMs,
      );
      bucket.lastSeen = now;
      if (bucket.attempts.length >= limit) {
        return false;
      }
    } else {
      if (this.buckets.size >= this.maxBuckets) {
        this.evictOldest();
      }
      bucket = { attempts: [], lastSeen: now };
      this.buckets.set(key, bucket);
    }
    bucket.attempts.push(now);
    return true;
  }

  private pruneExpired(now: number): void {
    if (now - this.lastPrune < this.windowMs) {
      return;
    }
    this.lastPrune = now;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastSeen >= this.windowMs) {
        this.buckets.delete(key);
      }
    }
  }

  private evictOldest(): void {
    let oldestKey: string | undefined;
    let oldestSeen = Infinity;
    for (const [key, bucket] of this.buckets) {
      if (bucket.lastSeen < oldestSeen) {
        oldestSeen = bucket.lastSeen;
        oldestKey = key;
      }
    }
    if (oldestKey !== undefined) {
      this.buckets.delete(oldestKey);
    }
  }
}
