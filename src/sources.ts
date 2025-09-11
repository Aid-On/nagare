import { Nagare } from './nagare';

export function createFromArray<T>(array: T[]): Nagare<T> {
  return new Nagare<T>(array);
}

export function createFromReadableStream<T>(stream: ReadableStream<T>): Nagare<T> {
  return Nagare.fromReadableStream(stream);
}

export function createFromPromise<T>(promise: Promise<T>): Nagare<T> {
  return Nagare.from(promise);
}

export function createFromAsyncIterable<T>(iterable: AsyncIterable<T>): Nagare<T> {
  return new Nagare<T>(iterable);
}

export function createFromIterable<T>(iterable: Iterable<T>): Nagare<T> {
  return new Nagare<T>(iterable);
}

export function createInterval(ms: number, signal?: AbortSignal): Nagare<number> {
  const generator = async function* (): AsyncGenerator<number> {
    let count = 0;
    while (!signal?.aborted) {
      yield count++;
      await new Promise(resolve => setTimeout(resolve, ms));
    }
  };
  return new Nagare<number>(generator());
}

export function createRange(start: number, end: number, step = 1): Nagare<number> {
  const generator = function* (): Generator<number> {
    for (let i = start; i < end; i += step) {
      yield i;
    }
  };
  return new Nagare<number>(generator());
}

export function createFromEventSource(
  eventSource: EventSource,
  eventName = 'message'
): Nagare<MessageEvent> {
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
  return new Nagare<MessageEvent>(generator());
}

export function createFromWebSocket(
  socket: WebSocket,
  options?: { binary?: boolean }
): Nagare<MessageEvent> {
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
  return new Nagare<MessageEvent>(generator());
}

export function createFromFetch(
  url: string | URL,
  options?: RequestInit & { pollInterval?: number }
): Nagare<Response> {
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
  return new Nagare<Response>(generator());
}

export function createFromGenerator<T>(
  generator: () => Generator<T> | AsyncGenerator<T>
): Nagare<T> {
  return new Nagare<T>(generator());
}