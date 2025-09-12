import { describe, it, expect, beforeAll, vi } from 'vitest';
import { nagare, Nagare } from '../src';
import { loadWasm } from '../src/wasm-loader';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('combineLatest', () => {
  beforeAll(async () => {
    await loadWasm();
    Nagare.setJitMode('off');
  });

  it('emits after all sources have at least one value, then on any update', async () => {
    vi.useFakeTimers();

    const g1 = async function* () {
      await delay(10); // t=10
      yield 'a1';
      await delay(20); // t=30
      yield 'a2';
    };
    const g2 = async function* () {
      await delay(20); // t=20
      yield 1;
      await delay(20); // t=40
      yield 2;
    };

    const outP = nagare.combineLatest(nagare.from(g1()), nagare.from(g2())).toArray();
    await vi.advanceTimersByTimeAsync(100);
    const out = await outP;

    // At t=20, both have emitted => ['a1', 1]
    // At t=30, g1 updates => ['a2', 1]
    // At t=40, g2 updates => ['a2', 2]
    expect(out).toEqual([
      ['a1', 1],
      ['a2', 1],
      ['a2', 2],
    ]);
    vi.useRealTimers();
  });
});

