import { describe, it, expect, beforeAll, vi } from 'vitest';
import { nagare } from '../src';
import { loadWasm } from '../src/wasm-loader';

describe('Combination', () => {
  beforeAll(async () => {
    await loadWasm();
  });

  it('merge interleaves values from async sources', async () => {
    vi.useFakeTimers();

    const g1 = async function* () {
      await new Promise((r) => setTimeout(r, 10));
      yield 1;
      await new Promise((r) => setTimeout(r, 20));
      yield 3;
    };
    const g2 = async function* () {
      await new Promise((r) => setTimeout(r, 5));
      yield 2;
      await new Promise((r) => setTimeout(r, 30));
      yield 4;
    };

    const r1 = nagare.from(g1());
    const r2 = nagare.from(g2());

    const merged = nagare.merge(r1, r2);
    const p = merged.toArray();
    await vi.advanceTimersByTimeAsync(100);
    const out = await p;

    // Check content regardless of exact order
    expect(out.sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    vi.useRealTimers();
  });

  it('combine (zip-like) pairs sequential nexts from sources', async () => {
    vi.useFakeTimers();
    const g1 = async function* () {
      await new Promise((r) => setTimeout(r, 10));
      yield 'a';
      await new Promise((r) => setTimeout(r, 20));
      yield 'b';
    };
    const g2 = async function* () {
      await new Promise((r) => setTimeout(r, 20));
      yield 1;
      await new Promise((r) => setTimeout(r, 20));
      yield 2;
    };

    const outPromise = nagare.combine(nagare.from(g1()), nagare.from(g2())).toArray();
    await vi.advanceTimersByTimeAsync(100);
    const out = await outPromise;

    // Current implementation pairs the next of each concurrently (zip-like)
    expect(out).toEqual([
      ['a', 1],
      ['b', 2],
    ]);
    vi.useRealTimers();
  });
});
