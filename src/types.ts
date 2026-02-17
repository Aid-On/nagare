/**
 * @aid-on/nagare (流れ) - Core Types
 *
 * Type definitions for the universal streaming interface
 */

// =============================================================================
// Core Types
// =============================================================================

/**
 * Options for piping a stream (compatible with DOM Streams API)
 * Re-exported for environments where lib.dom.d.ts might not be available
 */
export interface StreamPipeOptions {
  preventClose?: boolean;
  preventAbort?: boolean;
  preventCancel?: boolean;
  signal?: AbortSignal;
}

/**
 * Observer pattern interface for stream subscription
 */
export interface Observer<T> {
  next?: (value: T) => void | Promise<void>;
  error?: (error: Error) => void;
  complete?: () => void;
}

/**
 * Subscription handle for stream subscriptions
 */
export interface Subscription {
  unsubscribe(): void;
  closed: boolean;
}

/**
 * Stream<T> - The universal contract
 * All Aid-On libraries return Stream<T>
 */
export interface Stream<T> extends ReadableStream<T>, AsyncIterable<T> {
  /** Subscribe with Observer pattern */
  subscribe(observer: Observer<T>): Subscription;

  /** Pipe through TransformStream and maintain Stream<T> interface */
  pipeThrough<U>(transform: TransformStream<T, U>): Stream<U>;

  /** Convert to Response (edge function) */
  toResponse(init?: ResponseInit): Response;

  /** Convert to ReadableStream (already is one, but for interface completeness) */
  toReadableStream(): Promise<ReadableStream<T>>;

  /** Collect all values */
  collect(): Promise<T[]>;

  /** Reduce to single value */
  reduce<U>(fn: (acc: U, value: T) => U, initial: U): Promise<U>;

  /** Take first N values */
  take(count: number): Stream<T>;

  /** Take until condition */
  takeUntil(predicate: (value: T) => boolean): Stream<T>;

  // Fluent API operators
  /** Transform each value */
  map<U>(fn: (value: T) => U): Stream<U>;

  /** Filter values */
  filter(predicate: (value: T) => boolean): Stream<T>;

  /** Async map with concurrency control */
  mapAsync<U>(fn: (value: T) => Promise<U>, concurrency?: number): Stream<U>;

  /** Tap into stream without modification (for side effects) */
  tap(fn: (value: T) => void, options?: { rethrow?: boolean }): Stream<T>;

  /** Buffer values into arrays */
  buffer(size: number): Stream<T[]>;

  /** Debounce stream */
  debounce(ms: number): Stream<T>;

  /** Throttle stream */
  throttle(ms: number): Stream<T>;

  /** Merge with another stream */
  merge(...others: Stream<T>[]): Stream<T>;

  /** Concat streams sequentially */
  concat(...others: Stream<T>[]): Stream<T>;

  /** Convert to SSE format for edge streaming */
  toSSE(formatter?: (value: T) => string): Stream<string>;
}
