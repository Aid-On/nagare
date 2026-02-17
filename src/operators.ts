/**
 * @aid-on/nagare (流れ) - TransformStream Operators
 *
 * Standalone TransformStream-based operators for composable stream processing
 */

// =============================================================================
// TransformStream Operators
// =============================================================================

export const operators = {
  /**
   * Map operator (native TransformStream)
   */
  map<T, U>(fn: (value: T) => U): TransformStream<T, U> {
    return new TransformStream<T, U>({
      transform(chunk, controller) {
        controller.enqueue(fn(chunk));
      }
    });
  },

  /**
   * Filter operator (native TransformStream)
   */
  filter<T>(predicate: (value: T) => boolean): TransformStream<T, T> {
    return new TransformStream<T, T>({
      transform(chunk, controller) {
        if (predicate(chunk)) {
          controller.enqueue(chunk);
        }
      }
    });
  },

  /**
   * Take operator (early termination)
   */
  take<T>(count: number): TransformStream<T, T> {
    let taken = 0;
    return new TransformStream<T, T>({
      transform(chunk, controller) {
        if (taken < count) {
          controller.enqueue(chunk);
          taken++;
          if (taken >= count) {
            controller.terminate();
          }
        }
      }
    });
  },

  /**
   * Buffer operator (batching)
   */
  buffer<T>(size: number): TransformStream<T, T[]> {
    let buffer: T[] = [];
    return new TransformStream<T, T[]>({
      transform(chunk, controller) {
        buffer.push(chunk);
        if (buffer.length >= size) {
          controller.enqueue([...buffer]);
          buffer = [];
        }
      },
      flush(controller) {
        if (buffer.length > 0) {
          controller.enqueue([...buffer]);
        }
      }
    });
  },
};
