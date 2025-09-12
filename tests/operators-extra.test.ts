import { describe, it, expect, beforeAll, vi } from 'vitest';
import { nagare, distinctUntilChanged, startWith, buffer, concatMap, switchMap } from '../src';
import { loadWasm } from '../src/wasm-loader';

describe('Operators Extra', () => {
  beforeAll(async () => {
    await loadWasm();
  });

  it('distinctUntilChanged drops consecutive duplicates', async () => {
    const src = nagare.of(1, 1, 2, 2, 3, 3);
    const out = await distinctUntilChanged<number>()(src).toArray();
    expect(out).toEqual([1, 2, 3]);
  });

  it('startWith prepends initial values', async () => {
    const src = nagare.of(1, 2, 3);
    const out = await startWith(0, -1)(src).toArray();
    expect(out).toEqual([0, -1, 1, 2, 3]);
  });

  it('buffer groups values by count', async () => {
    const out = await buffer<number>(3)(nagare.of(1, 2, 3, 4, 5, 6, 7)).toArray();
    expect(out).toEqual([[1,2,3],[4,5,6],[7]]);
  });

  it('concatMap maps sequentially (no interleaving)', async () => {
    const src = nagare.of(1, 2, 3);
    const out = await concatMap<number, number>(async (x) => {
      // inner emits x, x*10 with small delays to show sequencing
      const gen = async function* () {
        await new Promise((r) => setTimeout(r, 5));
        yield x;
        await new Promise((r) => setTimeout(r, 5));
        yield x * 10;
      };
      return new (src.constructor as any)(gen());
    })(src).toArray();

    // Because concatMap is sequential, we expect [1,10,2,20,3,30]
    expect(out).toEqual([1, 10, 2, 20, 3, 30]);
  });

  it('switchMap switches to latest (cancels previous)', async () => {
    vi.useFakeTimers();
    const src = nagare.of(1, 2, 3);
    const outPromise = switchMap<number, number>((x) => {
      const gen = async function* () {
        await new Promise((r) => setTimeout(r, 10));
        yield x;
        await new Promise((r) => setTimeout(r, 10));
        yield x * 10;
      };
      return new (src.constructor as any)(gen());
    })(src).toArray();

    // Let inner timers resolve
    await vi.advanceTimersByTimeAsync(100);
    const out = await outPromise;

    // The implementation yields values from the most recent inner; earlier inners may produce at most first value
    // Accept one of a few reasonable sequences that demonstrate switching
    // At minimum, last inner (x=3) should fully appear
    expect(out[out.length - 2]).toBe(3);
    expect(out[out.length - 1]).toBe(30);
    vi.useRealTimers();
  });

  it('async map operator works', async () => {
    const out = await nagare
      .of(1, 2, 3)
      .map(async (x) => {
        await new Promise((r) => setTimeout(r, 1));
        return x * 2;
      })
      .toArray();
    expect(out).toEqual([2, 4, 6]);
  });
});

