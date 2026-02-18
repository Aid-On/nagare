/**
 * @aid-on/nagare (流れ) - Stream Subscription Helpers
 *
 * Extracted subscription logic to reduce cognitive complexity
 * and file size of create-stream.ts.
 */

import type { Observer, Subscription } from "./types";

/**
 * Dispatch a value to the observer, awaiting async next handlers.
 */
async function dispatchToObserver<T>(
  observer: Observer<T>,
  value: T,
): Promise<void> {
  if (!observer.next) return;
  const result = observer.next(value);
  if (result && typeof result.then === 'function') {
    await result;
  }
}

/**
 * Report an error to the observer if the subscription is still active.
 */
function reportSubscriptionError<T>(
  subscription: { closed: boolean },
  observer: Observer<T>,
  error: unknown,
): void {
  if (subscription.closed) return;
  observer.error?.(
    error instanceof Error ? error : new Error(String(error))
  );
}

/**
 * Drive the read loop for a subscription, dispatching values to the observer.
 */
export async function driveSubscriptionReader<T>(
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
      await dispatchToObserver(observer, value);
    }
  } catch (error) {
    reportSubscriptionError(subscription, observer, error);
  } finally {
    reader.releaseLock();
    activeSubscriptions.delete(subscription);
  }
}

/**
 * Create an already-closed error subscription.
 * Used when subscribe() fails during setup.
 */
export function createErrorSubscription(
  subscription: { closed: boolean },
): Subscription {
  return {
    unsubscribe: () => { subscription.closed = true; },
    get closed() { return true; }
  };
}

/**
 * Handle subscription setup: tee the readable, get a reader, and start reading.
 * Returns a Subscription handle.
 */
export function handleSubscribe<T>(
  readable: ReadableStream<T>,
  observer: Observer<T>,
  activeSubscriptions: WeakSet<{ closed: boolean }>,
): Subscription {
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
      return createErrorSubscription(subscription);
    }
    [forSubscription] = readable.tee();
    reader = forSubscription.getReader();
  } catch (e) {
    const error = e instanceof Error
      ? e
      : new Error('Failed to create subscription: ' + String(e));
    observer.error?.(error);
    activeSubscriptions.delete(subscription);
    return createErrorSubscription(subscription);
  }

  void driveSubscriptionReader(reader, subscription, observer, activeSubscriptions);

  return {
    unsubscribe: () => {
      subscription.closed = true;
      try { reader.releaseLock(); } catch { /* already released */ }
    },
    get closed() { return subscription.closed; }
  };
}
