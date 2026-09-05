/**
 * In-process sliding-window rate limiting.
 *
 * Deliberately not backed by the database: these counters are hot, short-lived and
 * approximate, and a per-request write would cost more than the attacks it stops.
 * The trade-off is that limits are per process, so a multi-instance deployment
 * should move this behind a shared store (Redis) before relying on it as a hard
 * ceiling. It is still worth having now — an unauthenticated endpoint that runs
 * scrypt is a CPU exhaustion vector, and credential stuffing needs no more than
 * one instance to succeed.
 */

export interface RateLimitRule {
  /** Requests allowed inside the window. */
  limit: number;
  windowMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  /** Attempts still available in the current window; 0 once the limit is reached. */
  remaining: number;
  /** How long to wait before the oldest hit falls out of the window. 0 when allowed. */
  retryAfterSeconds: number;
}

/** The abuse limits the API applies. Grouped so a deployment can tune them together. */
export interface AbuseLimitSettings {
  /** Sign-in and sign-up attempts per client address. Guards the scrypt cost. */
  authAttempts: RateLimitRule;
  /** Failed sign-ins per account, counted across addresses. Guards credential stuffing. */
  loginFailuresPerAccount: RateLimitRule;
  /**
   * Turn generations per reader per minute. The daily quota already caps spend;
   * this caps how fast a single reader can occupy the model.
   */
  generationBurst: RateLimitRule;
}

export const DEFAULT_ABUSE_LIMITS: AbuseLimitSettings = {
  authAttempts: { limit: 10, windowMs: 60_000 },
  loginFailuresPerAccount: { limit: 5, windowMs: 15 * 60_000 },
  generationBurst: { limit: 6, windowMs: 60_000 }
};

export interface RateLimiterOptions {
  /** Injectable clock so tests do not have to sleep. */
  now?: () => number;
  /**
   * Upper bound on tracked keys. Reached only under a spraying attack, which is
   * exactly when the map must not be allowed to grow without limit.
   */
  maxKeys?: number;
}

const DEFAULT_MAX_KEYS = 10_000;

export class SlidingWindowRateLimiter {
  private readonly rule: RateLimitRule;
  private readonly now: () => number;
  private readonly maxKeys: number;
  /** key -> ascending hit timestamps inside the window. */
  private readonly hits = new Map<string, number[]>();

  constructor(rule: RateLimitRule, options: RateLimiterOptions = {}) {
    if (rule.limit < 1 || rule.windowMs < 1) {
      throw new Error("Rate limit rule needs a positive limit and window");
    }

    this.rule = rule;
    this.now = options.now ?? (() => Date.now());
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS;
  }

  /** Records a hit and reports whether it is allowed. Rejected hits are not recorded. */
  consume(key: string): RateLimitDecision {
    const now = this.now();
    const timestamps = this.window(key, now);

    if (timestamps.length >= this.rule.limit) {
      const oldest = timestamps[0] as number;
      return {
        allowed: false,
        remaining: 0,
        // Rejections are not recorded, so the wait never grows just from retrying.
        retryAfterSeconds: Math.max(1, Math.ceil((oldest + this.rule.windowMs - now) / 1000))
      };
    }

    timestamps.push(now);
    this.store(key, timestamps);

    return {
      allowed: true,
      remaining: this.rule.limit - timestamps.length,
      retryAfterSeconds: 0
    };
  }

  /** Clears a key's history. Used after a success so one bad guess costs nothing. */
  reset(key: string): void {
    this.hits.delete(key);
  }

  /** Tracked key count. Exposed for tests and diagnostics. */
  get size(): number {
    return this.hits.size;
  }

  private window(key: string, now: number): number[] {
    const cutoff = now - this.rule.windowMs;
    const existing = this.hits.get(key);
    if (!existing) {
      return [];
    }

    const live = existing.filter((at) => at > cutoff);
    if (live.length === 0) {
      this.hits.delete(key);
    }

    return live;
  }

  private store(key: string, timestamps: number[]): void {
    if (!this.hits.has(key) && this.hits.size >= this.maxKeys) {
      this.evictOldest();
    }

    this.hits.set(key, timestamps);
  }

  /**
   * Drops the key whose newest hit is oldest. Map iteration order is insertion
   * order, which is not recency order, so the scan is the honest way to pick.
   */
  private evictOldest(): void {
    let staleKey: string | null = null;
    let staleAt = Number.POSITIVE_INFINITY;

    for (const [key, timestamps] of this.hits) {
      const newest = timestamps[timestamps.length - 1] ?? 0;
      if (newest < staleAt) {
        staleAt = newest;
        staleKey = key;
      }
    }

    if (staleKey !== null) {
      this.hits.delete(staleKey);
    }
  }
}
