/**
 * @aid-on/nagare (流れ) - Stream Creation Core
 *
 * Core stream creation functions: fromReadableStream, fromArray, createSafeStream.
 * Separated to avoid circular dependencies between index.ts and sse.ts.
 */

import type { StreamPipeOptions, Observer, Subscription, Stream } from "./types";
import { operators } from "./operators";
import {
  buildMapAsync,
  buildDebounce,
  buildThrottle,
  buildMerge,
  buildConcat,
  buildToSSE,
  type StreamCreateFn,
} from "./fluent-methods";

/**
 * Drive the read loop for a subscription, dispatching values to the observer.
 * Extracted to reduce cognitive complexity of subscribe().
 */
async function driveSubscriptionReader<T>(
  reader: ReadableStreamDefaultReader<T>,
  subscription: { closed: boolean },
  observer: Observer<T>,
  activeSubscriptions: WeakSet<{ closed: boolean }>,
): Promise<void> {
  try {
    while (!subscription.closed) {
      const { done, value } = await reader.read();
      if (done) {
        observer.complete?.();
        subscription.closed = true;
        break;
      }
      if (subscription.closed) break;
      if (observer.next) {
        const result = observer.next(value);
        if (result && typeof result.then === 'function') {
          await result;
        }
      }
    }
  } catch (error) {
    if (!subscription.closed) {
      observer.error?.(
        error instanceof Error ? error : new Error(String(error))
      );
    }
  } finally {
    reader.releaseLock();
    activeSubscriptions.delete(subscription);
  }
}

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
      const subscription = { closed: false };
      activeSubscriptions.add(subscription);
      let forSubscription: ReadableStream<T>;
      let reader: ReadableStreamDefaultReader<T>;

      try {
        if (readable.locked) {
          const error = new Error(
            'Cannot subscribe to locked stream. Stream may already be in use.'
            + ' Consider using tee() to create multiple readers.'
          );
          observer.error?.(error);
          activeSubscriptions.delete(subscription);
          return {
            unsubscribe: () => { subscription.closed = true; },
            get closed() { return true; }
          };
        }
        [forSubscription] = readable.tee();
        reader = forSubscription.getReader();
      } catch (e) {
        const error = e instanceof Error
          ? e
          : new Error('Failed to create subscription: ' + String(e));
        observer.error?.(error);
        activeSubscriptions.delete(subscription);
        return {
          unsubscribe: () => { subscription.closed = true; },
          get closed() { return true; }
        };
      }

      driveSubscriptionReader(reader, subscription, observer, activeSubscriptions);

      return {
        unsubscribe: () => {
          subscription.closed = true;
          try { reader.releaseLock(); } catch { /* already released */ }
        },
        get closed() { return subscription.closed; }
      };
    },

    toResponse(init?: ResponseInit): Response {
      const uint8Stream = readable.pipeThrough(new TransformStream({
        transform(chunk, controller) {
          const encoder = new TextEncoder();
          controller.enqueue(encoder.encode(String(chunk)));
        }
      }));
      return new Response(uint8Stream, {
        ...init,
        headers: { "Content-Type": "text/plain; charset=utf-8", ...init?.headers },
      });
    },

    async toReadableStream(): Promise<ReadableStream<T>> {
      return readable;
    },

    async collect(maxItems: number = 10000): Promise<T[]> {
      if (readable.locked) throw new Error('Cannot collect from locked stream');
      const [forCollection] = readable.tee();
      const reader = forCollection.getReader();
      const result: T[] = [];
      try {
        while (result.length < maxItems) {
          const { done, value } = await reader.read();
          if (done) break;
          result.push(value);
        }
      } finally { reader.releaseLock(); }
      return result;
    },

    async reduce<U>(fn: (acc: U, value: T) => U, initial: U): Promise<U> {
      if (readable.locked) throw new Error('Cannot reduce locked stream');
      const [forReduction] = readable.tee();
      const reader = forReduction.getReader();
      let accumulator = initial;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulator = fn(accumulator, value);
        }
      } finally { reader.releaseLock(); }
      return accumulator;
    },

    take(count: number): Stream<T> {
      let taken = 0;
      const transform = new TransformStream<T, T>({
        transform(chunk, controller) {
          if (taken < count) {
            controller.enqueue(chunk);
            taken++;
            if (taken >= count) controller.terminate();
          }
        }
      });
      return fromReadableStream(readable.pipeThrough(transform));
    },

    takeUntil(predicate: (value: T) => boolean): Stream<T> {
      let shouldTerminate = false;
      const transform = new TransformStream<T, T>({
        async transform(chunk, controller) {
          if (shouldTerminate) return;
          if (predicate(chunk)) {
            shouldTerminate = true;
            controller.terminate();
          } else {
            controller.enqueue(chunk);
          }
        }
      });
      return fromReadableStream(readable.pipeThrough(transform));
    },

    async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
      if (readable.locked) throw new Error('Cannot iterate over locked stream');
      const [forIteration] = readable.tee();
      const reader = forIteration.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          yield value;
        }
      } finally { reader.releaseLock(); }
    },

    map<U>(fn: (value: T) => U): Stream<U> {
      return fromReadableStream(readable.pipeThrough(operators.map(fn)));
    },

    filter(predicate: (value: T) => boolean): Stream<T> {
      return fromReadableStream(readable.pipeThrough(operators.filter(predicate)));
    },

    mapAsync<U>(fn: (value: T) => Promise<U>, concurrency: number = 1): Stream<U> {
      return buildMapAsync(readable, fn, concurrency, fromReadableStream);
    },

    tap(fn: (value: T) => void, options?: { rethrow?: boolean }): Stream<T> {
      const { rethrow = false } = options || {};
      const transform = new TransformStream<T, T>({
        transform(chunk, controller) {
          try { fn(chunk); } catch (error) {
            if (rethrow) { controller.error(error); return; }
          }
          controller.enqueue(chunk);
        }
      });
      return fromReadableStream(readable.pipeThrough(transform));
    },

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
