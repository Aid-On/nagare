import { ensureWasmLoaded, wasmModule } from './wasm-loader';

export class CreditController {
  private credits: number;
  private readonly initialCredits: number;
  private wasmController?: any;

  constructor(initialCredits: number) {
    this.initialCredits = initialCredits;
    this.credits = initialCredits;
    this.initWasm();
  }

  private async initWasm(): Promise<void> {
    try {
      await ensureWasmLoaded();
      if (wasmModule) {
        this.wasmController = new wasmModule.CreditController(this.initialCredits);
      }
    } catch (error) {
      console.warn('WASM credit controller not available, using JS fallback');
    }
  }

  consumeCredit(amount: number): boolean {
    if (this.wasmController) {
      return this.wasmController.consumeCredit(amount);
    }

    if (this.credits >= amount) {
      this.credits -= amount;
      return true;
    }
    return false;
  }

  addCredits(amount: number): void {
    if (this.wasmController) {
      this.wasmController.addCredits(amount);
    } else {
      this.credits = Math.min(this.credits + amount, Number.MAX_SAFE_INTEGER);
    }
  }

  availableCredits(): number {
    if (this.wasmController) {
      return this.wasmController.availableCredits();
    }
    return this.credits;
  }

  reset(): void {
    this.credits = this.initialCredits;
    if (this.wasmController) {
      this.wasmController = new wasmModule.CreditController(this.initialCredits);
    }
  }

  isExhausted(): boolean {
    return this.availableCredits() === 0;
  }

  hasCredits(): boolean {
    return this.availableCredits() > 0;
  }
}

export class MultiStreamCreditManager {
  private streams: Map<string, CreditController> = new Map();
  private defaultCredits: number;

  constructor(defaultCredits: number) {
    this.defaultCredits = defaultCredits;
  }

  registerStream(streamId: string, initialCredits?: number): void {
    const credits = initialCredits ?? this.defaultCredits;
    this.streams.set(streamId, new CreditController(credits));
  }

  unregisterStream(streamId: string): void {
    this.streams.delete(streamId);
  }

  consume(streamId: string, amount: number): boolean {
    const controller = this.streams.get(streamId);
    if (controller) {
      return controller.consumeCredit(amount);
    }
    return false;
  }

  addCredits(streamId: string, amount: number): void {
    const controller = this.streams.get(streamId);
    if (controller) {
      controller.addCredits(amount);
    }
  }

  availableCredits(streamId: string): number | undefined {
    const controller = this.streams.get(streamId);
    return controller?.availableCredits();
  }

  isStreamExhausted(streamId: string): boolean {
    const controller = this.streams.get(streamId);
    return controller?.isExhausted() ?? true;
  }

  activeStreams(): string[] {
    return Array.from(this.streams.keys());
  }

  totalAvailableCredits(): number {
    let total = 0;
    for (const controller of this.streams.values()) {
      total += controller.availableCredits();
    }
    return total;
  }
}

export class AdaptiveBackpressure {
  private currentRate: number;
  private targetLatencyMs: number;
  private minRate: number;
  private maxRate: number;
  private alpha: number;

  constructor(
    initialRate: number,
    targetLatencyMs: number,
    minRate: number,
    maxRate: number
  ) {
    this.currentRate = initialRate;
    this.targetLatencyMs = targetLatencyMs;
    this.minRate = minRate;
    this.maxRate = maxRate;
    this.alpha = 0.2;
  }

  update(observedLatencyMs: number): void {
    const error = this.targetLatencyMs - observedLatencyMs;
    const adjustment = (this.alpha * error) / this.targetLatencyMs;
    
    const newRate = this.currentRate * (1 + adjustment);
    this.currentRate = Math.max(this.minRate, Math.min(this.maxRate, newRate));
  }

  getRate(): number {
    return this.currentRate;
  }

  getDelayMs(): number {
    if (this.currentRate > 0) {
      return Math.floor(1000 / this.currentRate);
    }
    return Number.MAX_SAFE_INTEGER;
  }

  shouldThrottle(currentThroughput: number): boolean {
    return currentThroughput > this.currentRate;
  }

  setAlpha(alpha: number): void {
    this.alpha = Math.max(0, Math.min(1, alpha));
  }
}

export class WindowedRateLimiter {
  private windowSizeMs: number;
  private maxEvents: number;
  private events: number[] = [];

  constructor(windowSizeMs: number, maxEvents: number) {
    this.windowSizeMs = windowSizeMs;
    this.maxEvents = maxEvents;
  }

  tryAcquire(timestampMs?: number): boolean {
    const now = timestampMs ?? Date.now();
    const cutoff = now - this.windowSizeMs;
    
    this.events = this.events.filter(t => t > cutoff);
    
    if (this.events.length < this.maxEvents) {
      this.events.push(now);
      return true;
    }
    
    return false;
  }

  currentRate(timestampMs?: number): number {
    const now = timestampMs ?? Date.now();
    const cutoff = now - this.windowSizeMs;
    const recentEvents = this.events.filter(t => t > cutoff).length;
    
    return (recentEvents * 1000) / this.windowSizeMs;
  }

  reset(): void {
    this.events = [];
  }

  availableSlots(): number {
    const now = Date.now();
    const cutoff = now - this.windowSizeMs;
    const recentEvents = this.events.filter(t => t > cutoff).length;
    return Math.max(0, this.maxEvents - recentEvents);
  }
}

export interface BackpressureStrategy {
  shouldAccept(metrics: BackpressureMetrics): boolean;
  onAccept(metrics: BackpressureMetrics): void;
  onReject(metrics: BackpressureMetrics): void;
}

export interface BackpressureMetrics {
  queueSize: number;
  processingRate: number;
  inputRate: number;
  latencyMs: number;
  memoryUsage: number;
}

export class DynamicBackpressure implements BackpressureStrategy {
  private maxQueueSize: number;
  private targetLatencyMs: number;
  private adaptive: AdaptiveBackpressure;

  constructor(maxQueueSize: number, targetLatencyMs: number) {
    this.maxQueueSize = maxQueueSize;
    this.targetLatencyMs = targetLatencyMs;
    this.adaptive = new AdaptiveBackpressure(100, targetLatencyMs, 10, 1000);
  }

  shouldAccept(metrics: BackpressureMetrics): boolean {
    if (metrics.queueSize >= this.maxQueueSize) {
      return false;
    }

    if (metrics.latencyMs > this.targetLatencyMs * 2) {
      return false;
    }

    return !this.adaptive.shouldThrottle(metrics.inputRate);
  }

  onAccept(metrics: BackpressureMetrics): void {
    this.adaptive.update(metrics.latencyMs);
  }

  onReject(metrics: BackpressureMetrics): void {
    this.adaptive.update(metrics.latencyMs);
  }
}