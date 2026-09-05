import { describe, expect, it } from "vitest";
import { SlidingWindowRateLimiter } from "./rate-limiter.js";

/** Lets each test drive the clock instead of sleeping. */
function fakeClock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    }
  };
}

describe("SlidingWindowRateLimiter", () => {
  it("allows hits up to the limit and reports what is left", () => {
    const clock = fakeClock();
    const limiter = new SlidingWindowRateLimiter({ limit: 3, windowMs: 60_000 }, { now: clock.now });

    expect(limiter.consume("a")).toMatchObject({ allowed: true, remaining: 2 });
    expect(limiter.consume("a")).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.consume("a")).toMatchObject({ allowed: true, remaining: 0 });
  });

  it("rejects the hit past the limit with a positive retry hint", () => {
    const clock = fakeClock();
    const limiter = new SlidingWindowRateLimiter({ limit: 2, windowMs: 60_000 }, { now: clock.now });

    limiter.consume("a");
    limiter.consume("a");

    const rejected = limiter.consume("a");
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
    expect(rejected.retryAfterSeconds).toBe(60);
  });

  it("keeps buckets separate per key", () => {
    const clock = fakeClock();
    const limiter = new SlidingWindowRateLimiter({ limit: 1, windowMs: 60_000 }, { now: clock.now });

    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("b").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
  });

  it("frees capacity as hits slide out of the window", () => {
    const clock = fakeClock();
    const limiter = new SlidingWindowRateLimiter({ limit: 2, windowMs: 60_000 }, { now: clock.now });

    limiter.consume("a");
    clock.advance(30_000);
    limiter.consume("a");
    expect(limiter.consume("a").allowed).toBe(false);

    // The first hit is now 61s old, so exactly one slot opens up.
    clock.advance(31_000);
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.consume("a").allowed).toBe(false);
  });

  it("does not extend the wait when a blocked caller keeps retrying", () => {
    const clock = fakeClock();
    const limiter = new SlidingWindowRateLimiter({ limit: 1, windowMs: 10_000 }, { now: clock.now });

    limiter.consume("a");
    clock.advance(5_000);

    // Hammering while blocked must not push the window forward.
    expect(limiter.consume("a").retryAfterSeconds).toBe(5);
    expect(limiter.consume("a").retryAfterSeconds).toBe(5);

    clock.advance(5_001);
    expect(limiter.consume("a").allowed).toBe(true);
  });

  it("forgets a key once the window has fully elapsed", () => {
    const clock = fakeClock();
    const limiter = new SlidingWindowRateLimiter({ limit: 1, windowMs: 1_000 }, { now: clock.now });

    limiter.consume("a");
    expect(limiter.size).toBe(1);

    clock.advance(1_001);
    limiter.consume("b");

    // Reading "a" during the "b" call is what prunes it.
    expect(limiter.consume("a").allowed).toBe(true);
    expect(limiter.size).toBe(2);
  });

  it("clears history on reset so a later hit starts fresh", () => {
    const clock = fakeClock();
    const limiter = new SlidingWindowRateLimiter({ limit: 1, windowMs: 60_000 }, { now: clock.now });

    limiter.consume("a");
    expect(limiter.consume("a").allowed).toBe(false);

    limiter.reset("a");
    expect(limiter.consume("a").allowed).toBe(true);
  });

  it("caps tracked keys by dropping the least recently seen one", () => {
    const clock = fakeClock();
    const limiter = new SlidingWindowRateLimiter(
      { limit: 5, windowMs: 600_000 },
      { now: clock.now, maxKeys: 2 }
    );

    limiter.consume("old");
    clock.advance(1_000);
    limiter.consume("recent");
    clock.advance(1_000);
    limiter.consume("newcomer");

    expect(limiter.size).toBe(2);
    // "old" was evicted, so it has capacity again; "recent" kept its hit.
    expect(limiter.consume("recent").remaining).toBe(3);
    expect(limiter.consume("old").remaining).toBe(4);
  });

  it("rejects a rule that could never allow anything", () => {
    expect(() => new SlidingWindowRateLimiter({ limit: 0, windowMs: 1_000 })).toThrow();
    expect(() => new SlidingWindowRateLimiter({ limit: 1, windowMs: 0 })).toThrow();
  });
});
