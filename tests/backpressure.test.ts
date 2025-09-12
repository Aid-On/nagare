import { describe, it, expect, beforeAll } from 'vitest';
import { CreditController, MultiStreamCreditManager, AdaptiveBackpressure, WindowedRateLimiter, DynamicBackpressure } from '../src';
import { loadWasm } from '../src/wasm-loader';

describe('Backpressure Utilities', () => {
  beforeAll(async () => {
    await loadWasm();
  });

  it('CreditController basic credit consumption and refill', () => {
    const cc = new CreditController(5);
    expect(cc.availableCredits()).toBe(5);
    expect(cc.consumeCredit(2)).toBe(true);
    expect(cc.availableCredits()).toBe(3);
    expect(cc.consumeCredit(4)).toBe(false);
    cc.addCredits(10);
    expect(cc.availableCredits()).toBeGreaterThanOrEqual(10 + 3);
    cc.reset();
    expect(cc.availableCredits()).toBe(5);
  });

  it('MultiStreamCreditManager tracks stream credits', () => {
    const m = new MultiStreamCreditManager(3);
    m.registerStream('s1');
    m.registerStream('s2', 10);
    expect(m.availableCredits('s1')).toBe(3);
    expect(m.availableCredits('s2')).toBe(10);
    expect(m.consume('s1', 2)).toBe(true);
    expect(m.availableCredits('s1')).toBe(1);
    m.addCredits('s1', 5);
    expect((m.availableCredits('s1') ?? 0) >= 6).toBe(true);
    expect(m.activeStreams().sort()).toEqual(['s1', 's2']);
    m.unregisterStream('s2');
    expect(m.activeStreams()).toEqual(['s1']);
  });

  it('AdaptiveBackpressure adjusts rate toward target latency', () => {
    const ab = new AdaptiveBackpressure(100, 50, 10, 1000);
    const initial = ab.getRate();
    ab.update(10); // lower latency than target -> can increase
    expect(ab.getRate()).toBeGreaterThanOrEqual(initial);
    ab.update(500); // much higher latency -> should reduce
    expect(ab.getRate()).toBeLessThanOrEqual(1000);
    expect(ab.getDelayMs()).toBeGreaterThan(0);
  });

  it('WindowedRateLimiter enforces rate within window', () => {
    const rl = new WindowedRateLimiter(1000, 3);
    const t0 = 0;
    expect(rl.tryAcquire(t0)).toBe(true);
    expect(rl.tryAcquire(t0 + 10)).toBe(true);
    expect(rl.tryAcquire(t0 + 20)).toBe(true);
    expect(rl.tryAcquire(t0 + 30)).toBe(false);
    // move outside window
    expect(rl.tryAcquire(t0 + 1500)).toBe(true);
    expect(rl.currentRate(t0 + 1500)).toBeGreaterThanOrEqual(1);
    expect(rl.availableSlots()).toBeGreaterThanOrEqual(0);
  });

  it('DynamicBackpressure accepts based on queue and latency', () => {
    const db = new DynamicBackpressure(10, 50);
    const metrics = {
      queueSize: 5,
      processingRate: 100,
      inputRate: 60,
      latencyMs: 40,
      memoryUsage: 100,
    };
    expect(db.shouldAccept(metrics)).toBe(true);
    const highLatency = { ...metrics, latencyMs: 200 };
    expect(db.shouldAccept(highLatency)).toBe(false);
    const fullQueue = { ...metrics, queueSize: 20 };
    expect(db.shouldAccept(fullQueue)).toBe(false);
  });
});

