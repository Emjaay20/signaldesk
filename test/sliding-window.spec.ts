import { SlidingWindowRateLimiter } from '../src/observability/sliding-window-rate-limiter';

describe('SlidingWindowRateLimiter', () => {
  it('allows up to max hits inside the window and rejects the next', () => {
    const limiter = new SlidingWindowRateLimiter(60_000, 3);
    const t0 = 1_000_000;
    expect(limiter.hit('k', t0).allowed).toBe(true);
    expect(limiter.hit('k', t0 + 10).allowed).toBe(true);
    const third = limiter.hit('k', t0 + 20);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);
    expect(limiter.hit('k', t0 + 30).allowed).toBe(false);
  });

  it('drops hits that have slid out of the window', () => {
    const limiter = new SlidingWindowRateLimiter(1_000, 2);
    const t0 = 5_000;
    expect(limiter.hit('k', t0).allowed).toBe(true);
    expect(limiter.hit('k', t0 + 100).allowed).toBe(true);
    expect(limiter.hit('k', t0 + 200).allowed).toBe(false);
    const afterSlide = limiter.hit('k', t0 + 1_101);
    expect(afterSlide.allowed).toBe(true);
    expect(afterSlide.remaining).toBe(0);
  });

  it('isolates keys from each other', () => {
    const limiter = new SlidingWindowRateLimiter(60_000, 1);
    expect(limiter.hit('a', 1).allowed).toBe(true);
    expect(limiter.hit('a', 2).allowed).toBe(false);
    expect(limiter.hit('b', 2).allowed).toBe(true);
  });

  it('bounds memory by pruning expired and oldest LRU keys when maxKeys is exceeded', () => {
    const limiter = new SlidingWindowRateLimiter(60_000, 5, 3);
    limiter.hit('k1', 100);
    limiter.hit('k2', 200);
    limiter.hit('k3', 300);
    expect(limiter.size).toBe(3);

    // Touch k1 so k2 becomes the oldest LRU key
    limiter.hit('k1', 400);
    // Adding k4 should evict k2 and keep size capped at 3
    limiter.hit('k4', 500);
    expect(limiter.size).toBe(3);
  });
});
