import type { Disposable, Subscription, ErrorHandler } from './types';
import { loadWasm, wasmModule } from './wasm-loader';
import { isTypedArrayLike } from './internal/helpers';
import { 
  compileOperatorChain as _compileOperatorChain,
  compileOperatorChainUnchecked as _compileOperatorChainUnchecked,
  compileArrayKernelUnchecked as _compileArrayKernelUnchecked,
  compileArrayKernelUncheckedUnrolled as _compileArrayKernelUncheckedUnrolled,
  compileOperatorChainAsync as _compileOperatorChainAsync,
} from './internal/compile';
import { OP_META, FusedOp } from './internal/tags';

export class Nagare<T, E = never> implements AsyncIterable<T> {
  protected source: AsyncIterable<T> | Iterable<T> | ReadableStream<T> | Nagare<unknown> | T[];
  protected operators: FusedOp<unknown>[] = [];
  protected errorHandler?: (error: unknown) => T | undefined;
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
  private static _fusionEnabled = true;
  static setFusionEnabled(enabled: boolean) { Nagare._fusionEnabled = enabled; }
  static getFusionEnabled(): boolean { return Nagare._fusionEnabled; }
  static {
    try {
      const disabled = (typeof process !== 'undefined' && process.env?.NAGARE_DISABLE_JIT === 'true')
        || (typeof globalThis !== 'undefined' && (globalThis as Record<string, unknown>)['NAGARE_DISABLE_JIT'] === true)
        || (typeof globalThis !== 'undefined' && (globalThis as Record<string, unknown>)['__NAGARE_JIT_MODE'] === 'off');
      if (disabled) Nagare._jitMode = 'off';
      const fusionDisabled = (typeof process !== 'undefined' && process.env?.NAGARE_DISABLE_FUSION === 'true')
        || (typeof globalThis !== 'undefined' && (globalThis as Record<string, unknown>)['NAGARE_DISABLE_FUSION'] === true);
      if (fusionDisabled) Nagare._fusionEnabled = false;
    } catch {}
  }

  constructor(source: AsyncIterable<T> | Iterable<T> | ReadableStream<T> | T[] | Nagare<unknown>) {
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
        const fn = op as (value: T) => T | Promise<T | undefined> | undefined;
        const r = fn(current as T);
        if (r instanceof Promise) {
          return this.applyOperatorsAsync(value);
        }
        current = r as T | undefined;
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
        const fn = op as (value: T) => T | Promise<T | undefined> | undefined;
        const r: T | Promise<T | undefined> | undefined = fn(current as T);
        current = r instanceof Promise ? await r : (r as T | undefined);
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
    operators: FusedOp<unknown>[];
    errorHandler?: ErrorHandler<E>;
    terminateOnError: boolean;
  } {
    let node: Nagare<T, E> = this;
    const chain: Nagare<T, E>[] = [];
    let base: AsyncIterable<T> | Iterable<T> | ReadableStream<T> | T[] | undefined = undefined;

    // Walk down the chain until the base non-Nagare source
    while (node instanceof Nagare) {
      chain.push(node);
      const src = node.source;
      if (src instanceof Nagare) {
        node = src as Nagare<T, E>;
      } else {
        base = src;
        break;
      }
    }

    // Collect local operators from inner-most to outer-most
    const ops: FusedOp<unknown>[] = [];
    for (let i = chain.length - 1; i >= 0; i--) {
      const n = chain[i];
      if (n.operators && n.operators.length > 0) {
        ops.push(...(n.operators as FusedOp<unknown>[]));
      }
    }

    // The outer-most error handler governs behavior
    const top = chain[0];
    return {
      baseSource: base!,
      operators: ops,
      errorHandler: top?.errorHandler,
      terminateOnError: !!top?.terminateOnError,
    };
  }

  private hasStatefulOps(ops: Array<unknown>): boolean {
    for (const op of ops) {
      const meta = (op as any)?.[OP_META] || (op as any)?.__nagareOp;
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
    const newNagare = new Nagare<U, E>(this);
    const tagged = fn as unknown as FusedOp<unknown>;
    // set meta using Reflect to avoid unsafe casts
    Reflect.set(tagged, '__nagareOp', { kind: 'map' } as const);
    Reflect.set(tagged, OP_META, { kind: 'map' } as const);
    // attach only the local operator; do not aggregate here
    newNagare.operators = [tagged];
    // do not propagate handler across type change; rescue is applied later in chain
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
    const tagged = filterOp as unknown as FusedOp<unknown>;
    Reflect.set(tagged, '__nagareOp', { kind: 'filter', predicate } as const);
    Reflect.set(tagged, OP_META, { kind: 'filter', predicate } as const);
    newNagare.operators = [tagged];
    // do not propagate handler here
    newNagare.terminateOnError = this.terminateOnError;
    newNagare._originalArraySource = this._originalArraySource;
    return newNagare;
  }

  scan<U>(
    fn: (acc: U, value: T) => U | Promise<U>,
    initial: U
  ): Nagare<U, E> {
    let accumulator = initial;
    const mapper: (value: T) => U | Promise<U> = (value: T) => {
      const result = fn(accumulator, value);
      if (result instanceof Promise) {
        return result.then(res => {
          accumulator = res;
          return accumulator;
        });
      } else {
        accumulator = result;
        return accumulator;
      }
    };
    const tagged = mapper as unknown as FusedOp<unknown>;
    Reflect.set(tagged, '__nagareOp', { kind: 'scan', scanFn: fn, initial } as const);
    Reflect.set(tagged, OP_META, { kind: 'scan', scanFn: fn, initial } as const);
    const newNagare = new Nagare<U, E>(this);
    newNagare.operators = [tagged];
    // do not propagate handler here
    newNagare.terminateOnError = this.terminateOnError;
    (newNagare as unknown as { _originalArraySource?: any[] })._originalArraySource = this._originalArraySource;
    return newNagare;
  }

  take(count: number): Nagare<T, E> {
    const newNagare = new Nagare<T, E>(this);
    let taken = 0;
    const op = (value: T): T | undefined => {
      if (taken >= count) return undefined;
      taken++;
      return value;
    };
    const tagged = op as unknown as FusedOp<unknown>;
    Reflect.set(tagged, '__nagareOp', { kind: 'take', n: count } as const);
    Reflect.set(tagged, OP_META, { kind: 'take', n: count } as const);
    newNagare.operators = [tagged];
    // do not propagate handler here
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
    const tagged = op as unknown as FusedOp<unknown>;
    Reflect.set(tagged, '__nagareOp', { kind: 'skip', n: count } as const);
    Reflect.set(tagged, OP_META, { kind: 'skip', n: count } as const);
    newNagare.operators = [tagged];
    // do not propagate handler here
    newNagare.terminateOnError = this.terminateOnError;
    newNagare._originalArraySource = this._originalArraySource;
    return newNagare;
  }

  // New: pairwise as fused map-like operator (first emits undefined)
  pairwise(): Nagare<[T, T], E> {
    let hasPrev = false;
    let prev: T | undefined = undefined;
    const op = ((value: T): [T, T] | undefined => {
      if (!hasPrev) {
        prev = value;
        hasPrev = true;
        return undefined;
      }
      const out: [T, T] = [prev as T, value];
      prev = value;
      return out;
    }) as (value: T) => [T, T] | undefined;
    const tagged = op as unknown as FusedOp<unknown>;
    Reflect.set(tagged, '__nagareOp', { kind: 'map' } as const);
    Reflect.set(tagged, OP_META, { kind: 'map' } as const);
    const newNagare = new Nagare<[T, T], E>(this);
    newNagare.operators = [tagged];
    // do not propagate handler here
    newNagare.terminateOnError = this.terminateOnError;
    (newNagare as unknown as { _originalArraySource?: any[] })._originalArraySource = this._originalArraySource;
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
    // rescue introduces no transformation operator at this level
    newNagare.operators = [];
    newNagare.errorHandler = handler;
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
    
    const opWasm = ((value: unknown) => {
      if (!wasmModule) throw new Error('WASM module not loaded');
      
      if (value instanceof Float32Array) {
        const result = wasmModule.process_float32_batch(value, kernelName);
        return result as unknown;
      }
      
      return value;
    }) as (value: unknown) => unknown;
    newNagare.operators.push(opWasm as FusedOp<unknown>);
    
    return newNagare;
  }

  windowedAggregate(windowSize: number, operation: string): Nagare<number, E> {
    if (windowSize <= 0) throw new Error('windowSize must be > 0');
    const self = this;

    const generator = async function* (): AsyncGenerator<number> {
      // Circular buffer for values, plus monotonic deques for max/min
      const buf = new Array<number>(windowSize);
      let start = 0;      // oldest index
      let count = 0;      // current count (<= windowSize)
      let sum = 0;        // for sum/mean

      // Deques store pairs [value, index] in decreasing (max) / increasing (min) order
      const dqMax: Array<[number, number]> = [];
      const dqMin: Array<[number, number]> = [];
      let index = 0; // global position

      function pushMax(val: number) {
        while (dqMax.length && dqMax[dqMax.length - 1][0] <= val) dqMax.pop();
        dqMax.push([val, index]);
      }
      function pushMin(val: number) {
        while (dqMin.length && dqMin[dqMin.length - 1][0] >= val) dqMin.pop();
        dqMin.push([val, index]);
      }
      function evictOld() {
        const oldestIdx = index - windowSize + 1;
        while (dqMax.length && dqMax[0][1] < oldestIdx) dqMax.shift();
        while (dqMin.length && dqMin[0][1] < oldestIdx) dqMin.shift();
      }

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
          const oldest = buf[start];
          buf[start] = value;
          start = (start + 1) % windowSize;
          sum += value - oldest;
        }

        // Update deques
        pushMax(value); pushMin(value);
        evictOld();
        index++;

        if (count === windowSize) {
          let result: number;
          switch (operation) {
            case 'mean':
              result = sum / windowSize; break;
            case 'sum':
              result = sum; break;
            case 'max':
              result = dqMax[0][0]; break;
            case 'min':
              result = dqMin[0][0]; break;
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
    if (Nagare._fusionEnabled && (Array.isArray(baseSource) || isTypedArrayLike(baseSource)) && fusedOps.length > 0) {
      try {
        const fused = _compileOperatorChain(
          fusedOps,
          errorHandler as unknown as (e: unknown) => T | undefined,
          terminateOnError,
          { jitMode: Nagare._jitMode, ASYNC_DETECTED: Nagare.ASYNC_DETECTED }
        );
        if (fused) {
          const data = baseSource as { length: number; [index: number]: T };
          const stateful = this.hasStatefulOps(fusedOps);
          // If no error handling, prefer unchecked fast path; for stateful ops avoid single-item probe
          if (!errorHandler && !terminateOnError) {
            const fast = _compileOperatorChainUnchecked(
              fusedOps,
              { jitMode: Nagare._jitMode, ASYNC_DETECTED: Nagare.ASYNC_DETECTED }
            );
            let startIndex = 0;
            if (!stateful && data.length > 0) {
              try {
                const first = fused(data[0]);
                if (first !== undefined) yield first as T;
                startIndex = 1;
              } catch (err) {
                if (err === Nagare.ASYNC_DETECTED) {
                  const rest = new Nagare<T, E>(data as unknown as T[]);
                  rest.operators = fusedOps;
                  for await (const v of rest) yield v;
                  return;
                }
                throw err;
              }
            }
            // Prefer array kernel; use unrolled kernel for very large inputs
            let kernel: ((src: any[], start: number, out: any[], k: number) => number) | null = null;
            if (Nagare._jitMode === 'fast' && data.length >= 200_000) {
              kernel = _compileArrayKernelUncheckedUnrolled(
                fusedOps,
                4,
                { jitMode: Nagare._jitMode, ASYNC_DETECTED: Nagare.ASYNC_DETECTED }
              );
            }
            if (!kernel) {
              kernel = _compileArrayKernelUnchecked(
                fusedOps,
                { jitMode: Nagare._jitMode, ASYNC_DETECTED: Nagare.ASYNC_DETECTED }
              );
            }
            if (kernel) {
              const outArr: T[] = new Array<T>(Math.max(0, data.length - startIndex));
              let k = 0;
              k = kernel(data as T[], startIndex, outArr as T[], k) as number;
              for (let j = 0; j < k; j++) {
                yield outArr[j] as T;
              }
            } else {
              for (let i = startIndex; i < data.length; i++) {
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
                  const rest = new Nagare<T, E>(Array.prototype.slice.call(data, i) as unknown as T[]);
                  rest.operators = fusedOps;
                  rest.errorHandler = errorHandler as unknown as (e: unknown) => T | undefined;
                  rest.terminateOnError = terminateOnError;
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
        const processed = this.applyOperators(value as T);
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
    if (Nagare._fusionEnabled && (Array.isArray(baseSource) || isTypedArrayLike(baseSource)) && fusedOps.length > 0) {
      try {
        const fused = _compileOperatorChain(
          fusedOps,
          errorHandler as unknown as (e: unknown) => T | undefined,
          terminateOnError,
          { jitMode: Nagare._jitMode, ASYNC_DETECTED: Nagare.ASYNC_DETECTED }
        );
        if (!fused) throw new Error('compilation-failed');

        // Single-pass execution without intermediate arrays
        const src = baseSource as { length: number; [index: number]: T };
        const result = new Array<T>(src.length); // pre-allocate; we will adjust length
        let k = 0;
        if (!errorHandler && !terminateOnError) {
          const fast = _compileOperatorChainUnchecked(
            fusedOps,
            { jitMode: Nagare._jitMode, ASYNC_DETECTED: Nagare.ASYNC_DETECTED }
          );
          let startIndex = 0;
          const stateful = this.hasStatefulOps(fusedOps);
          if (!stateful && src.length > 0) {
            try {
              const out0 = fused(src[0]);
              if (out0 !== undefined) result[k++] = out0 as T;
            } catch (err) {
              if (err === Nagare.ASYNC_DETECTED) {
                // Async operator detected: run concurrent async fused processing (limited concurrency)
                const fusedAsync = _compileOperatorChainAsync(fusedOps as unknown as Array<(v: T) => Promise<T | undefined> | T | undefined>);
                const limit = 256;
                const pending: Array<Promise<any>> = [];
                const outArr: any[] = [];
                for (let i = 0; i < src.length; i++) {
                  const p = fusedAsync(src[i]).then(v => ({ i, v }));
                  pending.push(p);
                  if (pending.length >= limit) {
                    const settled = await Promise.all(pending);
                    settled.sort((a, b) => a.i - b.i);
                    for (const { v } of settled) if (v !== undefined) outArr.push(v);
                    pending.length = 0;
                  }
                }
                if (pending.length) {
                  const settled = await Promise.all(pending);
                  settled.sort((a, b) => a.i - b.i);
                  for (const { v } of settled) if (v !== undefined) outArr.push(v);
                }
                return outArr as T[];
              }
              throw err;
            }
            startIndex = 1;
          }
          // Use compiled array kernel; prefer unrolled only for very large inputs
          let kernel: ((src: any[], start: number, out: any[], k: number) => number) | null = null;
          if (Nagare._jitMode === 'fast' && src.length >= 200_000) {
            kernel = _compileArrayKernelUncheckedUnrolled(
              fusedOps,
              4,
              { jitMode: Nagare._jitMode, ASYNC_DETECTED: Nagare.ASYNC_DETECTED }
            );
          }
          if (!kernel) {
            kernel = _compileArrayKernelUnchecked(
              fusedOps,
              { jitMode: Nagare._jitMode, ASYNC_DETECTED: Nagare.ASYNC_DETECTED }
            );
          }
          if (kernel) {
            k = kernel(src as T[], startIndex, result as T[], k) as number;
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
                const rest = new Nagare<T, E>(Array.prototype.slice.call(src, i) as T[]);
                rest.operators = fusedOps;
                rest.errorHandler = errorHandler as unknown as (e: unknown) => T | undefined;
                rest.terminateOnError = terminateOnError;
                for await (const v of rest) {
                  result[k++] = v;
                }
                break;
              }
              throw err;
            }
          }
        }
        result.length = k;
        return result;
      } catch (error) {
        // Fall back to standard iteration
      }
    }

    // No operators and array-like source: return a copy fast
    if ((Array.isArray(baseSource) || isTypedArrayLike(baseSource)) && fusedOps.length === 0) {
      return Array.prototype.slice.call(baseSource as any) as T[];
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

  async reduce<U>(
    reducer: (acc: U, value: T) => U | Promise<U>,
    initial: U
  ): Promise<U> {
    // Try array fast paths when possible and reducer is sync
    const { baseSource, operators: fusedOps } = this.flattenChain();
    const reducerIsAsync = reducer.constructor.name === 'AsyncFunction';
    if (!reducerIsAsync && (Array.isArray(baseSource) || isTypedArrayLike(baseSource))) {
      const src = baseSource as { length: number; [index: number]: T };
      // No operators or fusion disabled: tight loop
      if (!Nagare._fusionEnabled || fusedOps.length === 0) {
        let acc = initial as U;
        for (let i = 0; i < src.length; i++) {
          acc = reducer(acc, src[i] as T) as U;
        }
        return acc;
      }
      // Otherwise: fuse operators then reduce
      try {
        const fast = _compileOperatorChainUnchecked(
          fusedOps,
          { jitMode: Nagare._jitMode, ASYNC_DETECTED: Nagare.ASYNC_DETECTED }
        );
        let acc = initial as U;
        for (let i = 0; i < src.length; i++) {
          const v = fast(src[i]);
          if (v !== undefined) acc = reducer(acc, v as T) as U;
        }
        return acc;
      } catch {
        // fallthrough
      }
    }

    // Generic async iteration path
    let acc = initial;
    for await (const value of this) {
      acc = await reducer(acc, value);
    }
    return acc;
  }
}
