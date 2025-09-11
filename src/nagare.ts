import type { Disposable, Subscription, ErrorHandler } from './types';
import { loadWasm, wasmModule } from './wasm-loader';
import { isTypedArrayLike } from './internal/helpers';
import { 
  compileOperatorChain as _compileOperatorChain,
  compileOperatorChainUnchecked as _compileOperatorChainUnchecked,
  compileArrayKernelUnchecked as _compileArrayKernelUnchecked,
  compileArrayKernelUncheckedUnrolled as _compileArrayKernelUncheckedUnrolled,
} from './internal/compile';

export class Nagare<T, E = never> implements AsyncIterable<T> {
  protected source: AsyncIterable<T> | Iterable<T> | ReadableStream<T>;
  protected operators: Array<(value: T) => T | Promise<T> | undefined> = [];
  protected errorHandler?: ErrorHandler<E>;
  protected terminateOnError = false;
  private _originalArraySource?: any[];
  private static readonly ASYNC_DETECTED = Symbol('nagare_async_detected');
  // typed array detection moved to helper

  // JIT モード制御（heavy JIT を無効化可能）
  // 'fast': new Function によるJITを許可
  // 'off' : new Function 不使用（安全だがやや低速）。融合のクロージャ版は継続利用。
  static _jitMode: 'fast' | 'off' = 'fast';
  static setJitMode(mode: 'fast' | 'off') { Nagare._jitMode = mode; }
  static getJitMode(): 'fast' | 'off' { return Nagare._jitMode; }
  static {
    try {
      const disabled = (typeof process !== 'undefined' && (process as any).env?.NAGARE_DISABLE_JIT === 'true')
        || (typeof globalThis !== 'undefined' && (globalThis as any).NAGARE_DISABLE_JIT === true)
        || (typeof globalThis !== 'undefined' && (globalThis as any).__NAGARE_JIT_MODE === 'off');
      if (disabled) Nagare._jitMode = 'off';
    } catch {}
  }

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

  // Flatten a chain of Nagare sources into a single base source and full operator list
  private flattenChain(): {
    baseSource: AsyncIterable<T> | Iterable<T> | ReadableStream<T> | T[];
    operators: Array<(value: T) => T | Promise<T> | undefined>;
    errorHandler?: ErrorHandler<E>;
    terminateOnError: boolean;
  } {
    let node: Nagare<T, E> = this;
    const chain: Nagare<T, E>[] = [];
    let base: any = undefined;

    // Walk down the chain until the base non-Nagare source
    while (node instanceof Nagare) {
      chain.push(node);
      const src: any = (node as any).source;
      if (src instanceof Nagare) {
        node = src as Nagare<T, E>;
      } else {
        base = src;
        break;
      }
    }

    // Aggregate operators in correct order: inner-most first → outer-most last
    const ops: Array<(value: T) => T | Promise<T> | undefined> = [];
    for (let i = chain.length - 1; i >= 0; i--) {
      const n = chain[i];
      if (n.operators && n.operators.length > 0) {
        ops.push(...n.operators as any);
      }
    }

    // The outer-most error handler governs behavior
    const top = chain[0];
    return {
      baseSource: base,
      operators: ops,
      errorHandler: top?.errorHandler,
      terminateOnError: !!top?.terminateOnError,
    };
  }

  private hasStatefulOps(ops: Array<any>): boolean {
    for (const op of ops as any[]) {
      const meta = (op as any)?.__nagareOp as { kind?: string } | undefined;
      if (!meta) continue;
      if (meta.kind === 'scan' || meta.kind === 'take' || meta.kind === 'skip') return true;
    }
    return false;
  }

  // reserved for future granular checks
  // private hasOpKind(ops: Array<any>, kind: 'scan' | 'take' | 'skip' | 'filter' | 'map'): boolean {
  //   for (const op of ops as any[]) {
  //     const meta = (op as any)?.__nagareOp as { kind?: string } | undefined;
  //     if (meta?.kind === kind) return true;
  //   }
  //   return false;
  // }

  map<U>(fn: (value: T) => U | Promise<U>): Nagare<U, E> {
    const newNagare = new Nagare<U, E>(this as any);
    // Tag operator for compilation metadata (respect existing tags e.g. scan)
    if (!(fn as any).__nagareOp) {
      (fn as any).__nagareOp = { kind: 'map' } as const;
    }
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
    // Tag operator for compilation metadata, preserving original predicate
    (filterOp as any).__nagareOp = { kind: 'filter', predicate } as const;
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
    const mapper = (value: T) => {
      const result = fn(accumulator, value);
      if (result instanceof Promise) {
        return result.then(res => {
          accumulator = res;
          return accumulator as any;
        }) as any;
      } else {
        accumulator = result;
        return accumulator as any;
      }
    };
    (mapper as any).__nagareOp = { kind: 'scan', scanFn: fn, initial } as const;
    return this.map(mapper as any);
  }

  take(count: number): Nagare<T, E> {
    const newNagare = new Nagare<T, E>(this);
    let taken = 0;
    const op = (value: T): T | undefined => {
      if (taken >= count) return undefined;
      taken++;
      return value;
    };
    (op as any).__nagareOp = { kind: 'take', n: count } as const;
    newNagare.operators = [...this.operators, op as any];
    newNagare.errorHandler = this.errorHandler;
    newNagare.terminateOnError = this.terminateOnError;
    newNagare._originalArraySource = this._originalArraySource;
    return newNagare;
  }

  skip(count: number): Nagare<T, E> {
    const newNagare = new Nagare<T, E>(this);
    let skipped = 0;
    const op = (value: T): T | undefined => {
      if (skipped < count) {
        skipped++;
        return undefined;
      }
      return value;
    };
    (op as any).__nagareOp = { kind: 'skip', n: count } as const;
    newNagare.operators = [...this.operators, op as any];
    newNagare.errorHandler = this.errorHandler;
    newNagare.terminateOnError = this.terminateOnError;
    newNagare._originalArraySource = this._originalArraySource;
    return newNagare;
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
    if (windowSize <= 0) throw new Error('windowSize must be > 0');
    const self = this;

    const generator = async function* (): AsyncGenerator<number> {
      // Circular buffer to avoid shift()と新規配列の作成
      const buf = new Array<number>(windowSize);
      let start = 0;      // oldest index
      let count = 0;      // current count (<= windowSize)
      let sum = 0;        // for sum/mean

      for await (const value of self) {
        if (typeof value !== 'number') {
          throw new Error('windowedAggregate requires numeric values');
        }

        const idx = (start + count) % windowSize;
        if (count < windowSize) {
          buf[idx] = value;
          count++;
          sum += value;
        } else {
          // Overwrite oldest
          const oldest = buf[start];
          buf[start] = value;
          start = (start + 1) % windowSize;
          sum += value - oldest;
        }

        if (count === windowSize) {
          let result: number;
          switch (operation) {
            case 'mean':
              result = sum / windowSize;
              break;
            case 'sum':
              result = sum;
              break;
            case 'max': {
              // 線形スキャン（テスト規模では十分）。必要ならデックで最適化可能。
              let m = -Infinity;
              for (let i = 0; i < windowSize; i++) {
                const v = buf[(start + i) % windowSize];
                if (v > m) m = v;
              }
              result = m;
              break;
            }
            case 'min': {
              let m = Infinity;
              for (let i = 0; i < windowSize; i++) {
                const v = buf[(start + i) % windowSize];
                if (v < m) m = v;
              }
              result = m;
              break;
            }
            default:
              throw new Error(`Unknown operation: ${operation}`);
          }
          yield result;
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
    // Iterator Fusion fast-path: if underlying base is an array and all ops are sync
    const { baseSource, operators: fusedOps, errorHandler, terminateOnError } = this.flattenChain();
    if ((Array.isArray(baseSource) || isTypedArrayLike(baseSource)) && fusedOps.length > 0) {
      try {
        const fused = _compileOperatorChain(
          fusedOps as any,
          errorHandler as any,
          terminateOnError,
          { jitMode: Nagare._jitMode, ASYNC_DETECTED: Nagare.ASYNC_DETECTED }
        );
        if (fused) {
          const data = baseSource as any;
          const stateful = this.hasStatefulOps(fusedOps);
          // If no error handling and no stateful ops, run one checked iteration then unchecked fast path
          if (!errorHandler && !terminateOnError && !stateful) {
            const fast = _compileOperatorChainUnchecked(
              fusedOps as any,
              { jitMode: Nagare._jitMode, ASYNC_DETECTED: Nagare.ASYNC_DETECTED }
            );
            if (data.length > 0) {
              try {
                const first = fused(data[0]);
                if (first !== undefined) yield first as T;
              } catch (err) {
                if (err === Nagare.ASYNC_DETECTED) {
                  const rest = new Nagare<T, E>(data);
                  (rest as any).operators = fusedOps as any;
                  for await (const v of rest) yield v;
                  return;
                }
                throw err;
              }
            }
            // Use unrolled kernel only for very large inputs to reduce loop overhead
            const kernel = (Nagare._jitMode === 'fast' && data.length >= 200_000)
              ? _compileArrayKernelUncheckedUnrolled(
                  fusedOps as any,
                  4,
                  { jitMode: Nagare._jitMode, ASYNC_DETECTED: Nagare.ASYNC_DETECTED }
                )
              : null;
            if (kernel) {
              const outArr: T[] = new Array<T>(data.length - 1);
              let k = 0;
              k = kernel(data as any[], 1, outArr as any[], k) as number;
              for (let j = 0; j < k; j++) {
                yield outArr[j] as T;
              }
            } else {
              for (let i = 1; i < data.length; i++) {
                const out = fast(data[i]);
                if (out !== undefined) yield out as T;
              }
            }
            return;
          } else {
            // Use guarded fused function for all elements to preserve stateful semantics
            for (let i = 0; i < data.length; i++) {
              try {
                const out = fused(data[i]);
                if (out !== undefined) yield out as T;
              } catch (err) {
                if (err === Nagare.ASYNC_DETECTED) {
                  // Fallback: process remaining elements with generic async pipeline
                  const rest = new Nagare<T, E>(Array.prototype.slice.call(data, i));
                  (rest as any).operators = fusedOps as any;
                  (rest as any).errorHandler = errorHandler as any;
                  (rest as any).terminateOnError = terminateOnError;
                  for await (const v of rest) {
                    yield v;
                  }
                  return;
                }
                throw err;
              }
            }
            return;
          }
        }
      } catch {
        // fall through to generic paths
      }
    }

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
    // Flatten chain first for maximal fusion opportunities
    const { baseSource, operators: fusedOps, errorHandler, terminateOnError } = this.flattenChain();
    // Operator Fusion: Compile operator chain into single optimized function when possible
    if ((Array.isArray(baseSource) || isTypedArrayLike(baseSource)) && fusedOps.length > 0) {
      try {
        const fused = _compileOperatorChain(
          fusedOps as any,
          errorHandler as any,
          terminateOnError,
          { jitMode: Nagare._jitMode, ASYNC_DETECTED: Nagare.ASYNC_DETECTED }
        );
        if (!fused) throw new Error('compilation-failed');

        // Single-pass execution without intermediate arrays
        const src = baseSource as any;
        const result = new Array<T>(src.length); // pre-allocate; we will adjust length
        let k = 0;
        const stateful = this.hasStatefulOps(fusedOps);
        if (!errorHandler && !terminateOnError && !stateful) {
          const fast = _compileOperatorChainUnchecked(
            fusedOps as any,
            { jitMode: Nagare._jitMode, ASYNC_DETECTED: Nagare.ASYNC_DETECTED }
          );
          let startIndex = 0;
          if (src.length > 0) {
            try {
              const out0 = fused(src[0]);
              if (out0 !== undefined) result[k++] = out0 as T;
            } catch (err) {
              if (err === Nagare.ASYNC_DETECTED) {
                const rest = new Nagare<T, E>(Array.prototype.slice.call(src));
                (rest as any).operators = fusedOps as any;
                for await (const v of rest) result[k++] = v;
                (result as any).length = k;
                return result;
              }
              throw err;
            }
            startIndex = 1;
          }
          // Use compiled array kernel; prefer unrolled only for very large inputs
          let kernel: ((src: any[], start: number, out: any[], k: number) => number) | null = null;
          if (Nagare._jitMode === 'fast' && src.length >= 200_000) {
            kernel = _compileArrayKernelUncheckedUnrolled(
              fusedOps as any,
              4,
              { jitMode: Nagare._jitMode, ASYNC_DETECTED: Nagare.ASYNC_DETECTED }
            );
          }
          if (!kernel) {
            kernel = _compileArrayKernelUnchecked(
              fusedOps as any,
              { jitMode: Nagare._jitMode, ASYNC_DETECTED: Nagare.ASYNC_DETECTED }
            );
          }
          if (kernel) {
            k = kernel(src as any[], startIndex, result as any[], k) as number;
          } else {
            for (let i = startIndex; i < src.length; i++) {
              const out = fast(src[i]);
              if (out !== undefined) result[k++] = out as T;
            }
          }
        } else {
          // Use guarded fused function for all elements to preserve stateful semantics
          for (let i = 0; i < src.length; i++) {
            try {
              const out = fused(src[i]);
              if (out !== undefined) {
                result[k++] = out as T;
              }
            } catch (err) {
              if (err === Nagare.ASYNC_DETECTED) {
                // Continue remaining values with generic pipeline
                const rest = new Nagare<T, E>(src.slice(i));
                (rest as any).operators = fusedOps as any;
                (rest as any).errorHandler = errorHandler as any;
                (rest as any).terminateOnError = terminateOnError;
                for await (const v of rest) {
                  result[k++] = v;
                }
                break;
              }
              throw err;
            }
          }
        }
        (result as any).length = k;
        return result;
      } catch (error) {
        // Fall back to standard iteration
      }
    }

    // Standard async iteration
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
