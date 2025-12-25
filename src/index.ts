/**
 * @aid-on/nagare (流れ)
 *
 * 2025 Universal Streaming Interface - Edge-Native Base
 * ReadableStream<T> as first-class entity with reactive extensions
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

// =============================================================================
// Core Implementation
// =============================================================================

/**
 * Create Stream from ReadableStream
 * Safe wrapper implementation without Object.assign
 */
export function fromReadableStream<T>(readable: ReadableStream<T>): Stream<T> {
  // Use safe wrapper instead of Object.assign
  return createSafeStream(readable);
}

/**
 * Create safe Stream without mutating the original ReadableStream
 * This implementation avoids monkey-patching issues and preserves instanceof checks
 */
function createSafeStream<T>(readable: ReadableStream<T>): Stream<T> {
  // Store active subscriptions for cleanup
  const activeSubscriptions = new WeakSet<{ closed: boolean }>();
  
  // Create the enhanced stream methods object
  const streamMethods = {
    // Preserve ReadableStream interface
    get locked() { return readable.locked; },
    cancel: (reason?: any) => readable.cancel(reason),
    getReader: () => readable.getReader(),
    tee: () => readable.tee(),
    pipeTo: (destination: WritableStream<T>, options?: StreamPipeOptions) => 
      readable.pipeTo(destination, options),
    pipeThrough: <U>(transform: TransformStream<T, U>) => {
      const piped = readable.pipeThrough(transform);
      return fromReadableStream(piped);
    },
    /**
     * Creates a subscription to the stream with backpressure support.
     * 
     * IMPORTANT: This method uses `tee()` internally to create a fork of the stream.
     * Once `subscribe()` is called, the original stream becomes locked and cannot be 
     * subscribed to again. This is a "Cold Observable" pattern with one-time consumption.
     * 
     * If you need multiple subscriptions, explicitly use `tee()` first:
     * ```typescript
     * const [stream1, stream2] = originalStream.tee();
     * stream1.subscribe(observer1);
     * stream2.subscribe(observer2);
     * ```
     * 
     * @param observer - Observer object with next, error, and complete callbacks
     * @returns Subscription object with unsubscribe method and closed state
     */
    subscribe(observer: Observer<T>): Subscription {
      const subscription = { closed: false };
      activeSubscriptions.add(subscription);
      // Check if stream is locked before tee
      let forSubscription: ReadableStream<T>;
      let reader: ReadableStreamDefaultReader<T>;
      
      try {
        if (readable.locked) {
          // If stream is locked, we cannot safely create a subscription
          // This prevents issues with consuming already-read streams
          const error = new Error('Cannot subscribe to locked stream. Stream may already be in use. Consider using tee() to create multiple readers.');
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
        // If tee() fails for any other reason, report the error
        const error = e instanceof Error ? e : new Error('Failed to create subscription: ' + String(e));
        observer.error?.(error);
        activeSubscriptions.delete(subscription);
        return {
          unsubscribe: () => { subscription.closed = true; },
          get closed() { return true; }
        };
      }
      
      (async () => {
        try {
          while (!subscription.closed) {
            const { done, value } = await reader.read();
            if (done) {
              observer.complete?.();
              subscription.closed = true;
              break;
            }
            if (subscription.closed) break; // Check again after read
            
            // Support async next for backpressure
            if (observer.next) {
              const result = observer.next(value);
              // If next returns a promise, await it for backpressure
              if (result && typeof result.then === 'function') {
                await result;
              }
            }
          }
        } catch (error) {
          if (!subscription.closed) {
            observer.error?.(error instanceof Error ? error : new Error(String(error)));
          }
        } finally {
          reader.releaseLock();
          activeSubscriptions.delete(subscription);
        }
      })();

      return {
        unsubscribe: () => { 
          subscription.closed = true;
          // Only release lock if reader is not already released
          try {
            reader.releaseLock();
          } catch {
            // Already released, ignore
          }
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
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          ...init?.headers,
        },
      });
    },

    async toReadableStream(): Promise<ReadableStream<T>> {
      return readable;
    },

    // Collect with memory limit for safety
    async collect(maxItems: number = 10000): Promise<T[]> {
      // Ensure we can safely tee
      if (readable.locked) {
        throw new Error('Cannot collect from locked stream');
      }
      const [forCollection] = readable.tee();
      const reader = forCollection.getReader();
      const result: T[] = [];
      
      try {
        while (result.length < maxItems) {
          const { done, value } = await reader.read();
          if (done) break;
          result.push(value);
        }
        if (result.length >= maxItems) {
          console.warn(`Stream.collect: Reached max items limit (${maxItems})`);
        }
      } finally {
        reader.releaseLock();
      }
      
      return result;
    },

    async reduce<U>(fn: (acc: U, value: T) => U, initial: U): Promise<U> {
      // Ensure we can safely tee
      if (readable.locked) {
        throw new Error('Cannot reduce locked stream');
      }
      const [forReduction] = readable.tee();
      const reader = forReduction.getReader();
      let accumulator = initial;
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulator = fn(accumulator, value);
        }
      } finally {
        reader.releaseLock();
      }
      
      return accumulator;
    },

    take(count: number): Stream<T> {
      let taken = 0;
      const transform = new TransformStream<T, T>({
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
      
      return fromReadableStream(readable.pipeThrough(transform));
    },

    takeUntil(predicate: (value: T) => boolean): Stream<T> {
      let shouldTerminate = false;
      
      const transform = new TransformStream<T, T>({
        async transform(chunk, controller) {
          if (shouldTerminate) {
            return; // Already terminated
          }
          
          if (predicate(chunk)) {
            shouldTerminate = true;
            controller.terminate();
            // Note: The terminate() call will trigger the underlying readable stream
            // to stop producing values and clean up resources automatically
            // through the Streams API backpressure mechanism
          } else {
            controller.enqueue(chunk);
          }
        }
      });
      
      return fromReadableStream(readable.pipeThrough(transform));
    },

    async *[Symbol.asyncIterator](): AsyncIterableIterator<T> {
      // Ensure we can safely tee
      if (readable.locked) {
        throw new Error('Cannot iterate over locked stream');
      }
      const [forIteration] = readable.tee();
      const reader = forIteration.getReader();
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    },
    
    // Fluent API implementations
    map<U>(fn: (value: T) => U): Stream<U> {
      return fromReadableStream(readable.pipeThrough(operators.map(fn)));
    },
    
    filter(predicate: (value: T) => boolean): Stream<T> {
      return fromReadableStream(readable.pipeThrough(operators.filter(predicate)));
    },
    
    // Enhanced mapAsync with proper concurrency control, error handling, and order preservation
    mapAsync<U>(fn: (value: T) => Promise<U>, concurrency: number = 1): Stream<U> {
      const queue: Promise<void>[] = [];
      const resultBuffer = new Map<number, U>(); // Buffer for maintaining order
      let hasErrored = false;
      let abortController: AbortController | undefined;
      let inputIndex = 0; // Track input order
      let outputIndex = 0; // Track output order
      
      const transform = new TransformStream<T, U>({
        start() {
          // Create abort controller for canceling pending tasks on error
          abortController = new AbortController();
        },
        
        async transform(chunk, controller) {
          // Skip processing if an error has already occurred
          if (hasErrored) return;
          
          // Wait if queue is full (backpressure)
          while (queue.length >= concurrency && !hasErrored) {
            await Promise.race(queue);
          }
          
          // Double-check after waiting
          if (hasErrored) return;
          
          const currentIndex = inputIndex++;
          
          const task = (async () => {
            try {
              // Check abort signal before processing
              if (abortController?.signal.aborted) return;
              
              const result = await fn(chunk);
              
              // Only store result if we haven't errored and controller is still writable
              if (!hasErrored && !abortController?.signal.aborted) {
                // Store result in buffer with its index
                resultBuffer.set(currentIndex, result);
                
                // Flush buffer in order
                while (resultBuffer.has(outputIndex)) {
                  controller.enqueue(resultBuffer.get(outputIndex)!);
                  resultBuffer.delete(outputIndex);
                  outputIndex++;
                }
              }
            } catch (error) {
              if (!hasErrored) {
                hasErrored = true;
                // Signal all pending tasks to stop
                abortController?.abort();
                controller.error(error);
              }
              // Silently ignore if we've already errored (prevents secondary errors)
            }
          })();
          
          queue.push(task);
          task.finally(() => {
            const index = queue.indexOf(task);
            if (index > -1) queue.splice(index, 1);
          });
        },
        
        async flush(controller) {
          // Wait for all pending tasks to complete or be aborted
          await Promise.allSettled(queue);
          
          // Flush any remaining buffered results in order
          while (resultBuffer.has(outputIndex)) {
            controller.enqueue(resultBuffer.get(outputIndex)!);
            resultBuffer.delete(outputIndex);
            outputIndex++;
          }
        }
      });
      return fromReadableStream(readable.pipeThrough(transform));
    },
    
    // Safe tap with configurable error handling
    tap(fn: (value: T) => void, options?: { rethrow?: boolean }): Stream<T> {
      const { rethrow = false } = options || {};
      
      const transform = new TransformStream<T, T>({
        transform(chunk, controller) {
          try {
            fn(chunk);
          } catch (error) {
            if (rethrow) {
              // Propagate error to stream if rethrow is enabled
              controller.error(error);
              return;
            } else {
              // Log but don't fail the stream on tap errors by default
              console.error('Stream.tap error:', error);
            }
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
      let timeoutId: any;
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
      
      return fromReadableStream(readable.pipeThrough(transform));
    },
    
    // Enhanced throttle with trailing edge support
    throttle(ms: number): Stream<T> {
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
            // Store the latest value for trailing edge
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
      
      return fromReadableStream(readable.pipeThrough(transform));
    },
    
    // Merge with proper cleanup
    merge(...others: Stream<T>[]): Stream<T> {
      return stream.create<T>((controller) => {
        // Create proper Stream<T> from current readable
        const thisStream = fromReadableStream(readable);
        const streams = [thisStream, ...others];
        let activeStreams = streams.length;
        const subscriptions: { unsubscribe(): void }[] = [];
        
        streams.forEach(s => {
          const sub = s.subscribe({
            next: async (value) => controller.next(value),
            error: (error) => {
              // Cancel all other subscriptions on error
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
        
        // Return cleanup function
        return () => {
          subscriptions.forEach(sub => sub.unsubscribe());
        };
      });
    },
    
    // Concat with cancellation support
    concat(...others: Stream<T>[]): Stream<T> {
      return stream.create<T>((controller) => {
        let cancelled = false;
        
        (async () => {
          try {
            // Create proper Stream<T> from current readable
            const thisStream = fromReadableStream(readable);
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
        
        // Return cleanup function
        return () => {
          cancelled = true;
        };
      });
    },
    
    // SSE formatting with error handling
    toSSE(formatter: (value: T) => string = (v) => JSON.stringify(v)): Stream<string> {
      const transform = new TransformStream<T, string>({
        transform(chunk, controller) {
          try {
            const data = formatter(chunk);
            controller.enqueue(`data: ${data}\n\n`);
          } catch (error) {
            // Skip serialization errors
            console.error('SSE formatter error:', error);
          }
        },
        flush(controller) {
          controller.enqueue('event: done\ndata: [DONE]\n\n');
        }
      });
      
      return fromReadableStream(readable.pipeThrough(transform));
    },
  };

  // Use Proxy to maintain instanceof ReadableStream while adding Stream methods
  // This ensures compatibility with APIs expecting ReadableStream instances
  return new Proxy(readable, {
    get(target, prop, receiver) {
      // Check if property exists in streamMethods first
      if (prop in streamMethods) {
        return (streamMethods as any)[prop];
      }
      // Fall back to the original ReadableStream
      return Reflect.get(target, prop, receiver);
    },
    has(target, prop) {
      return prop in streamMethods || prop in target;
    }
  }) as Stream<T>;
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
            if (streamController.desiredSize !== null && streamController.desiredSize > 0) {
              streamController.enqueue(value);
            }
          },
          error: (error: Error) => streamController.error(error),
          complete: () => streamController.close(),
        };
        
        cleanup = setup(controller);
      },
      cancel() {
        cleanup?.();
      }
    });
    
    return fromReadableStream(readable);
  },

  /**
   * Create stream from Server-Sent Events (Edge-native SSE consumer)
   * Fluent API for SSE streaming with automatic buffering & parsing
   * 
   * @example
   * ```typescript
   * const events = await stream.fromSSE("/api/chat", {
   *   method: "POST",
   *   body: { message: "Hello" },
   *   parser: data => JSON.parse(data) as ChatEvent
   * });
   * 
   * events
   *   .filter(e => e.type === "chunk")
   *   .map(e => e.content)
   *   .subscribe({ next: content => console.log(content) });
   * ```
   */
  fromSSE: async <T = any>(
    url: string,
    options: {
      method?: "GET" | "POST" | "PUT" | "DELETE";
      body?: any;
      headers?: Record<string, string>;
      parser?: (data: string) => T;
      signal?: AbortSignal;
      credentials?: RequestCredentials;
    } = {}
  ): Promise<Stream<T>> => {
    const {
      method = "GET",
      body,
      headers = {},
      parser = (data) => JSON.parse(data) as T,
      signal,
      credentials = "include"
    } = options;

    const response = await fetch(url, {
      method,
      headers: {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined,
      credentials,
      signal
    });

    // Check if response is SSE
    const contentType = response.headers.get("content-type");
    if (!response.ok || !contentType?.includes("text/event-stream")) {
      throw new Error(`Not an SSE response: ${response.status} ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    // Transform Response body to parsed SSE stream with proper buffering
    let buffer = "";
    
    const sseStream = response.body
      .pipeThrough(new TextDecoderStream())
      .pipeThrough(new TransformStream<string, T>({
        transform(chunk, controller) {
          // Add chunk to buffer for incomplete line handling
          buffer += chunk;
          // Support all line endings: \r\n (Windows), \n (Unix), \r (Old Mac)
          const lines = buffer.split(/\r\n|\n|\r/);
          
          // Keep last incomplete line in buffer
          // Check if chunk ends with any line ending
          if (!buffer.match(/(\r\n|\n|\r)$/)) {
            buffer = lines.pop() || "";
          } else {
            buffer = "";
          }
          
          // Process complete lines
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue; // Skip empty lines
            
            if (trimmed.startsWith("data: ")) {
              const dataStr = trimmed.slice(6).trim();
              
              if (dataStr === "[DONE]") {
                controller.terminate();
                return;
              }
              
              if (dataStr) {
                try {
                  const parsed = parser(dataStr);
                  controller.enqueue(parsed);
                } catch (e) {
                  // Skip parse errors (heartbeats, etc)
                }
              }
            }
          }
        },
        flush(controller) {
          // Process any remaining buffer on stream end
          if (buffer.trim().startsWith("data: ")) {
            const dataStr = buffer.slice(6).trim();
            if (dataStr && dataStr !== "[DONE]") {
              try {
                const parsed = parser(dataStr);
                controller.enqueue(parsed);
              } catch (e) {
                // Ignore final parse errors
              }
            }
          }
        }
      }));

    return fromReadableStream(sseStream);
  },
};