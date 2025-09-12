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
  fn: (value: T) => Nagare<U> | Promise<Nagare<U>>
) {
  return (nagare: Nagare<T>): Nagare<U> => {
    const generator = async function* (): AsyncGenerator<U> {
      for await (const value of nagare) {
        const innerNagare = await fn(value);
        yield* innerNagare;
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
