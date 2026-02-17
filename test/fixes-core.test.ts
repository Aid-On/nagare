/**
 * Core functionality tests for review fixes
 * Focus on essential features without SSE
 */

import { describe, it, expect, vi } from 'vitest';
import { stream } from '../src/index.js';

describe('Core Review Fixes', () => {
  
  describe('mapAsync - Order Preservation', () => {
    it('should maintain order with concurrency > 1', async () => {
      const delays = [100, 50, 150, 25, 75];
      const input = [1, 2, 3, 4, 5];
      
      const result = await stream.array(input)
        .mapAsync(async (value, index = 0) => {
          // Simulate different processing times
          await new Promise(resolve => setTimeout(resolve, delays[index] || 10));
          return value * 2;
        }, 3) // concurrency of 3
        .collect();
      
      // Order must be preserved despite concurrent processing
      expect(result).toEqual([2, 4, 6, 8, 10]);
    });

    it('should process items in parallel but emit in order', async () => {
      const processingOrder: number[] = [];
      const emissionOrder: number[] = [];
      
      const result = await stream.array([1, 2, 3, 4])
        .mapAsync(async (value) => {
          processingOrder.push(value);
          // Later items process faster
          const delay = (5 - value) * 10;
          await new Promise(resolve => setTimeout(resolve, delay));
          return value;
        }, 4) // Full parallelism
        .tap(value => emissionOrder.push(value))
        .collect();
      
      // Processing can be in any order
      expect(processingOrder.length).toBe(4);
      
      // But emission must be in original order
      expect(emissionOrder).toEqual([1, 2, 3, 4]);
      expect(result).toEqual([1, 2, 3, 4]);
    });
  });

  describe('tap - Error Handling', () => {
    it('should swallow errors by default', async () => {
      const result = await stream.array([1, 2, 3])
        .tap(() => {
          throw new Error('Tap error');
        })
        .collect();
      
      expect(result).toEqual([1, 2, 3]);
    });

    it('should rethrow errors when option is set', async () => {
      await expect(
        stream.array([1, 2, 3])
          .tap(() => {
            throw new Error('Rethrow me');
          }, { rethrow: true })
          .collect()
      ).rejects.toThrow('Rethrow me');
    });

    it('should silently ignore errors when rethrow is disabled', async () => {
      const result = await stream.array([1, 2, 3])
        .tap((value) => {
          if (value === 2) throw new Error('Error at 2');
        })
        .collect();

      // Stream should continue despite tap error, no console output
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe('takeUntil - Termination', () => {
    it('should stop at predicate', async () => {
      const result = await stream.array([1, 2, 3, 4, 5])
        .takeUntil(value => value === 3)
        .collect();
      
      expect(result).toEqual([1, 2]);
    });

    it('should handle empty streams', async () => {
      const result = await stream.array([])
        .takeUntil(value => value === 5)
        .collect();
      
      expect(result).toEqual([]);
    });

    it('should handle predicate that never matches', async () => {
      const result = await stream.array([1, 2, 3])
        .takeUntil(() => false)
        .collect();
      
      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe('subscribe - tee() behavior', () => {
    it('should lock stream after first subscription', async () => {
      const s = stream.array([1, 2, 3]);
      
      const values1: number[] = [];
      s.subscribe({
        next: (value) => values1.push(value)
      });
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      let errorMessage = '';
      s.subscribe({
        next: () => {},
        error: (error) => errorMessage = error.message
      });
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(values1).toEqual([1, 2, 3]);
      expect(errorMessage).toContain('locked stream');
    });

    it('should allow multiple subscriptions via tee()', async () => {
      const original = stream.array([1, 2, 3]);
      const [r1, r2] = original.tee();
      
      // Convert back to Stream
      const s1 = stream.from(r1);
      const s2 = stream.from(r2);
      
      const values1: number[] = [];
      const values2: number[] = [];
      
      s1.subscribe({
        next: (value) => values1.push(value)
      });
      
      s2.subscribe({
        next: (value) => values2.push(value * 2)
      });
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(values1).toEqual([1, 2, 3]);
      expect(values2).toEqual([2, 4, 6]);
    });
  });

  describe('Type Exports', () => {
    it('should export StreamPipeOptions', () => {
      // Compile-time test
      const options: import('../src/index.js').StreamPipeOptions = {
        preventClose: true,
        preventAbort: false,
        preventCancel: false,
        signal: new AbortController().signal
      };
      
      expect(options.preventClose).toBe(true);
    });
  });
});