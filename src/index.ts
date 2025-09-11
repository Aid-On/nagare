export { River } from './river';
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

import { River } from './river';
import { createFromReadableStream, createFromArray, createFromPromise } from './sources';

export const river = {
  from: createFromArray,
  fromReadableStream: createFromReadableStream,
  fromPromise: createFromPromise,
  
  empty: <T>(): River<T> => new River<T>([]),
  
  of: <T>(...values: T[]): River<T> => new River<T>(values),
  
  range: (start: number, end: number, step = 1): River<number> => {
    const values: number[] = [];
    for (let i = start; i < end; i += step) {
      values.push(i);
    }
    return new River<number>(values);
  },
  
  interval: (ms: number, signal?: AbortSignal): River<number> => {
    const generator = async function* (): AsyncGenerator<number> {
      let count = 0;
      while (!signal?.aborted) {
        yield count++;
        await new Promise(resolve => setTimeout(resolve, ms));
      }
    };
    return new River<number>(generator());
  },
  
  merge: <T>(...rivers: River<T>[]): River<T> => {
    return rivers[0].merge(...rivers.slice(1));
  },
  
  combine: <T extends unknown[]>(...rivers: { [K in keyof T]: River<T[K]> }): River<T> => {
    const generator = async function* (): AsyncGenerator<T> {
      const iterators = rivers.map(r => r[Symbol.asyncIterator]());
      const values: (T[number] | undefined)[] = new Array(rivers.length);
      let hasValues = new Array(rivers.length).fill(false);
      
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
    return new River<T>(generator());
  },
};

export default river;