/**
 * @aid-on/nagare (流れ) - Fluent Stream Methods (Advanced)
 *
 * Advanced fluent API methods for Stream<T>: mapAsync, debounce, throttle,
 * merge, concat, toSSE. These are extracted to keep file sizes manageable.
 */

import type { Stream } from "./types";

/** Type for the stream.create factory function */
export type StreamCreateFn = <T>(setup: (controller: {
  next: (value: T) => void;
  error: (error: Error) => void;
  complete: () => void;
}) => void | (() => void)) => Stream<T>;

/**
 * Build mapAsync TransformStream with concurrency control,
 * error handling, and order preservation
 */
export function buildMapAsync<T, U>(
  readable: ReadableStream<T>,
  fn: (value: T) => Promise<U>,
  concurrency: number,
  wrapStream: (rs: ReadableStream<U>) => Stream<U>,
): Stream<U> {
  const queue: Promise<void>[] = [];
  const resultBuffer = new Map<number, U>();
  let hasErrored = false;
  let abortController: AbortController | undefined;
  let inputIndex = 0;
  let outputIndex = 0;

  const transform = new TransformStream<T, U>({
    start() {
      abortController = new AbortController();
    },

    async transform(chunk, controller) {
      if (hasErrored) return;

      while (queue.length >= concurrency && !hasErrored) {
        await Promise.race(queue);
      }

      if (hasErrored) return;

      const currentIndex = inputIndex++;

      const task = (async () => {
        try {
          if (abortController?.signal.aborted) return;
          const result = await fn(chunk);

          if (!hasErrored && !abortController?.signal.aborted) {
            resultBuffer.set(currentIndex, result);

            while (resultBuffer.has(outputIndex)) {
              controller.enqueue(resultBuffer.get(outputIndex)!);
              resultBuffer.delete(outputIndex);
              outputIndex++;
            }
          }
        } catch (error) {
          if (!hasErrored) {
            hasErrored = true;
            abortController?.abort();
            controller.error(error);
          }
        }
      })();

      queue.push(task);
      task.finally(() => {
        const index = queue.indexOf(task);
        if (index > -1) queue.splice(index, 1);
      });
    },

    async flush(controller) {
      await Promise.allSettled(queue);

      while (resultBuffer.has(outputIndex)) {
        controller.enqueue(resultBuffer.get(outputIndex)!);
        resultBuffer.delete(outputIndex);
        outputIndex++;
      }
    }
  });
  return wrapStream(readable.pipeThrough(transform));
}

/**
 * Build debounce TransformStream
 */
export function buildDebounce<T>(
  readable: ReadableStream<T>,
  ms: number,
  wrapStream: (rs: ReadableStream<T>) => Stream<T>,
): Stream<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let lastValue: T | undefined;

  const transform = new TransformStream<T, T>({
    transform(chunk, controller) {
      lastValue = chunk;
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        if (lastValue !== undefined) {
          controller.enqueue(lastValue);
        }
      }, ms);
    },
    flush(controller) {
      clearTimeout(timeoutId);
      if (lastValue !== undefined) {
        controller.enqueue(lastValue);
      }
    }
  });

  return wrapStream(readable.pipeThrough(transform));
}

/**
 * Build throttle TransformStream with trailing edge support
 */
export function buildThrottle<T>(
  readable: ReadableStream<T>,
  ms: number,
  wrapStream: (rs: ReadableStream<T>) => Stream<T>,
): Stream<T> {
  let lastEmit = 0;
  let pendingValue: T | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const transform = new TransformStream<T, T>({
    transform(chunk, controller) {
      const now = Date.now();

      if (now - lastEmit >= ms) {
        controller.enqueue(chunk);
        lastEmit = now;
        pendingValue = undefined;
      } else {
        pendingValue = chunk;

        if (!timeoutId) {
          const delay = ms - (now - lastEmit);
          timeoutId = setTimeout(() => {
            if (pendingValue !== undefined) {
              controller.enqueue(pendingValue);
              lastEmit = Date.now();
              pendingValue = undefined;
            }
            timeoutId = undefined;
          }, delay);
        }
      }
    },
    flush(controller) {
      if (timeoutId) clearTimeout(timeoutId);
      if (pendingValue !== undefined) {
        controller.enqueue(pendingValue);
      }
    }
  });

  return wrapStream(readable.pipeThrough(transform));
}

/**
 * Build merge operation with proper cleanup
 */
export function buildMerge<T>(
  readable: ReadableStream<T>,
  others: Stream<T>[],
  wrapStream: (rs: ReadableStream<T>) => Stream<T>,
  streamCreate: StreamCreateFn,
): Stream<T> {
  return streamCreate<T>((controller) => {
    const thisStream = wrapStream(readable);
    const streams = [thisStream, ...others];
    let activeStreams = streams.length;
    const subscriptions: { unsubscribe(): void }[] = [];

    streams.forEach(s => {
      const sub = s.subscribe({
        next: async (value) => controller.next(value),
        error: (error) => {
          subscriptions.forEach(sub => sub.unsubscribe());
          controller.error(error);
        },
        complete: () => {
          activeStreams--;
          if (activeStreams === 0) {
            controller.complete();
          }
        }
      });
      subscriptions.push(sub);
    });

    return () => {
      subscriptions.forEach(sub => sub.unsubscribe());
    };
  });
}

/**
 * Build concat operation with cancellation support
 */
export function buildConcat<T>(
  readable: ReadableStream<T>,
  others: Stream<T>[],
  wrapStream: (rs: ReadableStream<T>) => Stream<T>,
  streamCreate: StreamCreateFn,
): Stream<T> {
  return streamCreate<T>((controller) => {
    let cancelled = false;

    (async () => {
      try {
        const thisStream = wrapStream(readable);
        for await (const value of thisStream) {
          if (cancelled) return;
          controller.next(value);
        }

        for (const other of others) {
          if (cancelled) return;
          for await (const value of other) {
            if (cancelled) return;
            controller.next(value);
          }
        }

        if (!cancelled) {
          controller.complete();
        }
      } catch (error) {
        if (!cancelled) {
          controller.error(error instanceof Error ? error : new Error(String(error)));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  });
}

/**
 * Build SSE formatting with error handling
 */
export function buildToSSE<T>(
  readable: ReadableStream<T>,
  formatter: (value: T) => string,
  wrapStream: (rs: ReadableStream<string>) => Stream<string>,
): Stream<string> {
  const transform = new TransformStream<T, string>({
    transform(chunk, controller) {
      try {
        const data = formatter(chunk);
        controller.enqueue(`data: ${data}\n\n`);
      } catch {
        // Silently skip serialization errors
      }
    },
    flush(controller) {
      controller.enqueue('event: done\ndata: [DONE]\n\n');
    }
  });

  return wrapStream(readable.pipeThrough(transform));
}
