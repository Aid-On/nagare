import type { Disposable, Subscription, ErrorHandler } from './types';
import { loadWasm, wasmModule } from './wasm-loader';

export class River<T, E = never> implements AsyncIterable<T> {
  private source: AsyncIterable<T> | Iterable<T> | ReadableStream<T>;
  private operators: Array<(value: T) => T | Promise<T> | undefined> = [];
  private errorHandler?: ErrorHandler<E>;
  private terminateOnError = false;

  constructor(source: AsyncIterable<T> | Iterable<T> | ReadableStream<T> | T[]) {
    if (Array.isArray(source)) {
      this.source = source;
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
            const processed = await this.applyOperators(value);
            if (processed !== undefined) {
              next(processed);
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

  private async applyOperators(value: T): Promise<T | undefined> {
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
          // If error handler returns a value, we should continue processing
          // but break out of operator loop to yield this rescue value
          if (current !== undefined) {
            break;
          }
        } else if (this.terminateOnError) {
          throw error;
        } else {
          // Default: continue with undefined to skip this value
          current = undefined;
          break;
        }
      }
    }
    
    return current;
  }

  map<U>(fn: (value: T) => U | Promise<U>): River<U, E> {
    const newRiver = new River<U, E>(this as any);
    newRiver.operators = [...this.operators, fn as any];
    newRiver.errorHandler = this.errorHandler;
    newRiver.terminateOnError = this.terminateOnError;
    return newRiver;
  }

  filter(predicate: (value: T) => boolean | Promise<boolean>): River<T, E> {
    const newRiver = new River<T, E>(this);
    const filterOp = async (value: T): Promise<T | undefined> => {
      const result = predicate(value);
      const shouldKeep = result instanceof Promise ? await result : result;
      return shouldKeep ? value : undefined;
    };
    newRiver.operators = [...this.operators, filterOp as any];
    newRiver.errorHandler = this.errorHandler;
    newRiver.terminateOnError = this.terminateOnError;
    return newRiver;
  }

  scan<U>(
    fn: (acc: U, value: T) => U | Promise<U>,
    initial: U
  ): River<U, E> {
    let accumulator = initial;
    return this.map(async (value) => {
      const result = fn(accumulator, value);
      accumulator = result instanceof Promise ? await result : result;
      return accumulator;
    });
  }

  take(count: number): River<T, E> {
    let taken = 0;
    return this.filter(() => taken++ < count);
  }

  skip(count: number): River<T, E> {
    let skipped = 0;
    return this.filter(() => ++skipped > count);
  }

  fork(predicate: (value: T) => boolean): [River<T, E>, River<T, E>] {
    const left = this.filter(predicate);
    const right = this.filter((v) => !predicate(v));
    return [left, right];
  }

  merge<U>(...others: River<U, E>[]): River<T | U, E> {
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
    return new River<T | U, E>(generator());
  }

  rescue(handler: (error: unknown) => T | undefined): River<T, E> {
    const newRiver = new River<T, E>(this);
    newRiver.operators = [...this.operators];
    newRiver.errorHandler = handler as any;
    newRiver.terminateOnError = this.terminateOnError;
    return newRiver;
  }

  terminateOnErrorMode(): River<T, E> {
    const newRiver = new River<T, E>(this);
    newRiver.terminateOnError = true;
    return newRiver;
  }

  async mapWasm(kernelName: string, _params?: any): Promise<River<T, E>> {
    await loadWasm();
    const newRiver = new River<T, E>(this);
    
    newRiver.operators.push((value: T) => {
      if (!wasmModule) throw new Error('WASM module not loaded');
      
      if (value instanceof Float32Array) {
        const result = wasmModule.process_float32_batch(value, kernelName);
        return result as any;
      }
      
      return value;
    });
    
    return newRiver;
  }

  windowedAggregate(windowSize: number, operation: string): River<number, E> {
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
    
    return new River<number, E>(generator());
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

  static fromReadableStream<T>(stream: ReadableStream<T>): River<T> {
    return new River<T>(stream);
  }

  static from<T>(source: AsyncIterable<T> | Iterable<T> | Promise<T>): River<T> {
    if (source instanceof Promise) {
      const generator = async function* (): AsyncGenerator<T> {
        yield await source;
      };
      return new River<T>(generator());
    }
    return new River<T>(source);
  }

  static empty<T>(): River<T> {
    return new River<T>([]);
  }

  static of<T>(...values: T[]): River<T> {
    return new River<T>(values);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    if (this.source instanceof River) {
      // Handle nested River sources (from chained operations like rescue, map, etc.)
      // Propagate error handler to the source river to ensure errors are caught at the right level
      if (this.errorHandler && !this.source.errorHandler) {
        this.source.errorHandler = this.errorHandler;
        this.source.terminateOnError = this.terminateOnError;
      }
      
      for await (const value of this.source) {
        const processed = await this.applyOperators(value);
        if (processed !== undefined) yield processed;
      }
    } else if (this.source instanceof ReadableStream) {
      const reader = this.source.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const processed = await this.applyOperators(value);
          if (processed !== undefined) yield processed;
        }
      } finally {
        reader.releaseLock();
      }
    } else if (typeof this.source === 'function') {
      // Handle AsyncGenerator functions (created by River.from for promises, etc.)
      const generator = (this.source as () => AsyncGenerator<T>)();
      for await (const value of generator) {
        const processed = await this.applyOperators(value);
        if (processed !== undefined) yield processed;
      }
    } else if (Symbol.asyncIterator in this.source) {
      for await (const value of this.source as AsyncIterable<T>) {
        const processed = await this.applyOperators(value);
        if (processed !== undefined) yield processed;
      }
    } else if (Symbol.iterator in this.source) {
      for (const value of this.source as Iterable<T>) {
        const processed = await this.applyOperators(value);
        if (processed !== undefined) yield processed;
      }
    }
  }

  async toArray(): Promise<T[]> {
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