import { describe, it, expect, beforeAll } from 'vitest';
import { loadWasm, ensureWasmLoaded, wasmModule } from '../src/wasm-loader';
import { processFloat32Batch } from '../src/operators';

const REAL = process.env.NAGARE_TEST_REAL_WASM === 'true';

describe('Real WASM (opt-in)', () => {
  beforeAll(async () => {
    if (REAL) await loadWasm();
  });

  (REAL ? it : it.skip)('exports are present and functional', async () => {
    await ensureWasmLoaded();
    expect(typeof wasmModule).toBe('object');
    expect(typeof wasmModule.process_float32_batch).toBe('function');
    expect(typeof wasmModule.CreditController).toBe('function');

    const out = await processFloat32Batch(new Float32Array([1, 2, 3]), 'square');
    expect(Array.from(out)).toEqual([1, 4, 9]);
  });
});

