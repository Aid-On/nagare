import { describe, it, expect, beforeAll } from 'vitest';
import { river, River } from '../src';
import { loadWasm } from '../src/wasm-loader';

describe('River', () => {
  beforeAll(async () => {
    await loadWasm();
  });

  describe('Creation', () => {
    it('should create a river from array', async () => {
      const r = river.of(1, 2, 3, 4, 5);
      const result = await r.toArray();
      expect(result).toEqual([1, 2, 3, 4, 5]);
    });

    it('should create a river from range', async () => {
      const r = river.range(0, 5);
      const result = await r.toArray();
      expect(result).toEqual([0, 1, 2, 3, 4]);
    });

    it('should create an empty river', async () => {
      const r = river.empty<number>();
      const result = await r.toArray();
      expect(result).toEqual([]);
    });

    it('should create a river from promise', async () => {
      const r = river.fromPromise(Promise.resolve(42));
      const result = await r.toArray();
      expect(result).toEqual([42]);
    });
  });

  describe('Operators', () => {
    it('should map values', async () => {
      const r = river.of(1, 2, 3).map(x => x * 2);
      const result = await r.toArray();
      expect(result).toEqual([2, 4, 6]);
    });

    it('should filter values', async () => {
      const r = river.of(1, 2, 3, 4, 5).filter(x => x % 2 === 0);
      const result = await r.toArray();
      expect(result).toEqual([2, 4]);
    });

    it('should scan values', async () => {
      const r = river.of(1, 2, 3).scan((acc, x) => acc + x, 0);
      const result = await r.toArray();
      expect(result).toEqual([1, 3, 6]);
    });

    it('should take first n values', async () => {
      const r = river.of(1, 2, 3, 4, 5).take(3);
      const result = await r.toArray();
      expect(result).toEqual([1, 2, 3]);
    });

    it('should skip first n values', async () => {
      const r = river.of(1, 2, 3, 4, 5).skip(2);
      const result = await r.toArray();
      expect(result).toEqual([3, 4, 5]);
    });
  });

  describe('Fork and Merge', () => {
    it('should fork a river', async () => {
      const r = river.of(1, 2, 3, 4, 5);
      const [even, odd] = r.fork(x => x % 2 === 0);
      
      const evenResult = await even.toArray();
      const oddResult = await odd.toArray();
      
      expect(evenResult).toEqual([2, 4]);
      expect(oddResult).toEqual([1, 3, 5]);
    });

    it('should merge rivers', async () => {
      const r1 = river.of(1, 3, 5);
      const r2 = river.of(2, 4, 6);
      const merged = river.merge(r1, r2);
      
      const result = await merged.toArray();
      expect(result.sort()).toEqual([1, 2, 3, 4, 5, 6]);
    });
  });

  describe('Aggregations', () => {
    it('should get first value', async () => {
      const r = river.of(1, 2, 3);
      const first = await r.first();
      expect(first).toBe(1);
    });

    it('should get last value', async () => {
      const r = river.of(1, 2, 3);
      const last = await r.last();
      expect(last).toBe(3);
    });

    it('should count values', async () => {
      const r = river.of(1, 2, 3, 4, 5);
      const count = await r.count();
      expect(count).toBe(5);
    });

    it('should check if all values match predicate', async () => {
      const r = river.of(2, 4, 6);
      const allEven = await r.all(x => x % 2 === 0);
      expect(allEven).toBe(true);
    });

    it('should check if some values match predicate', async () => {
      const r = river.of(1, 2, 3);
      const hasEven = await r.some(x => x % 2 === 0);
      expect(hasEven).toBe(true);
    });
  });

  describe('Windowed Aggregates', () => {
    it('should calculate rolling mean', async () => {
      const r = river.of(1, 2, 3, 4, 5);
      const windowed = r.windowedAggregate(3, 'mean');
      const result = await windowed.toArray();
      // Window of size 3: [1,2,3]=6/3=2, [2,3,4]=9/3=3, [3,4,5]=12/3=4
      expect(result).toEqual([2, 3, 4]);
    });

    it('should calculate rolling sum', async () => {
      const r = river.of(1, 2, 3, 4, 5);
      const windowed = r.windowedAggregate(2, 'sum');
      const result = await windowed.toArray();
      // Window of size 2: [1,2]=3, [2,3]=5, [3,4]=7, [4,5]=9
      // But current implementation keeps window: [1,2]=3, [1,2,3]=5, [1,2,3,4]=9, etc.
      // Actually it's a sliding window, so the expected values are:
      // [1,2]=3, [2,3]=5, [3,4]=7, [4,5]=9
      expect(result).toEqual([3, 5, 7, 9]);
    });
  });

  describe('Observable Pattern', () => {
    it('should observe values', async () => {
      const values: number[] = [];
      const r = river.of(1, 2, 3);
      
      await new Promise<void>((resolve) => {
        const subscription = r.observe(
          (value) => values.push(value),
          { onComplete: resolve }
        );
      });
      
      expect(values).toEqual([1, 2, 3]);
    });

    it('should unsubscribe', async () => {
      const values: number[] = [];
      const r = river.interval(10);
      
      const subscription = r.observe((value) => values.push(value));
      
      await new Promise(resolve => setTimeout(resolve, 50));
      subscription.unsubscribe();
      
      const countBefore = values.length;
      await new Promise(resolve => setTimeout(resolve, 50));
      const countAfter = values.length;
      
      expect(countBefore).toBe(countAfter);
    });

    it('should handle errors with rescue', async () => {
      const r = river.of(1, 2, 3)
        .map(x => {
          if (x === 2) throw new Error('test error');
          return x;
        })
        .rescue(() => 99);
      
      const result = await r.toArray();
      expect(result).toEqual([1, 99, 3]);
    });
  });

  describe('Stream Conversion', () => {
    it('should convert to ReadableStream', async () => {
      const r = river.of(1, 2, 3);
      const stream = r.toReadableStream();
      
      const reader = stream.getReader();
      const values: number[] = [];
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        values.push(value);
      }
      
      expect(values).toEqual([1, 2, 3]);
    });

    it('should create from ReadableStream', async () => {
      const stream = new ReadableStream<number>({
        start(controller) {
          controller.enqueue(1);
          controller.enqueue(2);
          controller.enqueue(3);
          controller.close();
        },
      });
      
      const r = River.fromReadableStream(stream);
      const result = await r.toArray();
      expect(result).toEqual([1, 2, 3]);
    });
  });
});