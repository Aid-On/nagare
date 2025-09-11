import { River } from './river';

export function createFromArray<T>(array: T[]): River<T> {
  return new River<T>(array);
}

export function createFromReadableStream<T>(stream: ReadableStream<T>): River<T> {
  return River.fromReadableStream(stream);
}

export function createFromPromise<T>(promise: Promise<T>): River<T> {
  return River.from(promise);
}

export function createFromAsyncIterable<T>(iterable: AsyncIterable<T>): River<T> {
  return new River<T>(iterable);
}

export function createFromIterable<T>(iterable: Iterable<T>): River<T> {
  return new River<T>(iterable);
}

export function createInterval(ms: number, signal?: AbortSignal): River<number> {
  const generator = async function* (): AsyncGenerator<number> {
    let count = 0;
    while (!signal?.aborted) {
      yield count++;
      await new Promise(resolve => setTimeout(resolve, ms));
    }
  };
  return new River<number>(generator());
}

export function createRange(start: number, end: number, step = 1): River<number> {
  const generator = function* (): Generator<number> {
    for (let i = start; i < end; i += step) {
      yield i;
    }
  };
  return new River<number>(generator());
}

export function createFromEventSource(
  eventSource: EventSource,
  eventName = 'message'
): River<MessageEvent> {
  const generator = async function* (): AsyncGenerator<MessageEvent> {
    const queue: MessageEvent[] = [];
    let resolve: ((value: { done: false; value: MessageEvent } | { done: true }) => void) | null = null;
    let closed = false;

    const handler = (event: MessageEvent) => {
      if (resolve) {
        resolve({ done: false, value: event });
        resolve = null;
      } else {
        queue.push(event);
      }
    };

    const errorHandler = () => {
      closed = true;
      if (resolve) {
        resolve({ done: true });
        resolve = null;
      }
    };

    eventSource.addEventListener(eventName, handler as EventListener);
    eventSource.addEventListener('error', errorHandler);

    try {
      while (!closed) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          const result = await new Promise<{ done: false; value: MessageEvent } | { done: true }>(
            (res) => {
              resolve = res;
              if (closed) {
                res({ done: true });
              }
            }
          );
          if (result.done) break;
          if ('value' in result) {
            yield result.value;
          }
        }
      }
    } finally {
      eventSource.removeEventListener(eventName, handler as EventListener);
      eventSource.removeEventListener('error', errorHandler);
    }
  };
  return new River<MessageEvent>(generator());
}

export function createFromWebSocket(
  socket: WebSocket,
  options?: { binary?: boolean }
): River<MessageEvent> {
  const generator = async function* (): AsyncGenerator<MessageEvent> {
    const queue: MessageEvent[] = [];
    let resolve: ((value: { done: false; value: MessageEvent } | { done: true }) => void) | null = null;
    let closed = false;

    if (options?.binary) {
      socket.binaryType = 'arraybuffer';
    }

    const messageHandler = (event: MessageEvent) => {
      if (resolve) {
        resolve({ done: false, value: event });
        resolve = null;
      } else {
        queue.push(event);
      }
    };

    const closeHandler = () => {
      closed = true;
      if (resolve) {
        resolve({ done: true });
        resolve = null;
      }
    };

    socket.addEventListener('message', messageHandler);
    socket.addEventListener('close', closeHandler);
    socket.addEventListener('error', closeHandler);

    try {
      while (!closed && socket.readyState !== WebSocket.CLOSED) {
        if (queue.length > 0) {
          yield queue.shift()!;
        } else {
          const result = await new Promise<{ done: false; value: MessageEvent } | { done: true }>(
            (res) => {
              resolve = res;
              if (closed || socket.readyState === WebSocket.CLOSED) {
                res({ done: true });
              }
            }
          );
          if (result.done) break;
          if ('value' in result) {
            yield result.value;
          }
        }
      }
    } finally {
      socket.removeEventListener('message', messageHandler);
      socket.removeEventListener('close', closeHandler);
      socket.removeEventListener('error', closeHandler);
    }
  };
  return new River<MessageEvent>(generator());
}

export function createFromFetch(
  url: string | URL,
  options?: RequestInit & { pollInterval?: number }
): River<Response> {
  const generator = async function* (): AsyncGenerator<Response> {
    if (options?.pollInterval) {
      while (true) {
        try {
          const response = await fetch(url, options);
          yield response;
          await new Promise(resolve => setTimeout(resolve, options.pollInterval));
        } catch (error) {
          console.error('Fetch error:', error);
          break;
        }
      }
    } else {
      const response = await fetch(url, options);
      yield response;
    }
  };
  return new River<Response>(generator());
}

export function createFromGenerator<T>(
  generator: () => Generator<T> | AsyncGenerator<T>
): River<T> {
  return new River<T>(generator());
}