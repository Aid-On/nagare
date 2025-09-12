import { describe, it, expect, beforeAll, vi } from 'vitest';
import { nagare, debounce, bufferTime, Nagare } from '../src';
import { loadWasm } from '../src/wasm-loader';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Time-based Operators', () => {
  beforeAll(async () => {
    await loadWasm();
    Nagare.setJitMode('off');
  });

  it('debounce emits last value after quiet period', async () => {
    vi.useFakeTimers();
    const src = async function* () {
      yield 1;
      await delay(5);
      yield 2;
      await delay(20);
      yield 3;
    };

    const outP = debounce<number>(10)(nagare.from(src())).toArray();
    await vi.advanceTimersByTimeAsync(50);
    const out = await outP;
    expect(out).toEqual([2, 3]);
    vi.useRealTimers();
  });

  it('bufferTime groups values by window', async () => {
    vi.useFakeTimers();
    const src = async function* () {
      yield 1; // t=0
      await delay(5);
      yield 2; // t=5
      await delay(10);
      yield 3; // t=15
      await delay(10);
      yield 4; // t=25
    };

    const outP = bufferTime<number>(10)(nagare.from(src())).toArray();
    await vi.advanceTimersByTimeAsync(100);
    const out = await outP;
    expect(out).toEqual([[1, 2], [3], [4]]);
    vi.useRealTimers();
  });
});

