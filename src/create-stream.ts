/**
 * @aid-on/nagare (流れ) - Stream Creation Core
 *
 * Core stream creation functions: fromReadableStream, fromArray, createSafeStream.
 * Separated to avoid circular dependencies between index.ts and sse.ts.
 */

import type { StreamPipeOptions, Observer, Subscription, Stream } from "./types";
import { operators } from "./operators";
import { handleSubscribe } from "./stream-subscribe";
import {
  buildToResponse,
  buildCollect,
  buildReduce,
  buildTake,
  buildTakeUntil,
  buildAsyncIterator,
  buildTap,
} from "./stream-collectors";
import {
  buildMapAsync,
  buildDebounce,
  buildThrottle,
  buildMerge,
  buildConcat,
  buildToSSE,
  type StreamCreateFn,
} from "./fluent-methods";

/** Lazy reference to stream.create - set by index.ts at module init */
let _streamCreate: StreamCreateFn | undefined;

/** Register the stream.create factory (called by index.ts to break circular dep) */
export function registerStreamCreate(fn: StreamCreateFn): void {
  _streamCreate = fn;
}

function getStreamCreate(): StreamCreateFn {
  if (!_streamCreate) {
    throw new Error("stream.create not registered. This is a nagare internal error.");
  }
  return _streamCreate;
}

/**
 * Create Stream from ReadableStream
 * Safe wrapper implementation without Object.assign
 */
export function fromReadableStream<T>(readable: ReadableStream<T>): Stream<T> {
  return createSafeStream(readable);
}

/**
 * Create Stream from array
 */
export function fromArray<T>(items: T[]): Stream<T> {
  const readable = new ReadableStream<T>({
    start(controller) {
      for (const item of items) {
        controller.enqueue(item);
      }
      controller.close();
    }
  });
  return fromReadableStream(readable);
}

/**
 * Create safe Stream without mutating the original ReadableStream.
 * Uses Proxy to maintain instanceof ReadableStream while adding Stream methods.
 */
function createSafeStream<T>(readable: ReadableStream<T>): Stream<T> {
  const activeSubscriptions = new WeakSet<{ closed: boolean }>();

  const streamMethods = {
    get locked() { return readable.locked; },
    cancel: (reason?: unknown) => readable.cancel(reason),
    getReader: () => readable.getReader(),
    tee: () => readable.tee(),
    pipeTo: (destination: WritableStream<T>, options?: StreamPipeOptions) =>
      readable.pipeTo(destination, options),
    pipeThrough: <U>(transform: TransformStream<T, U>) => {
      return fromReadableStream(readable.pipeThrough(transform));
    },

    subscribe(observer: Observer<T>): Subscription {
      return handleSubscribe(readable, observer, activeSubscriptions);
    },

    toResponse: buildToResponse(readable),
    toReadableStream: async (): Promise<ReadableStream<T>> => readable,
    collect: buildCollect(readable),
    reduce: buildReduce(readable),
    take: buildTake(readable, fromReadableStream),
    takeUntil: buildTakeUntil(readable, fromReadableStream),
    [Symbol.asyncIterator]: buildAsyncIterator(readable),

    map<U>(fn: (value: T) => U): Stream<U> {
      return fromReadableStream(readable.pipeThrough(operators.map(fn)));
    },

    filter(predicate: (value: T) => boolean): Stream<T> {
      return fromReadableStream(readable.pipeThrough(operators.filter(predicate)));
    },

    mapAsync<U>(fn: (value: T) => Promise<U>, concurrency: number = 1): Stream<U> {
      return buildMapAsync(readable, fn, concurrency, fromReadableStream);
    },

    tap: buildTap(readable, fromReadableStream),

    buffer(size: number): Stream<T[]> {
      return fromReadableStream(readable.pipeThrough(operators.buffer(size)));
    },

    debounce(ms: number): Stream<T> {
      return buildDebounce(readable, ms, fromReadableStream);
    },

    throttle(ms: number): Stream<T> {
      return buildThrottle(readable, ms, fromReadableStream);
    },

    merge(...others: Stream<T>[]): Stream<T> {
      return buildMerge(readable, others, fromReadableStream, getStreamCreate());
    },

    concat(...others: Stream<T>[]): Stream<T> {
      return buildConcat(readable, others, fromReadableStream, getStreamCreate());
    },

    toSSE(formatter: (value: T) => string = (v) => JSON.stringify(v)): Stream<string> {
      return buildToSSE(readable, formatter, fromReadableStream);
    },
  };

  return new Proxy(readable, {
    get(target, prop, receiver) {
      if (prop in streamMethods) {
        return (streamMethods as Record<string | symbol, unknown>)[prop];
      }
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      return prop in streamMethods || prop in target;
    }
  }) as Stream<T>;
}
