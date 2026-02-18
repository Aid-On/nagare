/**
 * @aid-on/nagare (流れ) - Internal Types
 *
 * Shared internal types used across stream implementation modules.
 */

import type { Stream } from "./types";

/** Type for the fromReadableStream wrapper function */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FromReadableStreamFn = <T>(rs: ReadableStream<T>) => Stream<T>;
