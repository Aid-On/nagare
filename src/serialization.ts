import { ensureWasmLoaded, wasmModule } from './wasm-loader';
import type { Frame, Payload, ControlMessage } from './types';

export async function encodePostcard(frame: Frame): Promise<Uint8Array> {
  await ensureWasmLoaded();
  if (!wasmModule) {
    throw new Error('WASM module not loaded');
  }
  return wasmModule.encode_postcard(frame);
}

export async function decodePostcard(bytes: Uint8Array): Promise<Frame> {
  await ensureWasmLoaded();
  if (!wasmModule) {
    throw new Error('WASM module not loaded');
  }
  return wasmModule.decode_postcard(bytes);
}

export function encodeFrame(frame: Frame): Uint8Array {
  const json = JSON.stringify(frame);
  const encoder = new TextEncoder();
  return encoder.encode(json);
}

export function decodeFrame(bytes: Uint8Array): Frame {
  const decoder = new TextDecoder();
  const json = decoder.decode(bytes);
  return JSON.parse(json);
}

export function createDataFrame(data: Uint8Array, sequence: number): Frame {
  return {
    sequence,
    timestamp: Date.now(),
    payload: {
      type: 'data',
      data,
    },
  };
}

export function createFloat32Frame(data: Float32Array, sequence: number): Frame {
  return {
    sequence,
    timestamp: Date.now(),
    payload: {
      type: 'float32',
      data,
    },
  };
}

export function createControlFrame(message: ControlMessage, sequence: number): Frame {
  return {
    sequence,
    timestamp: Date.now(),
    payload: {
      type: 'control',
      message,
    },
  };
}

export function createErrorFrame(
  code: number,
  message: string,
  recoverable: boolean,
  sequence: number
): Frame {
  return {
    sequence,
    timestamp: Date.now(),
    payload: {
      type: 'error',
      code,
      message,
      recoverable,
    },
  };
}

export function isDataFrame(frame: Frame): frame is Frame & { payload: { type: 'data'; data: Uint8Array } } {
  return frame.payload.type === 'data';
}

export function isFloat32Frame(frame: Frame): frame is Frame & { payload: { type: 'float32'; data: Float32Array } } {
  return frame.payload.type === 'float32';
}

export function isControlFrame(frame: Frame): frame is Frame & { payload: { type: 'control'; message: ControlMessage } } {
  return frame.payload.type === 'control';
}

export function isErrorFrame(frame: Frame): frame is Frame & { payload: { type: 'error'; code: number; message: string; recoverable: boolean } } {
  return frame.payload.type === 'error';
}

export class FrameSerializer {
  private sequence = 0;
  private usePostcard: boolean;

  constructor(usePostcard = true) {
    this.usePostcard = usePostcard;
  }

  async serialize(payload: Payload): Promise<Uint8Array> {
    const frame: Frame = {
      sequence: this.sequence++,
      timestamp: Date.now(),
      payload,
    };

    if (this.usePostcard) {
      try {
        return await encodePostcard(frame);
      } catch {
        return encodeFrame(frame);
      }
    }

    return encodeFrame(frame);
  }

  async deserialize(bytes: Uint8Array): Promise<Frame> {
    if (this.usePostcard) {
      try {
        return await decodePostcard(bytes);
      } catch {
        return decodeFrame(bytes);
      }
    }

    return decodeFrame(bytes);
  }

  reset(): void {
    this.sequence = 0;
  }

  getSequence(): number {
    return this.sequence;
  }
}

export class ChunkedEncoder {
  private chunkSize: number;
  private serializer: FrameSerializer;

  constructor(chunkSize = 65536, usePostcard = true) {
    this.chunkSize = chunkSize;
    this.serializer = new FrameSerializer(usePostcard);
  }

  async* encodeStream(data: Uint8Array): AsyncGenerator<Uint8Array> {
    const totalChunks = Math.ceil(data.length / this.chunkSize);
    
    for (let i = 0; i < totalChunks; i++) {
      const start = i * this.chunkSize;
      const end = Math.min(start + this.chunkSize, data.length);
      const chunk = data.slice(start, end);
      
      const frame = await this.serializer.serialize({
        type: 'data',
        data: chunk,
      });
      
      yield frame;
    }
  }

  async* decodeStream(
    frames: AsyncIterable<Uint8Array>
  ): AsyncGenerator<Uint8Array> {
    const chunks: Uint8Array[] = [];
    
    for await (const frameBytes of frames) {
      const frame = await this.serializer.deserialize(frameBytes);
      
      if (isDataFrame(frame)) {
        chunks.push(frame.payload.data);
        
        if (chunks.length >= 10) {
          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const combined = new Uint8Array(totalLength);
          let offset = 0;
          
          for (const chunk of chunks) {
            combined.set(chunk, offset);
            offset += chunk.length;
          }
          
          yield combined;
          chunks.length = 0;
        }
      }
    }
    
    if (chunks.length > 0) {
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const combined = new Uint8Array(totalLength);
      let offset = 0;
      
      for (const chunk of chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      
      yield combined;
    }
  }
}

export function createCreditMessage(amount: number): ControlMessage {
  return { type: 'credit', amount };
}

export function createAckMessage(sequence: number): ControlMessage {
  return { type: 'ack', sequence };
}

export function createPauseMessage(): ControlMessage {
  return { type: 'pause' };
}

export function createResumeMessage(): ControlMessage {
  return { type: 'resume' };
}

export function createCompleteMessage(): ControlMessage {
  return { type: 'complete' };
}

export function createSubscribeMessage(streamId: string): ControlMessage {
  return { type: 'subscribe', streamId };
}

export function createUnsubscribeMessage(streamId: string): ControlMessage {
  return { type: 'unsubscribe', streamId };
}