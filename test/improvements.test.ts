import { describe, test, expect, vi } from 'vitest';
import { stream } from '../src/index';

describe('Review Improvements', () => {
  describe('1. instanceof ReadableStream', () => {
    test('Stream should be instanceof ReadableStream', () => {
      const myStream = stream.array([1, 2, 3]);
      
      // This should now return true thanks to Proxy
      expect(myStream instanceof ReadableStream).toBe(true);
    });
    
    test('Stream can be used with Response constructor', () => {
      const myStream = stream.array(['hello', 'world']);
      
      // Should not throw when passed to Response
      expect(() => new Response(myStream as unknown as BodyInit)).not.toThrow();
    });
    
    test('Stream methods are still accessible', () => {
      const myStream = stream.array([1, 2, 3]);
      
      // Check that Stream methods exist
      expect(typeof myStream.map).toBe('function');
      expect(typeof myStream.filter).toBe('function');
      expect(typeof myStream.subscribe).toBe('function');
    });
    
    test('ReadableStream methods are still accessible', () => {
      const myStream = stream.array([1, 2, 3]);
      
      // Check that ReadableStream methods exist
      expect(typeof myStream.getReader).toBe('function');
      expect(typeof myStream.tee).toBe('function');
      expect(typeof myStream.pipeTo).toBe('function');
    });
  });
  
  describe('2. Subscribe lock handling', () => {
    test('subscribe should error when stream is locked', async () => {
      const myStream = stream.array([1, 2, 3]);
      const errorHandler = vi.fn();
      
      // Lock the stream
      const reader = myStream.getReader();
      
      // Try to subscribe to locked stream
      const subscription = myStream.subscribe({
        error: errorHandler
      });
      
      // Should call error handler immediately
      expect(errorHandler).toHaveBeenCalled();
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('Cannot subscribe to locked stream')
        })
      );
      
      // Subscription should be closed
      expect(subscription.closed).toBe(true);
      
      // Clean up
      reader.releaseLock();
    });
    
    test('subscribe should work after lock is released', async () => {
      const myStream = stream.array([1, 2, 3]);
      const values: number[] = [];
      
      // Lock and immediately release
      const reader = myStream.getReader();
      reader.releaseLock();
      
      // Now subscribe should work
      await new Promise<void>((resolve) => {
        myStream.subscribe({
          next: (value) => values.push(value),
          complete: () => resolve()
        });
      });
      
      expect(values).toEqual([1, 2, 3]);
    });
  });
  
  describe('3. mapAsync error handling', () => {
    test('mapAsync should stop processing on first error', async () => {
      const processCount = vi.fn();
      const myStream = stream.array([1, 2, 3, 4, 5]);
      
      const resultStream = myStream.mapAsync(async (value) => {
        processCount();
        // Simulate delay
        await new Promise(resolve => setTimeout(resolve, 10));
        
        if (value === 3) {
          throw new Error('Error at value 3');
        }
        return value * 2;
      }, 2); // Concurrency of 2
      
      const values: number[] = [];
      const errorHandler = vi.fn();
      
      await new Promise<void>((resolve) => {
        resultStream.subscribe({
          next: (value) => values.push(value),
          error: (error) => {
            errorHandler(error);
            resolve();
          },
          complete: () => resolve()
        });
      });
      
      // Should have called error handler
      expect(errorHandler).toHaveBeenCalled();
      expect(errorHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Error at value 3'
        })
      );
      
      // Should not have processed all items
      // With concurrency 2, might process 1-4 before error stops it
      expect(processCount.mock.calls.length).toBeLessThanOrEqual(4);
    });
    
    test('mapAsync should not produce secondary errors', async () => {
      const errors: Error[] = [];
      const originalConsoleError = console.error;
      console.error = vi.fn((_message, error) => {
        if (error instanceof Error) errors.push(error);
      });
      
      const myStream = stream.array([1, 2, 3, 4, 5]);
      
      const resultStream = myStream.mapAsync(async (value) => {
        // All tasks will try to run due to concurrency
        await new Promise(resolve => setTimeout(resolve, 5));
        
        if (value === 2) {
          throw new Error('Primary error');
        }
        return value;
      }, 3); // High concurrency to trigger race conditions
      
      await new Promise<void>((resolve) => {
        resultStream.subscribe({
          error: () => resolve(),
          complete: () => resolve()
        });
      });
      
      // Restore console.error
      console.error = originalConsoleError;
      
      // Should not have any secondary "stream not writable" errors
      const secondaryErrors = errors.filter(e => 
        e.message.includes('enqueue') || 
        e.message.includes('writable') ||
        e.message.includes('closed')
      );
      expect(secondaryErrors).toHaveLength(0);
    });
    
    test('mapAsync should handle abort signal properly', async () => {
      let abortedCount = 0;
      const myStream = stream.array([1, 2, 3, 4, 5, 6, 7, 8]);
      
      const resultStream = myStream.mapAsync(async (value) => {
        try {
          // Simulate async work
          await new Promise((resolve) => {
            setTimeout(resolve, 20);
          });
          
          if (value === 3) {
            throw new Error('Trigger abort');
          }
          
          return value * 2;
        } catch (error) {
          // Count aborted operations
          if ((error as unknown as { name?: string })?.name === 'AbortError') {
            abortedCount++;
          }
          throw error;
        }
      }, 4); // High concurrency
      
      const values: number[] = [];
      
      await new Promise<void>((resolve) => {
        resultStream.subscribe({
          next: (value) => values.push(value),
          error: () => resolve(),
          complete: () => resolve()
        });
      });
      
      // Should have processed some values but not all
      expect(values.length).toBeLessThan(8);
    });
  });
});