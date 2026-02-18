/**
 * @aid-on/nagare (流れ) - MapAsync Helpers
 *
 * Extracted mapAsync helper functions to reduce cognitive complexity
 * and parameter count in fluent-methods.ts.
 */

/** Options for executeMapAsyncTask, reducing parameter count */
export interface MapAsyncTaskOptions<T, U> {
  chunk: T;
  currentIndex: number;
  fn: (value: T) => Promise<U>;
  resultBuffer: Map<number, U>;
  outputIndex: { value: number };
  state: { hasErrored: boolean };
  abortController: AbortController | undefined;
  controller: TransformStreamDefaultController<U>;
}

/**
 * Flush ordered results from the buffer to the controller.
 */
export function flushOrderedResults<U>(
  resultBuffer: Map<number, U>,
  outputIndex: { value: number },
  controller: TransformStreamDefaultController<U>,
): void {
  while (resultBuffer.has(outputIndex.value)) {
    const item = resultBuffer.get(outputIndex.value) as U;
    controller.enqueue(item);
    resultBuffer.delete(outputIndex.value);
    outputIndex.value++;
  }
}

/**
 * Execute a single mapAsync task: run the async fn and buffer the result.
 */
export async function executeMapAsyncTask<T, U>(
  options: MapAsyncTaskOptions<T, U>,
): Promise<void> {
  const {
    chunk, currentIndex, fn, resultBuffer,
    outputIndex, state, abortController, controller,
  } = options;

  try {
    if (abortController?.signal.aborted) return;
    const result = await fn(chunk);

    if (!state.hasErrored && !abortController?.signal.aborted) {
      resultBuffer.set(currentIndex, result);
      flushOrderedResults(resultBuffer, outputIndex, controller);
    }
  } catch (error) {
    if (!state.hasErrored) {
      state.hasErrored = true;
      abortController?.abort();
      controller.error(error);
    }
  }
}
