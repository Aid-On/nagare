import { Nagare } from './nagare';
import { ensureWasmLoaded, wasmModule } from './wasm-loader';

export function debounce<T>(ms: number) {
  return (nagare: Nagare<T>): Nagare<T> => {
    const generator = async function* (): AsyncGenerator<T> {
      let timeout: NodeJS.Timeout | null = null;
      let lastValue: T | undefined;
      let hasValue = false;

      for await (const value of nagare) {
        lastValue = value;
        hasValue = true;

        if (timeout) clearTimeout(timeout);
        
        await new Promise<void>((resolve) => {
          timeout = setTimeout(() => {
            timeout = null;
            resolve();
          }, ms);
        });

        if (hasValue) {
          yield lastValue!;
          hasValue = false;
        }
      }

      if (hasValue && lastValue !== undefined) {
        yield lastValue;
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
  return (nagare: Nagare<T>): Nagare<T[]> => {
    const generator = async function* (): AsyncGenerator<T[]> {
      let buffer: T[] = [];
      let timeout: NodeJS.Timeout | null = null;

      const flush = () => {
        if (buffer.length > 0) {
          const toYield = buffer.slice();
          buffer.length = 0;
          return toYield;
        }
        return null;
      };

      for await (const value of nagare) {
        buffer.push(value);

        if (!timeout) {
          timeout = setTimeout(() => {
            timeout = null;
            const values = flush();
            if (values) {
            }
          }, ms);
        }

        if (buffer.length >= 1000) {
          const values = flush();
          if (values) yield values;
        }
      }

      const remaining = flush();
      if (remaining) yield remaining;
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
