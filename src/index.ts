/**
 * @aid-on/nagare (流れ)
 *
 * 2025 Universal Streaming Interface - Edge-Native Base
 * ReadableStream<T> as first-class entity with reactive extensions
 */

// Re-export all public types
export type { StreamPipeOptions, Observer, Subscription, Stream } from "./types";

// Re-export core creation functions
export { fromReadableStream, fromArray } from "./create-stream";

// Re-export operators
export { operators } from "./operators";

// Re-export SSE
export { fromSSE } from "./sse";

import type { Stream } from "./types";
import { fromReadableStream, fromArray, registerStreamCreate } from "./create-stream";
import { fromSSE } from "./sse";

// =============================================================================
// Stream Factory
// =============================================================================

/**
 * Main stream factory
 */
export const stream = {
  /** Create from array */
  array: fromArray,
  /** Create from ReadableStream */
  from: fromReadableStream,
  /** Create empty stream */
  empty: <T>(): Stream<T> => fromArray<T>([]),
  /** Create single value stream */
  of: <T>(value: T): Stream<T> => fromArray([value]),

  /**
   * Create stream with imperative push (Edge-native pattern)
   * Perfect for LLM streaming, SSE, WebSocket bridges
   */
  create: <T>(setup: (controller: {
    next: (value: T) => void;
    error: (error: Error) => void;
    complete: () => void;
  }) => void | (() => void)): Stream<T> => {
    let cleanup: (() => void) | void;
    const readable = new ReadableStream<T>({
      start(streamController) {
        const controller = {
          next: (value: T) => {
            if (streamController.desiredSize !== null
              && streamController.desiredSize > 0) {
              streamController.enqueue(value);
            }
          },
          error: (error: Error) => streamController.error(error),
          complete: () => streamController.close(),
        };
        cleanup = setup(controller);
      },
      cancel() { cleanup?.(); }
    });
    return fromReadableStream(readable);
  },

  /** Create from Server-Sent Events */
  fromSSE,
};

// Register stream.create so create-stream.ts can use it for merge/concat
registerStreamCreate(stream.create);
