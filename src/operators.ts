import { Nagare } from './nagare';
import { ensureWasmLoaded, wasmModule } from './wasm-loader';

export function debounce<T>(ms: number) {
  return (src: Nagare<T>): Nagare<T> => {
    const generator = async function* (): AsyncGenerator<T> {
      let closed = false;
      let lastValue: T | undefined;
      let timer: any = null;

      const outQueue: T[] = [];
      let notify: (() => void) | null = null;
      const notifyNext = () => {
        if (notify) {
          const n = notify; notify = null; n();
        }
      };

      const pushOut = (v: T) => {
        outQueue.push(v);
        notifyNext();
      };

      const consumer = (async () => {
        try {
          for await (const v of src) {
            lastValue = v;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => {
              if (lastValue !== undefined) pushOut(lastValue);
              lastValue = undefined;
              timer = null;
            }, ms);
          }
        } finally {
          closed = true;
          if (timer) {
            clearTimeout(timer);
            timer = null;
            if (lastValue !== undefined) pushOut(lastValue);
            lastValue = undefined;
          }
          notifyNext();
        }
      })();
      void consumer;

      while (true) {
        if (outQueue.length) {
          yield outQueue.shift()!;
          continue;
        }
        if (closed) break;
        await new Promise<void>((res) => (notify = res));
      }
    };
    return new Nagare<T>(generator());
  };
}

export function throttle<T>(ms: number) {
  return (nagare: Nagare<T>): Nagare<T> => {
    const generator = async function* (): AsyncGenerator<T> {
      let lastEmit = 0;

      for await (const value of nagare) {
        const now = Date.now();
        if (now - lastEmit >= ms) {
          yield value;
          lastEmit = now;
        }
      }
    };
    return new Nagare<T>(generator());
  };
}

export function buffer<T>(size: number) {
  return (nagare: Nagare<T>): Nagare<T[]> => {
    const generator = async function* (): AsyncGenerator<T[]> {
      let buffer: T[] = [];

      for await (const value of nagare) {
        buffer.push(value);
        
        if (buffer.length >= size) {
          const out = buffer.slice();
          buffer.length = 0;
          yield out;
        }
      }

      if (buffer.length > 0) {
        const out = buffer.slice();
        buffer.length = 0;
        yield out;
      }
    };
    return new Nagare<T[]>(generator());
  };
}

export function bufferTime<T>(ms: number) {
  return (src: Nagare<T>): Nagare<T[]> => {
    const generator = async function* (): AsyncGenerator<T[]> {
      let buf: T[] = [];
      let interval: any = null;
      let closed = false;

      const outQueue: T[][] = [];
      let notify: (() => void) | null = null;
      const notifyNext = () => { if (notify) { const n = notify; notify = null; n(); } };
      const pushOut = (arr: T[]) => { outQueue.push(arr); notifyNext(); };

      const startIntervalIfNeeded = () => {
        if (!interval) {
          interval = setInterval(() => {
            if (buf.length > 0) {
              const out = buf.slice();
              buf.length = 0;
              pushOut(out);
            }
          }, ms);
        }
      };

      const consumer = (async () => {
        try {
          for await (const v of src) {
            buf.push(v);
            startIntervalIfNeeded();
          }
        } finally {
          closed = true;
          if (interval) {
            clearInterval(interval);
            interval = null;
          }
          if (buf.length > 0) {
            const out = buf.slice();
            buf.length = 0;
            pushOut(out);
          }
          notifyNext();
        }
      })();
      void consumer;

      while (true) {
        if (outQueue.length) {
          yield outQueue.shift()!;
          continue;
        }
        if (closed) break;
        await new Promise<void>((res) => (notify = res));
      }
    };
    return new Nagare<T[]>(generator());
  };
}

export function distinct<T>() {
  return (nagare: Nagare<T>): Nagare<T> => {
    const seen = new Set<T>();
    
    return nagare.filter((value) => {
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
  };
}

export function distinctUntilChanged<T>() {
  return (nagare: Nagare<T>): Nagare<T> => {
    const generator = async function* (): AsyncGenerator<T> {
      let previous: T | symbol = Symbol('initial');

      for await (const value of nagare) {
        if (previous === Symbol('initial') || value !== previous) {
          yield value;
          previous = value;
        }
      }
    };
    return new Nagare<T>(generator());
  };
}

export function pairwise<T>() {
  return (nagare: Nagare<T>): Nagare<[T, T]> => {
    const generator = async function* (): AsyncGenerator<[T, T]> {
      let previous: T | undefined;
      let hasPrevious = false;

      for await (const value of nagare) {
        if (hasPrevious) {
          yield [previous!, value];
        }
        previous = value;
        hasPrevious = true;
      }
    };
    return new Nagare<[T, T]>(generator());
  };
}

export function startWith<T>(...values: T[]) {
  return (nagare: Nagare<T>): Nagare<T> => {
    const generator = async function* (): AsyncGenerator<T> {
      for (const value of values) {
        yield value;
      }
      yield* nagare;
    };
    return new Nagare<T>(generator());
  };
}

export function concatMap<T, U>(
  fn: (value: T) => Nagare<U> | U[] | Promise<Nagare<U> | U[]>
) {
  return (nagare: Nagare<T>): Nagare<U> => {
    // Eager fast path: outer is array with no ops and fn is sync returning arrays
    try {
      const src = (nagare as any)['source'];
      const ops = ((nagare as any)['operators'] as unknown[]) ?? [];
      const isAsyncFn = (fn as any)?.constructor?.name === 'AsyncFunction';
      if (Array.isArray(src) && ops.length === 0 && !isAsyncFn && src.length > 0) {
        const first = fn(src[0] as T) as any;
        if (Array.isArray(first)) {
          const firstArr = first as U[];
          const innerLen = firstArr.length;
          const srcArr = src as T[];
          // Try prealloc when inner length seems fixed
          let out: U[];
          let k = 0;
          if (innerLen > 0) {
            out = new Array<U>(srcArr.length * innerLen);
            // copy first
            for (let j = 0; j < innerLen; j++) out[k++] = firstArr[j];
            for (let i = 1; i < srcArr.length; i++) {
              const inner = fn(srcArr[i]) as any;
              if (!Array.isArray(inner)) { throw new Error('fallback'); }
              const arr = inner as U[];
              if (arr.length !== innerLen) { throw new Error('varying'); }
              for (let j = 0; j < innerLen; j++) out[k++] = arr[j];
            }
            return new Nagare<U>(out);
          } else {
            // empty inner always: return empty
            return new Nagare<U>([]);
          }
        }
      }
    } catch {
      // ignore and fallback to generator path
    }
    const generator = async function* (): AsyncGenerator<U> {
      const maybeSource = (nagare as any)['source'];
      const maybeOps = ((nagare as any)['operators'] as unknown[]) ?? [];
      if (Array.isArray(maybeSource) && maybeOps.length === 0) {
        const arr = maybeSource as T[];
        for (let i = 0; i < arr.length; i++) {
          const inner = await fn(arr[i] as T);
          if (Array.isArray(inner)) {
            const innerArr = inner as U[];
            for (let j = 0; j < innerArr.length; j++) yield innerArr[j];
          } else {
            const innerNagare = inner as Nagare<U>;
            for await (const v of innerNagare) yield v;
          }
        }
        return;
      }

      for await (const value of nagare) {
        const inner = await fn(value);
        if (Array.isArray(inner)) {
          // Fast path: plain array
          for (let i = 0; i < (inner as U[]).length; i++) {
            yield (inner as U[])[i];
          }
        } else {
          const innerNagare = inner as Nagare<U>;
          yield* innerNagare;
        }
      }
    };
    return new Nagare<U>(generator());
  };
}

export function concatMapArray<T, U>(
  fn: (value: T) => U[]
) {
  return (nag: Nagare<T>): Nagare<U> => {
    // Eager path for array sources
    try {
      const src = (nag as any)['source'];
      const ops = ((nag as any)['operators'] as unknown[]) ?? [];
      if (Array.isArray(src) && ops.length === 0) {
        const srcArr = src as T[];
        if (srcArr.length === 0) return new Nagare<U>([]);
        const first = fn(srcArr[0]);
        const innerLen = first.length;
        if (innerLen === 0) return new Nagare<U>([]);
        const out = new Array<U>(srcArr.length * innerLen);
        let k = 0;
        for (let j = 0; j < innerLen; j++) out[k++] = first[j];
        for (let i = 1; i < srcArr.length; i++) {
          const inner = fn(srcArr[i]);
          if (inner.length !== innerLen) {
            // fallback to generic if varying lengths
            throw new Error('varying');
          }
          for (let j = 0; j < innerLen; j++) out[k++] = inner[j];
        }
        return new Nagare<U>(out);
      }
    } catch {
      // ignore
    }

    const generator = async function* (): AsyncGenerator<U> {
      for await (const v of nag) {
        const inner = fn(v);
        for (let j = 0; j < inner.length; j++) yield inner[j];
      }
    };
    return new Nagare<U>(generator());
  };
}

export function switchMap<T, U>(
  fn: (value: T) => Nagare<U> | Promise<Nagare<U>>
) {
  return (nagare: Nagare<T>): Nagare<U> => {
    const generator = async function* (): AsyncGenerator<U> {
      let currentIterator: AsyncIterator<U> | null = null;
      let abortController: AbortController | null = null;

      for await (const value of nagare) {
        if (abortController) {
          abortController.abort();
        }
        
        abortController = new AbortController();
        const innerNagare = await fn(value);
        currentIterator = innerNagare[Symbol.asyncIterator]();

        let done = false;
        while (!done && !abortController.signal.aborted) {
          const result = await currentIterator.next();
          if (!result.done && !abortController.signal.aborted) {
            yield result.value;
          }
          done = result.done || false;
        }
      }
    };
    return new Nagare<U>(generator());
  };
}

export function retry<T>(maxRetries = 3, delayMs = 1000) {
  return (nagare: Nagare<T>): Nagare<T> => {
    const generator = async function* (): AsyncGenerator<T> {
      for await (const value of nagare) {
        let retries = 0;
        let lastError: any;

        while (retries <= maxRetries) {
          try {
            yield value;
            break;
          } catch (error) {
            lastError = error;
            retries++;
            if (retries <= maxRetries) {
              await new Promise(resolve => setTimeout(resolve, delayMs * retries));
            }
          }
        }

        if (retries > maxRetries) {
          throw lastError;
        }
      }
    };
    return new Nagare<T>(generator());
  };
}

export async function processFloat32Batch(
  data: Float32Array,
  operation: string
): Promise<Float32Array> {
  await ensureWasmLoaded();
  if (!wasmModule) {
    throw new Error('WASM module not loaded');
  }
  return wasmModule.process_float32_batch(data, operation);
}

export async function simdMapMulAdd(
  data: Float32Array,
  a: number,
  b: number
): Promise<Float32Array> {
  await ensureWasmLoaded();
  if (!wasmModule) {
    throw new Error('WASM module not loaded');
  }
  
  const nagare = wasmModule.NagareNagare.fromTypedArray(data);
  const result = nagare.mapWasm('f32x_map_mul_add', { a, b });
  
  return new Float32Array(await result.toArray());
}
