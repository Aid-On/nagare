export interface Disposable {
  [Symbol.dispose]?(): void;
  [Symbol.asyncDispose]?(): Promise<void>;
}

export interface Subscription {
  unsubscribe(): void;
  readonly isActive: boolean;
}

export interface NagareOptions {
  signal?: AbortSignal;
  onError?: ErrorHandler<any>;
  onComplete?: () => void;
}

export type ErrorHandler<E> = (error: E) => void;

export interface Frame {
  sequence: number;
  timestamp: number;
  payload: Payload;
}

export type Payload = 
  | { type: 'data'; data: Uint8Array }
  | { type: 'float32'; data: Float32Array }
  | { type: 'control'; message: ControlMessage }
  | { type: 'error'; code: number; message: string; recoverable: boolean };

export type ControlMessage =
  | { type: 'credit'; amount: number }
  | { type: 'ack'; sequence: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'complete' }
  | { type: 'subscribe'; streamId: string }
  | { type: 'unsubscribe'; streamId: string };

export interface CreditController {
  consumeCredit(amount: number): boolean;
  addCredits(amount: number): void;
  availableCredits(): number;
}

export interface BYOBOptions {
  chunkSize: number;
  highWaterMark: number;
}

export interface WebSocketMessage {
  type: 'binary' | 'text';
  data: ArrayBuffer | string;
}

export interface DurableObjectState {
  requestId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  payload: any;
  result?: any;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

export interface QueueOptions {
  maxRetries?: number;
  retryDelay?: number;
  ttl?: number;
}

export interface StreamConfig {
  bufferSize?: number;
  enableCompression?: boolean;
  enableEncryption?: boolean;
  binaryMode?: boolean;
}

export type Operator<T, U> = (value: T) => U | Promise<U> | undefined;

export interface WindowedOperatorConfig {
  windowSize: number;
  operation: 'mean' | 'sum' | 'max' | 'min' | 'variance' | 'std';
  overlap?: number;
}

export interface RateLimiterConfig {
  windowSizeMs: number;
  maxEvents: number;
}

export interface BackpressureConfig {
  initialCredits: number;
  maxCredits?: number;
  creditRefillRate?: number;
}

export interface SerializationConfig {
  format: 'postcard' | 'json' | 'msgpack';
  compression?: boolean;
}

export type NagareSource<T> = 
  | AsyncIterable<T>
  | Iterable<T>
  | ReadableStream<T>
  | Promise<T>
  | T[];

export interface NagareTransform<T, U> {
  (nagare: Nagare<T>): Nagare<U>;
}

export interface Nagare<T, E = never> extends AsyncIterable<T> {
  observe(
    next: (value: T) => void,
    options?: NagareOptions
  ): Disposable & Subscription;

  map<U>(fn: (value: T) => U | Promise<U>): Nagare<U, E>;
  filter(predicate: (value: T) => boolean | Promise<boolean>): Nagare<T, E>;
  scan<U>(fn: (acc: U, value: T) => U | Promise<U>, initial: U): Nagare<U, E>;
  take(count: number): Nagare<T, E>;
  skip(count: number): Nagare<T, E>;
  fork(predicate: (value: T) => boolean): [Nagare<T, E>, Nagare<T, E>];
  merge<U>(...others: Nagare<U, E>[]): Nagare<T | U, E>;
  rescue(handler: (error: unknown) => T | undefined): Nagare<T, E>;
  terminateOnErrorMode(): Nagare<T, E>;
  
  mapWasm(kernelName: string, params?: any): Promise<Nagare<T, E>>;
  windowedAggregate(windowSize: number, operation: string): Nagare<number, E>;
  
  toReadableStream(): ReadableStream<T>;
  toArray(): Promise<T[]>;
  first(): Promise<T | undefined>;
  last(): Promise<T | undefined>;
  count(): Promise<number>;
  all(predicate: (value: T) => boolean | Promise<boolean>): Promise<boolean>;
  some(predicate: (value: T) => boolean | Promise<boolean>): Promise<boolean>;
}

declare global {
  interface SymbolConstructor {
    readonly dispose: unique symbol;
    readonly asyncDispose: unique symbol;
  }
}