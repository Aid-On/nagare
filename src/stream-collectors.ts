/**
 * @aid-on/nagare (流れ) - Stream Collection Helpers
 *
 * Extracted collection/iteration methods to reduce line count
 * and cognitive complexity of create-stream.ts.
 */

import type { Stream } from "./types";
import type { FromReadableStreamFn } from "./stream-internal-types";

/**
 * Build the toResponse method for a stream.
 */
export function buildToResponse<T>(readable: ReadableStream<T>) {
  return function toResponse(init?: ResponseInit): Response {
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
  };
}

/**
 * Build the collect method for a stream.
 */
export function buildCollect<T>(readable: ReadableStream<T>) {
  return async function collect(maxItems: number = 10000): Promise<T[]> {
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
  };
}

/**
 * Build the reduce method for a stream.
 */
export function buildReduce<T>(readable: ReadableStream<T>) {
  return async function reduce<U>(fn: (acc: U, value: T) => U, initial: U): Promise<U> {
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
  };
}

/**
 * Build the take method for a stream.
 */
export function buildTake<T>(
  readable: ReadableStream<T>,
  fromReadableStream: FromReadableStreamFn,
) {
  return function take(count: number): Stream<T> {
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
  };
}

/**
 * Build the takeUntil method for a stream.
 */
export function buildTakeUntil<T>(
  readable: ReadableStream<T>,
  fromReadableStream: FromReadableStreamFn,
) {
  return function takeUntil(predicate: (value: T) => boolean): Stream<T> {
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
  };
}

/**
 * Build the async iterator for a stream.
 */
export function buildAsyncIterator<T>(readable: ReadableStream<T>) {
  return async function* asyncIterator(): AsyncIterableIterator<T> {
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
  };
}

/**
 * Build the tap method for a stream.
 */
export function buildTap<T>(
  readable: ReadableStream<T>,
  fromReadableStream: FromReadableStreamFn,
) {
  return function tap(fn: (value: T) => void, options?: { rethrow?: boolean }): Stream<T> {
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
  };
}
