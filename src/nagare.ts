import type { Disposable, Subscription, ErrorHandler } from './types';
import { loadWasm, wasmModule } from './wasm-loader';

export class Nagare<T, E = never> implements AsyncIterable<T> {
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

  map<U>(fn: (value: T) => U | Promise<U>): Nagare<U, E> {
    const newNagare = new Nagare<U, E>(this as any);
    newNagare.operators = [...this.operators, fn as any];
    newNagare.errorHandler = this.errorHandler;
    newNagare.terminateOnError = this.terminateOnError;
    return newNagare;
  }

  filter(predicate: (value: T) => boolean | Promise<boolean>): Nagare<T, E> {
    const newNagare = new Nagare<T, E>(this);
    const filterOp = async (value: T): Promise<T | undefined> => {
      const result = predicate(value);
      const shouldKeep = result instanceof Promise ? await result : result;
      return shouldKeep ? value : undefined;
    };
    newNagare.operators = [...this.operators, filterOp as any];
    newNagare.errorHandler = this.errorHandler;
    newNagare.terminateOnError = this.terminateOnError;
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
      // Handle AsyncGenerator functions (created by Nagare.from for promises, etc.)
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