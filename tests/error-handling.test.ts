import { describe, it, expect, beforeAll } from 'vitest';
import { nagare, Nagare } from '../src';
import { loadWasm } from '../src/wasm-loader';

describe('Error Handling', () => {
  beforeAll(async () => {
    await loadWasm();
  });

  it('drops errored values without rescue and continues', async () => {
    // Disable JIT to avoid fusion-side duplication with thrown errors
    const prev = Nagare.getJitMode?.() ?? 'fast';
    Nagare.setJitMode('off');
    const gen = async function* () {
      yield 1; yield 2; yield 3; yield 4;
    };
    const out = await nagare
      .from(gen())
      .map((x) => {
        if (x === 2) throw new Error('boom');
        return x;
      })
      .toArray();

    // 2 is dropped, others pass
    expect(out).toEqual([1, 3, 4]);
    Nagare.setJitMode(prev as any);
  });

  it('rescue replaces value and stream continues', async () => {
    const out = await nagare
      .of(1, 2, 3)
      .map((x) => {
        if (x === 2) throw new Error('boom');
        return x;
      })
      .rescue(() => 99)
      .toArray();

    expect(out).toEqual([1, 99, 3]);
  });

  it('terminateOnErrorMode stops the stream early', async () => {
    const gen = async function* () { yield 1; yield 2; yield 3; };
    const n = nagare
      .from(gen())
      .map((x) => {
        if (x === 2) throw new Error('boom');
        return x;
      })
      .terminateOnErrorMode();

    const seen: number[] = [];
    await new Promise<void>((resolve) => {
      n.observe(
        (v) => {
          seen.push(v);
        },
        {
          onComplete: () => resolve(),
          onError: () => resolve(),
        }
      );
      // Safety timer to avoid hanging
      setTimeout(resolve, 20);
    });

    // Stream should terminate without delivering the error-causing value
    expect(seen[0]).toBe(1);
    expect(seen.includes(2)).toBe(false);
  });
});
