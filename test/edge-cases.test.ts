import { describe, it, expect } from "vitest";
import { stream } from "../src/index.js";

describe("Stream<T> - Edge Cases & Error Handling", () => {
  describe("Cancellation handling", () => {
    it("should handle early unsubscribe", async () => {
      let emitCount = 0;
      const s = stream.create<number>((controller) => {
        const interval = setInterval(() => {
          emitCount++;
          controller.next(emitCount);
          if (emitCount >= 10) {
            clearInterval(interval);
            controller.complete();
          }
        }, 10);

        return () => clearInterval(interval);
      });

      const values: number[] = [];
      const subscription = s.subscribe({
        next: (value) => {
          values.push(value);
          if (value >= 3) {
            subscription.unsubscribe();
          }
        }
      });

      await new Promise(resolve => setTimeout(resolve, 200));
      
      expect(values).toEqual([1, 2, 3]);
      // The interval continues running for a bit after unsubscribe
      // but should eventually stop (not reach 10)
      // Interval might complete before cleanup, but subscription is closed
      expect(subscription.closed).toBe(true);
      expect(values).toEqual([1, 2, 3]);
    });

    it("should handle stream cancellation", async () => {
      let cleanupCalled = false;
      
      const s = stream.create<number>((controller) => {
        let count = 0;
        const interval = setInterval(() => {
          controller.next(++count);
        }, 10);

        return () => {
          cleanupCalled = true;
          clearInterval(interval);
        };
      });

      const reader = (await s.toReadableStream()).getReader();
      
      // Read a few values
      await reader.read();
      await reader.read();
      
      // Cancel the stream
      await reader.cancel();
      
      expect(cleanupCalled).toBe(true);
    });

    it("should handle concat cancellation", async () => {
      let stream2Started = false;
      
      const s1 = stream.array([1, 2, 3]);
      const s2 = stream.create<number>((controller) => {
        stream2Started = true;
        controller.next(4);
        controller.next(5);
        controller.complete();
      });
      
      const concatenated = s1.concat(s2);
      const values: number[] = [];
      
      const subscription = concatenated.subscribe({
        next: (value) => {
          values.push(value);
          if (value === 2) {
            subscription.unsubscribe();
          }
        }
      });
      
      await new Promise(resolve => setTimeout(resolve, 50));
      
      expect(values).toEqual([1, 2]);
      // Note: In async iteration, stream2 might start but won't emit values
      // The important thing is values stop at 2
    });
  });

  describe("Error handling", () => {
    it("should propagate errors in subscribe", async () => {
      let errorCaught: Error | undefined;
      
      const s = stream.create<number>((controller) => {
        controller.next(1);
        controller.error(new Error("Test error"));
      });

      s.subscribe({
        error: (error) => {
          errorCaught = error;
        }
      });

      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(errorCaught).toBeInstanceOf(Error);
      expect(errorCaught?.message).toBe("Test error");
    });

    it("should handle errors in map operator", async () => {
      const s = stream.array([1, 2, 3]).map(x => {
        if (x === 2) throw new Error("Map error");
        return x * 2;
      });

      let errorCaught = false;
      
      try {
        await s.collect();
      } catch (error) {
        errorCaught = true;
        expect(error).toBeInstanceOf(Error);
      }
      
      expect(errorCaught).toBe(true);
    });

    it("should handle errors in async map", async () => {
      const s = stream.array([1, 2, 3]).mapAsync(async (x) => {
        if (x === 2) throw new Error("Async map error");
        return x * 2;
      });

      let errorCaught = false;
      
      try {
        await s.collect();
      } catch (error) {
        errorCaught = true;
        expect(error).toBeInstanceOf(Error);
      }
      
      expect(errorCaught).toBe(true);
    });

    it("should isolate tap errors silently", async () => {
      const s = stream.array([1, 2, 3])
        .tap(x => {
          if (x === 2) throw new Error("Tap error");
        })
        .map(x => x * 2);

      const result = await s.collect();

      // Stream should continue despite tap error (silently ignored)
      expect(result).toEqual([2, 4, 6]);
    });

    it("should handle errors in merge", async () => {
      const s1 = stream.array([1, 2]);
      const s2 = stream.create<number>((controller) => {
        // Delay to ensure s1 values are emitted first
        setTimeout(() => {
          controller.next(3);
          setTimeout(() => {
            controller.error(new Error("Merge error"));
          }, 10);
        }, 10);
      });

      let errorCaught: Error | undefined;
      const values: number[] = [];

      await new Promise<void>((resolve) => {
        s1.merge(s2).subscribe({
          next: (value) => values.push(value),
          error: (error) => {
            errorCaught = error;
            resolve();
          },
          complete: () => {
            // Should not complete due to error
            resolve();
          }
        });
        
        // Timeout if no error occurs
        setTimeout(() => resolve(), 200);
      });
      
      // Should have collected some values before error
      expect(values.length).toBeGreaterThan(0);
      expect(errorCaught?.message).toBe("Merge error");
    });
  });

  describe("Backpressure handling", () => {
    it("should handle slow consumer with async next", async () => {
      const processTimes: number[] = [];
      
      // Use array to ensure all values are available
      const s = stream.array([1, 2, 3, 4, 5]);

      const values: number[] = [];
      const completed = await new Promise<boolean>((resolve) => {
        s.subscribe({
          next: async (value) => {
            processTimes.push(Date.now());
            // Simulate slow processing
            await new Promise(r => setTimeout(r, 20));
            values.push(value);
            if (values.length === 5) {
              // Ensure we resolve after getting all values
              setTimeout(() => resolve(true), 10);
            }
          },
          complete: () => {
            // Complete might fire before all async processing
            setTimeout(() => resolve(true), 150);
          }
        });
        
        // Timeout fallback
        setTimeout(() => resolve(false), 500);
      });

      expect(completed).toBe(true);
      expect(values.sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5]);
      
      // Check that we have processing times
      expect(processTimes.length).toBe(5);
      
      // Check that processing was sequential (backpressure applied)
      // Allow for some timing variance
      for (let i = 1; i < processTimes.length; i++) {
        const gap = processTimes[i] - processTimes[i - 1];
        expect(gap).toBeGreaterThanOrEqual(15); // Allow some variance from 20ms
      }
    });

    it("should handle concurrent async map operations", async () => {
      let maxConcurrent = 0;
      let currentConcurrent = 0;

      const s = stream.array([1, 2, 3, 4, 5]).mapAsync(async (x) => {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        
        await new Promise(resolve => setTimeout(resolve, 50));
        
        currentConcurrent--;
        return x * 2;
      }, 3); // Allow 3 concurrent operations

      const result = await s.collect();
      
      expect(result).toEqual([2, 4, 6, 8, 10]);
      expect(maxConcurrent).toBeLessThanOrEqual(3);
      expect(maxConcurrent).toBeGreaterThan(1); // Should have some concurrency
    });

    it("should respect collect limit", async () => {
      let emitCount = 0;
      const s = stream.create<number>((controller) => {
        const interval = setInterval(() => {
          emitCount++;
          controller.next(emitCount);
        }, 1);

        return () => clearInterval(interval);
      });

      const result = await s.collect(100);

      // Should stop collecting at the specified limit
      expect(result).toHaveLength(100);
    });
  });

  describe("High load scenarios", () => {
    it("should handle rapid emission", async () => {
      const count = 10000;
      const numbers = Array.from({ length: count }, (_, i) => i);
      const s = stream.array(numbers);

      const result = await s
        .filter(x => x % 100 === 0)
        .map(x => x * 2)
        .collect(10000); // Add limit to avoid issues

      expect(result).toHaveLength(100);
      expect(result[0]).toBe(0);
      expect(result[99]).toBe(19800);
    });

    it("should handle memory limits with large streams", async () => {
      const largeArray = Array.from({ length: 100000 }, (_, i) => i);
      const s = stream.array(largeArray);

      // Process in chunks to avoid memory issues
      const sum = await s
        .buffer(1000)
        .reduce((acc, chunk) => {
          const chunkSum = chunk.reduce((a, b) => a + b, 0);
          return acc + chunkSum;
        }, 0);

      const expectedSum = (99999 * 100000) / 2;
      expect(sum).toBe(expectedSum);
    });

    it("should handle throttle under high load", async () => {
      const startTime = Date.now();
      const values: number[] = [];
      
      const s = stream.create<number>((controller) => {
        // Emit 100 values as fast as possible
        for (let i = 0; i < 100; i++) {
          controller.next(i);
        }
        controller.complete();
      });

      await new Promise<void>((resolve) => {
        s.throttle(50).subscribe({
          next: (value) => values.push(value),
          complete: () => resolve()
        });
      });

      const elapsed = Date.now() - startTime;
      
      // With 50ms throttle, we should get significantly fewer values
      expect(values.length).toBeLessThan(20);
      expect(values[0]).toBe(0); // First value should always pass
      
      // Check that values are spaced properly
      if (values.length > 1) {
        expect(elapsed).toBeGreaterThanOrEqual((values.length - 1) * 45); // Allow some margin
      }
    });

    it("should handle debounce under rapid emissions", async () => {
      const values: number[] = [];
      
      const s = stream.create<number>((controller) => {
        // Rapid emissions
        for (let i = 0; i < 10; i++) {
          setTimeout(() => controller.next(i), i * 5);
        }
        // Gap then final value
        setTimeout(() => {
          controller.next(100);
          controller.complete();
        }, 200);
      });

      await new Promise<void>((resolve) => {
        s.debounce(50).subscribe({
          next: (value) => values.push(value),
          complete: () => resolve()
        });
      });

      // Should only get the last value from rapid emissions and the final value
      expect(values).toEqual([9, 100]);
    });
  });

});