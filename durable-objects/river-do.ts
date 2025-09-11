import { DurableObject, DurableObjectState, DurableObjectStorage } from '@cloudflare/workers-types';
import { River } from '../src/river';
import { 
  CreditController, 
  MultiStreamCreditManager,
  WindowedRateLimiter 
} from '../src/backpressure';
import {
  FrameSerializer,
  createControlFrame,
  createDataFrame,
  createErrorFrame,
  isControlFrame,
  isDataFrame,
} from '../src/serialization';
import type { Frame, DurableObjectState as DOState } from '../src/types';

interface QueueItem {
  requestId: string;
  payload: any;
  status: 'queued' | 'processing' | 'completed' | 'failed';
  createdAt: number;
  updatedAt: number;
  retries: number;
}

interface Subscriber {
  socket: WebSocket;
  credits: CreditController;
  streamId: string;
}

export class RiverDurableObject implements DurableObject {
  private state: DurableObjectState;
  private storage: DurableObjectStorage;
  private subscribers: Map<string, Subscriber> = new Map();
  private creditManager: MultiStreamCreditManager;
  private rateLimiter: WindowedRateLimiter;
  private serializer: FrameSerializer;
  private processingQueue: QueueItem[] = [];
  private env: any;

  constructor(state: DurableObjectState, env: any) {
    this.state = state;
    this.storage = state.storage;
    this.env = env;
    this.creditManager = new MultiStreamCreditManager(100);
    this.rateLimiter = new WindowedRateLimiter(60000, 1000);
    this.serializer = new FrameSerializer(true);
    
    this.state.blockConcurrencyWhile(async () => {
      await this.initialize();
    });
  }

  private async initialize(): Promise<void> {
    const storedQueue = await this.storage.get<QueueItem[]>('queue');
    if (storedQueue) {
      this.processingQueue = storedQueue;
    }
    
    const alarm = await this.storage.getAlarm();
    if (alarm === null) {
      await this.storage.setAlarm(Date.now() + 5000);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/ws') {
      return this.handleWebSocket(request);
    }

    switch (request.method) {
      case 'POST':
        if (path === '/enqueue') {
          return this.handleEnqueue(request);
        }
        break;
      case 'GET':
        if (path === '/status') {
          return this.handleStatus(request);
        }
        if (path.startsWith('/history')) {
          return this.handleHistory(request);
        }
        break;
    }

    return new Response('Not Found', { status: 404 });
  }

  private async handleWebSocket(request: Request): Promise<Response> {
    const upgradeHeader = request.headers.get('Upgrade');
    if (!upgradeHeader || upgradeHeader !== 'websocket') {
      return new Response('Expected Upgrade: websocket', { status: 426 });
    }

    const webSocketPair = new WebSocketPair();
    const [client, server] = Object.values(webSocketPair);

    const streamId = crypto.randomUUID();
    const credits = new CreditController(100);
    
    this.subscribers.set(streamId, {
      socket: server,
      credits,
      streamId,
    });
    
    this.creditManager.registerStream(streamId, 100);

    server.accept();
    
    server.addEventListener('message', async (event: MessageEvent) => {
      await this.handleWebSocketMessage(streamId, event);
    });

    server.addEventListener('close', () => {
      this.subscribers.delete(streamId);
      this.creditManager.unregisterStream(streamId);
    });

    server.addEventListener('error', (error) => {
      console.error('WebSocket error:', error);
      this.subscribers.delete(streamId);
      this.creditManager.unregisterStream(streamId);
    });

    this.state.acceptWebSocket(server);

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const streamId = this.findStreamId(ws);
    if (!streamId) return;

    if (message instanceof ArrayBuffer) {
      const bytes = new Uint8Array(message);
      const frame = await this.serializer.deserialize(bytes);
      
      if (isControlFrame(frame)) {
        await this.handleControlMessage(streamId, frame.payload.message);
      }
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const streamId = this.findStreamId(ws);
    if (streamId) {
      this.subscribers.delete(streamId);
      this.creditManager.unregisterStream(streamId);
    }
  }

  private findStreamId(ws: WebSocket): string | undefined {
    for (const [id, sub] of this.subscribers) {
      if (sub.socket === ws) {
        return id;
      }
    }
    return undefined;
  }

  private async handleWebSocketMessage(streamId: string, event: MessageEvent): Promise<void> {
    const subscriber = this.subscribers.get(streamId);
    if (!subscriber) return;

    if (event.data instanceof ArrayBuffer) {
      const bytes = new Uint8Array(event.data);
      const frame = await this.serializer.deserialize(bytes);
      
      if (isControlFrame(frame)) {
        await this.handleControlMessage(streamId, frame.payload.message);
      }
    }
  }

  private async handleControlMessage(streamId: string, message: any): Promise<void> {
    switch (message.type) {
      case 'credit':
        this.creditManager.addCredits(streamId, message.amount);
        break;
      case 'subscribe':
        break;
      case 'unsubscribe':
        this.subscribers.delete(streamId);
        this.creditManager.unregisterStream(streamId);
        break;
      case 'pause':
        break;
      case 'resume':
        await this.processQueue();
        break;
    }
  }

  private async handleEnqueue(request: Request): Promise<Response> {
    if (!this.rateLimiter.tryAcquire()) {
      return new Response('Rate limit exceeded', { status: 429 });
    }

    const body = await request.json();
    const requestId = crypto.randomUUID();
    
    const item: QueueItem = {
      requestId,
      payload: body,
      status: 'queued',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      retries: 0,
    };

    this.processingQueue.push(item);
    await this.storage.put('queue', this.processingQueue);
    
    await this.storage.setAlarm(Date.now() + 100);

    return Response.json({ requestId });
  }

  private async handleStatus(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const requestId = url.searchParams.get('requestId');

    if (requestId) {
      const item = this.processingQueue.find(i => i.requestId === requestId);
      if (item) {
        return Response.json({
          requestId: item.requestId,
          status: item.status,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt,
        });
      }
      return new Response('Request not found', { status: 404 });
    }

    return Response.json({
      queueLength: this.processingQueue.length,
      subscribers: this.subscribers.size,
      totalCredits: this.creditManager.totalAvailableCredits(),
    });
  }

  private async handleHistory(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const requestId = url.searchParams.get('requestId');
    const limit = parseInt(url.searchParams.get('limit') || '100');

    let items = this.processingQueue;
    
    if (requestId) {
      items = items.filter(i => i.requestId === requestId);
    }

    items = items.slice(0, limit);

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        for (const item of items) {
          const json = JSON.stringify(item) + '\n';
          controller.enqueue(encoder.encode(json));
        }
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Transfer-Encoding': 'chunked',
      },
    });
  }

  async alarm(): Promise<void> {
    await this.processQueue();
    
    if (this.processingQueue.length > 0) {
      await this.storage.setAlarm(Date.now() + 5000);
    }
  }

  private async processQueue(): Promise<void> {
    const toProcess = this.processingQueue
      .filter(item => item.status === 'queued')
      .slice(0, 10);

    for (const item of toProcess) {
      item.status = 'processing';
      item.updatedAt = Date.now();

      try {
        const result = await this.processItem(item);
        
        item.status = 'completed';
        item.updatedAt = Date.now();
        
        await this.broadcastResult(item.requestId, result);
      } catch (error: any) {
        item.retries++;
        
        if (item.retries >= 3) {
          item.status = 'failed';
        } else {
          item.status = 'queued';
        }
        
        item.updatedAt = Date.now();
        
        const errorFrame = createErrorFrame(
          500,
          error.message || 'Processing failed',
          item.retries < 3,
          0
        );
        
        await this.broadcastFrame(errorFrame);
      }
    }

    await this.storage.put('queue', this.processingQueue);
    
    this.processingQueue = this.processingQueue.filter(
      item => item.status !== 'completed' || 
      (Date.now() - item.updatedAt) < 3600000
    );
  }

  private async processItem(item: QueueItem): Promise<any> {
    await new Promise(resolve => setTimeout(resolve, 100));
    
    return {
      requestId: item.requestId,
      result: 'processed',
      timestamp: Date.now(),
    };
  }

  private async broadcastResult(requestId: string, result: any): Promise<void> {
    const data = new TextEncoder().encode(JSON.stringify(result));
    const frame = createDataFrame(data, 0);
    await this.broadcastFrame(frame);
  }

  private async broadcastFrame(frame: Frame): Promise<void> {
    const bytes = await this.serializer.serialize(frame.payload);
    
    for (const [streamId, subscriber] of this.subscribers) {
      if (this.creditManager.consume(streamId, 1)) {
        try {
          if (subscriber.socket.readyState === WebSocket.OPEN) {
            subscriber.socket.send(bytes);
          }
        } catch (error) {
          console.error(`Failed to send to ${streamId}:`, error);
        }
      }
    }
  }
}

export class RiverWorker {
  private env: any;

  constructor(env: any) {
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path.startsWith('/river/')) {
      const id = this.env.RIVER_DO.idFromName('main');
      const doUrl = new URL(request.url);
      doUrl.pathname = doUrl.pathname.replace('/river', '');
      
      const doRequest = new Request(doUrl, request);
      return await this.env.RIVER_DO.get(id).fetch(doRequest);
    }

    return new Response('Nagare River Worker', {
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const worker = new RiverWorker(env);
    return worker.fetch(request);
  },
};