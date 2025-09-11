export { Nagare } from './nagare';
export * from './operators';
export { 
  BYOBStreamReader, 
  BYOBStreamController, 
  BufferPool,
  createZeroCopyView,
  createFloat32View,
  createBYOBTransformStream,
  pipeBYOBStreams
} from './byob';
export { 
  CreditController,
  MultiStreamCreditManager,
  AdaptiveBackpressure,
  WindowedRateLimiter,
  DynamicBackpressure,
  type BackpressureStrategy,
  type BackpressureMetrics
} from './backpressure';
export * from './serialization';
export * from './types';

import { Nagare } from './nagare';
import { createFromReadableStream, createFromArray, createFromPromise } from './sources';

export const nagare = {
  from: createFromArray,
  fromReadableStream: createFromReadableStream,
  fromPromise: createFromPromise,
  
  empty: <T>(): Nagare<T> => new Nagare<T>([]),
  
  of: <T>(...values: T[]): Nagare<T> => new Nagare<T>(values),
  
  range: (start: number, end: number, step = 1): Nagare<number> => {
    const values: number[] = [];
    for (let i = start; i < end; i += step) {
      values.push(i);
    }
    return new Nagare<number>(values);
  },
  
  interval: (ms: number, signal?: AbortSignal): Nagare<number> => {
    const generator = async function* (): AsyncGenerator<number> {
      let count = 0;
      while (!signal?.aborted) {
        yield count++;
        await new Promise(resolve => setTimeout(resolve, ms));
      }
    };
    return new Nagare<number>(generator());
  },
  
  merge: <T>(...nagares: Nagare<T>[]): Nagare<T> => {
    return nagares[0].merge(...nagares.slice(1));
  },
  
  combine: <T extends unknown[]>(...nagares: { [K in keyof T]: Nagare<T[K]> }): Nagare<T> => {
    const generator = async function* (): AsyncGenerator<T> {
      const iterators = nagares.map(r => r[Symbol.asyncIterator]());
      const values: (T[number] | undefined)[] = new Array(nagares.length);
      let hasValues = new Array(nagares.length).fill(false);
      
      while (true) {
        const results = await Promise.all(
          iterators.map((it, i) => it.next().then(r => ({ i, r })))
        );
        
        let allDone = true;
        for (const { i, r } of results) {
          if (!r.done) {
            values[i] = r.value;
            hasValues[i] = true;
            allDone = false;
          }
        }
        
        if (allDone) break;
        if (hasValues.every(h => h)) {
          yield [...values] as T;
        }
      }
    };
    return new Nagare<T>(generator());
  },
};

export default nagare;