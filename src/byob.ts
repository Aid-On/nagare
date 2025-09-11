import { wasmModule } from './wasm-loader';

export interface BYOBStreamOptions {
  chunkSize: number;
  highWaterMark?: number;
}

export class BYOBStreamReader {
  private reader: ReadableStreamBYOBReader;
  private bufferSize: number;
  private reusableBuffer: ArrayBuffer | null = null;

  constructor(stream: ReadableStream<Uint8Array>, bufferSize: number) {
    this.reader = stream.getReader({ mode: 'byob' }) as ReadableStreamBYOBReader;
    this.bufferSize = bufferSize;
  }

  async readInto(buffer: Uint8Array): Promise<ReadableStreamReadResult<Uint8Array>> {
    return await this.reader.read(buffer);
  }

  async readWithReusableBuffer(): Promise<ReadableStreamReadResult<Uint8Array>> {
    if (!this.reusableBuffer) {
      this.reusableBuffer = new ArrayBuffer(this.bufferSize);
    }
    const view = new Uint8Array(this.reusableBuffer);
    return await this.readInto(view);
  }

  async cancel(reason?: any): Promise<void> {
    await this.reader.cancel(reason);
  }

  releaseLock(): void {
    this.reader.releaseLock();
  }
}

export class BYOBStreamController {
  private chunkSize: number;
  private highWaterMark: number;

  constructor(options: BYOBStreamOptions) {
    this.chunkSize = options.chunkSize;
    this.highWaterMark = options.highWaterMark || options.chunkSize * 3;
  }

  createReadableStream(
    pullFn: (controller: ReadableByteStreamController) => void | Promise<void>
  ): ReadableStream<Uint8Array> {
    return new ReadableStream<Uint8Array>({
      type: 'bytes',
      autoAllocateChunkSize: this.chunkSize,

      async pull(controller) {
        const c = controller as unknown as { byobRequest?: { view?: Uint8Array; respond: (n: number) => void } };
        const byobRequest = c.byobRequest;
        if (byobRequest) {
          const view = byobRequest.view;
          if (view) {
            await pullFn(controller as ReadableByteStreamController);
            byobRequest.respond(view.byteLength);
          }
        }
      },

      cancel(reason) {
        console.log('Stream cancelled:', reason);
      },
    });
  }

  getChunkSize(): number {
    return this.chunkSize;
  }

  getHighWaterMark(): number {
    return this.highWaterMark;
  }
}

export function createZeroCopyView(buffer: Uint8Array): Uint8Array {
  if (!wasmModule) {
    throw new Error('WASM module not loaded');
  }
  return wasmModule.create_zero_copy_view(buffer);
}

export function createFloat32View(buffer: Float32Array): Float32Array {
  if (!wasmModule) {
    throw new Error('WASM module not loaded');
  }
  return wasmModule.create_float32_view(buffer);
}

export class BufferPool {
  private buffers: ArrayBuffer[] = [];
  private bufferSize: number;
  private maxBuffers: number;

  constructor(bufferSize: number, maxBuffers = 10) {
    this.bufferSize = bufferSize;
    this.maxBuffers = maxBuffers;
  }

  acquire(): ArrayBuffer {
    const buffer = this.buffers.pop();
    if (buffer) {
      return buffer;
    }
    return new ArrayBuffer(this.bufferSize);
  }

  release(buffer: ArrayBuffer): void {
    if (this.buffers.length < this.maxBuffers && buffer.byteLength === this.bufferSize) {
      this.buffers.push(buffer);
    }
  }

  available(): number {
    return this.buffers.length;
  }

  clear(): void {
    this.buffers = [];
  }
}

export function createBYOBTransformStream(
  transform: (chunk: Uint8Array) => Uint8Array | Promise<Uint8Array>,
  _options?: BYOBStreamOptions
): TransformStream<Uint8Array, Uint8Array> {
  // const bufferPool = new BufferPool(_options?.chunkSize || 65536);

  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, controller) {
      try {
        const result = await transform(chunk);
        controller.enqueue(result);
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

export async function pipeBYOBStreams(
  source: ReadableStream<Uint8Array>,
  destination: WritableStream<Uint8Array>,
  options?: { chunkSize?: number; signal?: AbortSignal }
): Promise<void> {
  const chunkSize = options?.chunkSize || 65536;
  const reader = new BYOBStreamReader(source, chunkSize);
  const writer = destination.getWriter();

  try {
    while (!options?.signal?.aborted) {
      const result = await reader.readWithReusableBuffer();
      
      if (result.done) {
        break;
      }

      if (result.value) {
        await writer.write(result.value);
      }
    }
  } finally {
    reader.releaseLock();
    await writer.close();
  }
}
