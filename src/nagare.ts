import type { Disposable, Subscription, ErrorHandler } from './types';
import { loadWasm, wasmModule } from './wasm-loader';

export class Nagare<T, E = never> implements AsyncIterable<T> {
  protected source: AsyncIterable<T> | Iterable<T> | ReadableStream<T>;
  protected operators: Array<(value: T) => T | Promise<T> | undefined> = [];
  protected errorHandler?: ErrorHandler<E>;
  protected terminateOnError = false;
  private _originalArraySource?: any[];

  constructor(source: AsyncIterable<T> | Iterable<T> | ReadableStream<T> | T[]) {
    if (Array.isArray(source)) {
      this.source = source;
      this._originalArraySource = source;
    } else {
      this.source = source;
    }
  }

  observe(
    next: (value: T) => void,
    options?: {
      signal?: AbortSignal;
      onError?: (error: E) => void;
      onComplete?: () => void;
    }
  ): Disposable & Subscription {
    const controller = new AbortController();
    const signal = options?.signal;
    
    let active = true;
    const unsubscribe = () => {
      active = false;
      controller.abort();
    };

    const subscription = {
      unsubscribe,
      get isActive() { return active; },
      [Symbol.dispose]: unsubscribe,
      [Symbol.asyncDispose]: async () => unsubscribe(),
    };

    (async () => {
      try {
        for await (const value of this) {
          if (!active || signal?.aborted || controller.signal.aborted) break;
          
          try {
            const processed = this.applyOperators(value);
            const result = processed instanceof Promise ? await processed : processed;
            if (result !== undefined) {
              next(result);
            }
          } catch (error) {
            if (options?.onError) {
              options.onError(error as E);
            }
            if (this.terminateOnError) {
              break;
            }
          }
        }
        
        if (active && !signal?.aborted) {
          options?.onComplete?.();
        }
      } catch (error) {
        if (options?.onError) {
          options.onError(error as E);
        }
      } finally {
        active = false;
      }
    })();

    return subscription;
  }

  private applyOperators(value: T): T | undefined | Promise<T | undefined> {
    let current: T | undefined = value;
    
    for (const op of this.operators) {
      if (current === undefined) break;
      try {
        const result = op(current);
        if (result instanceof Promise) {
          return this.applyOperatorsAsync(value);
        }
        current = result;
      } catch (error) {
        if (this.errorHandler) {
          const recovered = this.errorHandler(error as E);
          current = recovered as T | undefined;
          if (current !== undefined) {
            break;
          }
        } else if (this.terminateOnError) {
          throw error;
        } else {
          current = undefined;
          break;
        }
      }
    }
    
    return current;
  }

  private async applyOperatorsAsync(value: T): Promise<T | undefined> {
    let current: T | undefined = value;
    
    for (const op of this.operators) {
      if (current === undefined) break;
      try {
        const result = op(current);
        current = result instanceof Promise ? await result : result;
      } catch (error) {
        if (this.errorHandler) {
          const recovered = this.errorHandler(error as E);
          current = recovered as T | undefined;
          if (current !== undefined) {
            break;
          }
        } else if (this.terminateOnError) {
          throw error;
        } else {
          current = undefined;
          break;
        }
      }
    }
    
    return current;
  }

  private async *asyncFallback(remaining: T[]): AsyncGenerator<T> {
    for (const value of remaining) {
      const processed = this.applyOperators(value);
      const result = processed instanceof Promise ? await processed : processed;
      if (result !== undefined) yield result;
    }
  }

  map<U>(fn: (value: T) => U | Promise<U>): Nagare<U, E> {
    const newNagare = new Nagare<U, E>(this as any);
    newNagare.operators = [...this.operators, fn as any];
    newNagare.errorHandler = this.errorHandler;
    newNagare.terminateOnError = this.terminateOnError;
    newNagare._originalArraySource = this._originalArraySource;
    return newNagare;
  }

  filter(predicate: (value: T) => boolean | Promise<boolean>): Nagare<T, E> {
    const newNagare = new Nagare<T, E>(this);
    const filterOp = (value: T): T | undefined | Promise<T | undefined> => {
      const result = predicate(value);
      if (result instanceof Promise) {
        return result.then(shouldKeep => shouldKeep ? value : undefined);
      }
      return result ? value : undefined;
    };
    newNagare.operators = [...this.operators, filterOp as any];
    newNagare.errorHandler = this.errorHandler;
    newNagare.terminateOnError = this.terminateOnError;
    newNagare._originalArraySource = this._originalArraySource;
    return newNagare;
  }

  scan<U>(
    fn: (acc: U, value: T) => U | Promise<U>,
    initial: U
  ): Nagare<U, E> {
    let accumulator = initial;
    return this.map(async (value) => {
      const result = fn(accumulator, value);
      accumulator = result instanceof Promise ? await result : result;
      return accumulator;
    });
  }

  take(count: number): Nagare<T, E> {
    let taken = 0;
    return this.filter(() => taken++ < count);
  }

  skip(count: number): Nagare<T, E> {
    let skipped = 0;
    return this.filter(() => ++skipped > count);
  }

  fork(predicate: (value: T) => boolean): [Nagare<T, E>, Nagare<T, E>] {
    const left = this.filter(predicate);
    const right = this.filter((v) => !predicate(v));
    return [left, right];
  }

  merge<U>(...others: Nagare<U, E>[]): Nagare<T | U, E> {
    const sources = [this, ...others];
    const generator = async function* (): AsyncGenerator<T | U> {
      const iterators = sources.map(s => s[Symbol.asyncIterator]());
      let activePromises = new Map<number, Promise<{i: number, r: IteratorResult<T | U>}>>();
      
      // Initialize promises for all iterators
      for (let i = 0; i < iterators.length; i++) {
        activePromises.set(i, iterators[i].next().then(r => ({ i, r })));
      }
      
      while (activePromises.size > 0) {
        const { i, r } = await Promise.race(activePromises.values());
        
        if (r.done) {
          activePromises.delete(i);
        } else {
          yield r.value;
          // Queue next value from this iterator
          activePromises.set(i, iterators[i].next().then(r => ({ i, r })));
        }
      }
    };
    return new Nagare<T | U, E>(generator());
  }

  rescue(handler: (error: unknown) => T | undefined): Nagare<T, E> {
    const newNagare = new Nagare<T, E>(this);
    newNagare.operators = [...this.operators];
    newNagare.errorHandler = handler as any;
    newNagare.terminateOnError = this.terminateOnError;
    return newNagare;
  }

  terminateOnErrorMode(): Nagare<T, E> {
    const newNagare = new Nagare<T, E>(this);
    newNagare.terminateOnError = true;
    return newNagare;
  }

  async mapWasm(kernelName: string, _params?: any): Promise<Nagare<T, E>> {
    await loadWasm();
    const newNagare = new Nagare<T, E>(this);
    
    newNagare.operators.push((value: T) => {
      if (!wasmModule) throw new Error('WASM module not loaded');
      
      if (value instanceof Float32Array) {
        const result = wasmModule.process_float32_batch(value, kernelName);
        return result as any;
      }
      
      return value;
    });
    
    return newNagare;
  }

  windowedAggregate(windowSize: number, operation: string): Nagare<number, E> {
    let window: number[] = [];
    const self = this;
    
    const generator = async function* (): AsyncGenerator<number> {
      for await (const value of self) {
        if (typeof value !== 'number') {
          throw new Error('windowedAggregate requires numeric values');
        }
        
        window.push(value);
        
        if (window.length === windowSize) {
          let result: number;
          switch (operation) {
            case 'mean':
              result = window.reduce((a, b) => a + b, 0) / window.length;
              break;
            case 'sum':
              result = window.reduce((a, b) => a + b, 0);
              break;
            case 'max':
              result = Math.max(...window);
              break;
            case 'min':
              result = Math.min(...window);
              break;
            default:
              throw new Error(`Unknown operation: ${operation}`);
          }
          yield result;
          window.shift(); // Remove first element for sliding window
        }
      }
    };
    
    return new Nagare<number, E>(generator());
  }

  toReadableStream(): ReadableStream<T> {
    const iterator = this[Symbol.asyncIterator]();
    
    return new ReadableStream<T>({
      async pull(controller) {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      },
    });
  }

  static fromReadableStream<T>(stream: ReadableStream<T>): Nagare<T> {
    return new Nagare<T>(stream);
  }

  static from<T>(source: AsyncIterable<T> | Iterable<T> | Promise<T>): Nagare<T> {
    if (source instanceof Promise) {
      const generator = async function* (): AsyncGenerator<T> {
        yield await source;
      };
      return new Nagare<T>(generator());
    }
    return new Nagare<T>(source);
  }

  static empty<T>(): Nagare<T> {
    return new Nagare<T>([]);
  }

  static of<T>(...values: T[]): Nagare<T> {
    return new Nagare<T>(values);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.source instanceof Nagare) {
      // Handle nested Nagare sources (from chained operations like rescue, map, etc.)
      // Propagate error handler to the source river to ensure errors are caught at the right level
      if (this.errorHandler && !this.source.errorHandler) {
        this.source.errorHandler = this.errorHandler;
        this.source.terminateOnError = this.terminateOnError;
      }
      
      for await (const value of this.source) {
        const processed = this.applyOperators(value);
        const result = processed instanceof Promise ? await processed : processed;
        if (result !== undefined) yield result;
      }
    } else if (this.source instanceof ReadableStream) {
      const reader = this.source.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const processed = this.applyOperators(value);
          const result = processed instanceof Promise ? await processed : processed;
          if (result !== undefined) yield result;
        }
      } finally {
        reader.releaseLock();
      }
    } else if (typeof this.source === 'function') {
      // Handle AsyncGenerator functions (created by Nagare.from for promises, etc.)
      const generator = (this.source as () => AsyncGenerator<T>)();
      for await (const value of generator) {
        const processed = this.applyOperators(value);
        const result = processed instanceof Promise ? await processed : processed;
        if (result !== undefined) yield result;
      }
    } else if (Symbol.asyncIterator in this.source) {
      for await (const value of this.source as AsyncIterable<T>) {
        const processed = this.applyOperators(value);
        const result = processed instanceof Promise ? await processed : processed;
        if (result !== undefined) yield result;
      }
    } else if (Symbol.iterator in this.source) {
      // Fast path for arrays
      if (Array.isArray(this.source) && this.operators.length > 0) {
        // Assume sync processing for arrays - check for async later if needed
        try {
          for (const value of this.source as T[]) {
            let current: T | undefined = value;
            for (const op of this.operators) {
              if (current === undefined) break;
              const result = op(current);
              if (result instanceof Promise) {
                // Fall back to async processing for the rest
                yield* this.asyncFallback(this.source.slice(this.source.indexOf(value)));
                return;
              }
              current = result as T | undefined;
            }
            if (current !== undefined) yield current;
          }
          return;
        } catch (error) {
          // Fall back to original logic on any error
        }
      }
      
      // Fallback to original logic
      for (const value of this.source as Iterable<T>) {
        const processed = this.applyOperators(value);
        const result = processed instanceof Promise ? await processed : processed;
        if (result !== undefined) yield result;
      }
    }
  }

  async toArray(): Promise<T[]> {
    // Ultra-fast path: detect common map+filter pattern
    if (this._originalArraySource && this.operators.length === 2 && this._originalArraySource.length > 0) {
      try {
        // Check if this is a simple map -> filter chain
        const mapOp = this.operators[0];
        const filterOp = this.operators[1];
        
        // Test first element to see if this is sync map+filter
        const testMapped = mapOp(this._originalArraySource[0] as T);
        if (testMapped instanceof Promise) throw new Error('async');
        
        const testFiltered = filterOp(testMapped as T);
        if (testFiltered instanceof Promise) throw new Error('async');
        
        // Ultra-optimized fused map+filter implementation
        const result = [];
        const sourceArray = this._originalArraySource;
        const length = sourceArray.length;
        
        // Pre-allocate result array with estimated size
        result.length = 0;
        
        // Inline both operations for maximum speed
        for (let i = 0; i < length; i++) {
          const item = sourceArray[i];
          const mapped = mapOp(item as T);
          const shouldInclude = filterOp(mapped as T);
          if (shouldInclude !== undefined) {
            result[result.length] = mapped;  // Faster than push()
          }
        }
        return result as T[];
      } catch (error) {
        // Fall through to general case
      }
    }
    
    // General case: sync array optimization 
    if (this._originalArraySource && this.operators.length > 0 && this._originalArraySource.length > 0) {
      try {
        let result: any[] = this._originalArraySource;
        
        for (const op of this.operators) {
          const newResult = [];
          for (let i = 0; i < result.length; i++) {
            const processed = op(result[i]);
            if (processed instanceof Promise) throw new Error('async');
            if (processed !== undefined) {
              newResult.push(processed);
            }
          }
          result = newResult;
        }
        
        return result as T[];
      } catch (error) {
        // Fall back to async processing
      }
    }

    // Default async behavior
    const result: T[] = [];
    for await (const value of this) {
      result.push(value);
    }
    return result;
  }

  async first(): Promise<T | undefined> {
    for await (const value of this) {
      return value;
    }
    return undefined;
  }

  async last(): Promise<T | undefined> {
    let lastValue: T | undefined;
    for await (const value of this) {
      lastValue = value;
    }
    return lastValue;
  }

  async count(): Promise<number> {
    let count = 0;
    for await (const _ of this) {
      count++;
    }
    return count;
  }

  async all(predicate: (value: T) => boolean | Promise<boolean>): Promise<boolean> {
    for await (const value of this) {
      const result = predicate(value);
      const passes = result instanceof Promise ? await result : result;
      if (!passes) return false;
    }
    return true;
  }

  async some(predicate: (value: T) => boolean | Promise<boolean>): Promise<boolean> {
    for await (const value of this) {
      const result = predicate(value);
      const passes = result instanceof Promise ? await result : result;
      if (passes) return true;
    }
    return false;
  }
}