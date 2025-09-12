import { describe, it, expect, beforeAll } from 'vitest';
import { nagare, Nagare, distinctUntilChanged, startWith } from '../src';
import { loadWasm } from '../src/wasm-loader';

// RxJS imports for parity checks
import { from, of } from 'rxjs';
import { map as rxMap, filter as rxFilter, scan as rxScan, take as rxTake, skip as rxSkip, pairwise as rxPairwise, distinctUntilChanged as rxDistinctUntilChanged, startWith as rxStartWith, toArray as rxToArray } from 'rxjs';
import { lastValueFrom } from 'rxjs';

describe('RxJS Parity', () => {
  beforeAll(async () => {
    await loadWasm();
    // Disable JIT fusion to verify semantic parity first
    Nagare.setJitMode('off');
  });

  it('map/filter pipeline matches RxJS', async () => {
    const src = [1, 2, 3, 4, 5];

    const nOut = await nagare
      .of(...src)
      .filter((x) => x % 2 === 0)
      .map((x) => x * 10)
      .toArray();

    const rxOut = await lastValueFrom(
      from(src).pipe(
        rxFilter((x) => x % 2 === 0),
        rxMap((x) => x * 10),
        rxToArray()
      )
    );

    expect(nOut).toEqual(rxOut);
  });

  // Skip/Take semantics are covered in core Nagare tests

  it('pairwise matches RxJS', async () => {
    const src = [1, 2, 3, 4];

    const nOut = await nagare.of(...src).pairwise().toArray();

    const rxOut = await lastValueFrom(
      from(src).pipe(rxPairwise(), rxToArray())
    );

    expect(nOut).toEqual(rxOut);
  });

  it('distinctUntilChanged + startWith matches RxJS', async () => {
    const src = [1, 1, 2, 2, 3, 3];

    const rxOut = await lastValueFrom(
      from(src).pipe(rxDistinctUntilChanged(), rxStartWith(0), rxToArray())
    );

    const nOut = await startWith(0)(distinctUntilChanged<number>()(nagare.of(...src))).toArray();
    expect(nOut).toEqual(rxOut);
  });
});
