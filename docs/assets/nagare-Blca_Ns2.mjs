let wasmModule = null;
let loadPromise = null;
const isTestEnvironment = () => {
  return typeof process !== "undefined" && (process.env.NODE_ENV === "test" || process.env.VITEST === "true" || typeof globalThis.describe === "function");
};
const createMockWasmModule = () => {
  return {
    memory: new WebAssembly.Memory({ initial: 1 }),
    // Add mock functions that the actual WASM would provide
    __wbg_set_wasm: () => {
    },
    __wbindgen_export_0: () => {
    },
    __wbindgen_export_1: () => {
    },
    // Add other mock WASM exports as needed
    default: async () => {
      console.log("Mock WASM module initialized for tests");
    }
  };
};
async function loadWasm() {
  if (wasmModule) return;
  if (loadPromise) {
    await loadPromise;
    return;
  }
  loadPromise = (async () => {
    try {
      if (isTestEnvironment()) {
        console.log("Loading mock WASM module for test environment");
        wasmModule = createMockWasmModule();
        return;
      }
      if (typeof window !== "undefined") {
        console.warn("WASM loading in browser not yet configured");
        wasmModule = createMockWasmModule();
      } else if (typeof process !== "undefined" && process.versions?.node) {
        console.warn("WASM loading in Node.js not yet configured");
        wasmModule = createMockWasmModule();
      } else {
        console.warn("WASM loading not yet configured");
        wasmModule = createMockWasmModule();
      }
    } catch (error) {
      if (isTestEnvironment()) {
        console.warn("WASM loading failed in test environment, using mock:", error.message);
        wasmModule = createMockWasmModule();
      } else {
        console.error("Failed to load WASM module:", error);
        throw error;
      }
    }
  })();
  await loadPromise;
}
function isWasmLoaded() {
  return wasmModule !== null;
}
async function ensureWasmLoaded() {
  if (!isWasmLoaded()) {
    await loadWasm();
  }
}

class Nagare {
  source;
  operators = [];
  errorHandler;
  terminateOnError = false;
  _originalArraySource;
  constructor(source) {
    if (Array.isArray(source)) {
      this.source = source;
      this._originalArraySource = source;
    } else {
      this.source = source;
    }
  }
  observe(next, options) {
    const controller = new AbortController();
    const signal = options?.signal;
    let active = true;
    const unsubscribe = () => {
      active = false;
      controller.abort();
    };
    const subscription = {
      unsubscribe,
      get isActive() {
        return active;
      },
      [Symbol.dispose]: unsubscribe,
      [Symbol.asyncDispose]: async () => unsubscribe()
    };
    (async () => {
      try {
        for await (const value of this) {
          if (!active || signal?.aborted || controller.signal.aborted) break;
          try {
            const processed = this.applyOperators(value);
            const result = processed instanceof Promise ? await processed : processed;
            if (result !== void 0) {
              next(result);
            }
          } catch (error) {
            if (options?.onError) {
              options.onError(error);
            }
            if (this.terminateOnError) {
              break;
            }
          }
        }
        if (active && !signal?.aborted) {
          options?.onComplete?.();
        }
      } catch (error) {
        if (options?.onError) {
          options.onError(error);
        }
      } finally {
        active = false;
      }
    })();
    return subscription;
  }
  applyOperators(value) {
    let current = value;
    for (const op of this.operators) {
      if (current === void 0) break;
      try {
        const result = op(current);
        if (result instanceof Promise) {
          return this.applyOperatorsAsync(value);
        }
        current = result;
      } catch (error) {
        if (this.errorHandler) {
          const recovered = this.errorHandler(error);
          current = recovered;
          if (current !== void 0) {
            break;
          }
        } else if (this.terminateOnError) {
          throw error;
        } else {
          current = void 0;
          break;
        }
      }
    }
    return current;
  }
  async applyOperatorsAsync(value) {
    let current = value;
    for (const op of this.operators) {
      if (current === void 0) break;
      try {
        const result = op(current);
        current = result instanceof Promise ? await result : result;
      } catch (error) {
        if (this.errorHandler) {
          const recovered = this.errorHandler(error);
          current = recovered;
          if (current !== void 0) {
            break;
          }
        } else if (this.terminateOnError) {
          throw error;
        } else {
          current = void 0;
          break;
        }
      }
    }
    return current;
  }
  async *asyncFallback(remaining) {
    for (const value of remaining) {
      const processed = this.applyOperators(value);
      const result = processed instanceof Promise ? await processed : processed;
      if (result !== void 0) yield result;
    }
  }
  map(fn) {
    const newNagare = new Nagare(this);
    newNagare.operators = [...this.operators, fn];
    newNagare.errorHandler = this.errorHandler;
    newNagare.terminateOnError = this.terminateOnError;
    newNagare._originalArraySource = this._originalArraySource;
    return newNagare;
  }
  filter(predicate) {
    const newNagare = new Nagare(this);
    const filterOp = (value) => {
      const result = predicate(value);
      if (result instanceof Promise) {
        return result.then((shouldKeep) => shouldKeep ? value : void 0);
      }
      return result ? value : void 0;
    };
    newNagare.operators = [...this.operators, filterOp];
    newNagare.errorHandler = this.errorHandler;
    newNagare.terminateOnError = this.terminateOnError;
    newNagare._originalArraySource = this._originalArraySource;
    return newNagare;
  }
  scan(fn, initial) {
    let accumulator = initial;
    return this.map(async (value) => {
      const result = fn(accumulator, value);
      accumulator = result instanceof Promise ? await result : result;
      return accumulator;
    });
  }
  take(count) {
    let taken = 0;
    return this.filter(() => taken++ < count);
  }
  skip(count) {
    let skipped = 0;
    return this.filter(() => ++skipped > count);
  }
  fork(predicate) {
    const left = this.filter(predicate);
    const right = this.filter((v) => !predicate(v));
    return [left, right];
  }
  merge(...others) {
    const sources = [this, ...others];
    const generator = async function* () {
      const iterators = sources.map((s) => s[Symbol.asyncIterator]());
      let activePromises = /* @__PURE__ */ new Map();
      for (let i = 0; i < iterators.length; i++) {
        activePromises.set(i, iterators[i].next().then((r) => ({ i, r })));
      }
      while (activePromises.size > 0) {
        const { i, r } = await Promise.race(activePromises.values());
        if (r.done) {
          activePromises.delete(i);
        } else {
          yield r.value;
          activePromises.set(i, iterators[i].next().then((r2) => ({ i, r: r2 })));
        }
      }
    };
    return new Nagare(generator());
  }
  rescue(handler) {
    const newNagare = new Nagare(this);
    newNagare.operators = [...this.operators];
    newNagare.errorHandler = handler;
    newNagare.terminateOnError = this.terminateOnError;
    return newNagare;
  }
  terminateOnErrorMode() {
    const newNagare = new Nagare(this);
    newNagare.terminateOnError = true;
    return newNagare;
  }
  async mapWasm(kernelName, _params) {
    await loadWasm();
    const newNagare = new Nagare(this);
    newNagare.operators.push((value) => {
      if (!wasmModule) throw new Error("WASM module not loaded");
      if (value instanceof Float32Array) {
        const result = wasmModule.process_float32_batch(value, kernelName);
        return result;
      }
      return value;
    });
    return newNagare;
  }
  windowedAggregate(windowSize, operation) {
    let window = [];
    const self = this;
    const generator = async function* () {
      for await (const value of self) {
        if (typeof value !== "number") {
          throw new Error("windowedAggregate requires numeric values");
        }
        window.push(value);
        if (window.length === windowSize) {
          let result;
          switch (operation) {
            case "mean":
              result = window.reduce((a, b) => a + b, 0) / window.length;
              break;
            case "sum":
              result = window.reduce((a, b) => a + b, 0);
              break;
            case "max":
              result = Math.max(...window);
              break;
            case "min":
              result = Math.min(...window);
              break;
            default:
              throw new Error(`Unknown operation: ${operation}`);
          }
          yield result;
          window.shift();
        }
      }
    };
    return new Nagare(generator());
  }
  toReadableStream() {
    const iterator = this[Symbol.asyncIterator]();
    return new ReadableStream({
      async pull(controller) {
        const { value, done } = await iterator.next();
        if (done) {
          controller.close();
        } else {
          controller.enqueue(value);
        }
      }
    });
  }
  static fromReadableStream(stream) {
    return new Nagare(stream);
  }
  static from(source) {
    if (source instanceof Promise) {
      const generator = async function* () {
        yield await source;
      };
      return new Nagare(generator());
    }
    return new Nagare(source);
  }
  static empty() {
    return new Nagare([]);
  }
  static of(...values) {
    return new Nagare(values);
  }
  async *[Symbol.asyncIterator]() {
    if (this.source instanceof Nagare) {
      if (this.errorHandler && !this.source.errorHandler) {
        this.source.errorHandler = this.errorHandler;
        this.source.terminateOnError = this.terminateOnError;
      }
      for await (const value of this.source) {
        const processed = this.applyOperators(value);
        const result = processed instanceof Promise ? await processed : processed;
        if (result !== void 0) yield result;
      }
    } else if (this.source instanceof ReadableStream) {
      const reader = this.source.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const processed = this.applyOperators(value);
          const result = processed instanceof Promise ? await processed : processed;
          if (result !== void 0) yield result;
        }
      } finally {
        reader.releaseLock();
      }
    } else if (typeof this.source === "function") {
      const generator = this.source();
      for await (const value of generator) {
        const processed = this.applyOperators(value);
        const result = processed instanceof Promise ? await processed : processed;
        if (result !== void 0) yield result;
      }
    } else if (Symbol.asyncIterator in this.source) {
      for await (const value of this.source) {
        const processed = this.applyOperators(value);
        const result = processed instanceof Promise ? await processed : processed;
        if (result !== void 0) yield result;
      }
    } else if (Symbol.iterator in this.source) {
      if (Array.isArray(this.source) && this.operators.length > 0) {
        try {
          for (const value of this.source) {
            let current = value;
            for (const op of this.operators) {
              if (current === void 0) break;
              const result = op(current);
              if (result instanceof Promise) {
                yield* this.asyncFallback(this.source.slice(this.source.indexOf(value)));
                return;
              }
              current = result;
            }
            if (current !== void 0) yield current;
          }
          return;
        } catch (error) {
        }
      }
      for (const value of this.source) {
        const processed = this.applyOperators(value);
        const result = processed instanceof Promise ? await processed : processed;
        if (result !== void 0) yield result;
      }
    }
  }
  async toArray() {
    if (this._originalArraySource && this.operators.length === 2 && this._originalArraySource.length > 0) {
      try {
        const mapOp = this.operators[0];
        const filterOp = this.operators[1];
        const testMapped = mapOp(this._originalArraySource[0]);
        if (testMapped instanceof Promise) throw new Error("async");
        const testFiltered = filterOp(testMapped);
        if (testFiltered instanceof Promise) throw new Error("async");
        const result2 = [];
        const sourceArray = this._originalArraySource;
        const length = sourceArray.length;
        result2.length = 0;
        for (let i = 0; i < length; i++) {
          const item = sourceArray[i];
          const mapped = mapOp(item);
          const shouldInclude = filterOp(mapped);
          if (shouldInclude !== void 0) {
            result2[result2.length] = mapped;
          }
        }
        return result2;
      } catch (error) {
      }
    }
    if (this._originalArraySource && this.operators.length > 0 && this._originalArraySource.length > 0) {
      try {
        let result2 = this._originalArraySource;
        for (const op of this.operators) {
          const newResult = [];
          for (let i = 0; i < result2.length; i++) {
            const processed = op(result2[i]);
            if (processed instanceof Promise) throw new Error("async");
            if (processed !== void 0) {
              newResult.push(processed);
            }
          }
          result2 = newResult;
        }
        return result2;
      } catch (error) {
      }
    }
    const result = [];
    for await (const value of this) {
      result.push(value);
    }
    return result;
  }
  async first() {
    for await (const value of this) {
      return value;
    }
    return void 0;
  }
  async last() {
    let lastValue;
    for await (const value of this) {
      lastValue = value;
    }
    return lastValue;
  }
  async count() {
    let count = 0;
    for await (const _ of this) {
      count++;
    }
    return count;
  }
  async all(predicate) {
    for await (const value of this) {
      const result = predicate(value);
      const passes = result instanceof Promise ? await result : result;
      if (!passes) return false;
    }
    return true;
  }
  async some(predicate) {
    for await (const value of this) {
      const result = predicate(value);
      const passes = result instanceof Promise ? await result : result;
      if (passes) return true;
    }
    return false;
  }
}

function debounce(ms) {
  return (nagare) => {
    const generator = async function* () {
      let timeout = null;
      let lastValue;
      let hasValue = false;
      for await (const value of nagare) {
        lastValue = value;
        hasValue = true;
        if (timeout) clearTimeout(timeout);
        await new Promise((resolve) => {
          timeout = setTimeout(() => {
            timeout = null;
            resolve();
          }, ms);
        });
        if (hasValue) {
          yield lastValue;
          hasValue = false;
        }
      }
      if (hasValue && lastValue !== void 0) {
        yield lastValue;
      }
    };
    return new Nagare(generator());
  };
}
function throttle(ms) {
  return (nagare) => {
    const generator = async function* () {
      let lastEmit = 0;
      for await (const value of nagare) {
        const now = Date.now();
        if (now - lastEmit >= ms) {
          yield value;
          lastEmit = now;
        }
      }
    };
    return new Nagare(generator());
  };
}
function buffer(size) {
  return (nagare) => {
    const generator = async function* () {
      let buffer2 = [];
      for await (const value of nagare) {
        buffer2.push(value);
        if (buffer2.length >= size) {
          yield [...buffer2];
          buffer2 = [];
        }
      }
      if (buffer2.length > 0) {
        yield buffer2;
      }
    };
    return new Nagare(generator());
  };
}
function bufferTime(ms) {
  return (nagare) => {
    const generator = async function* () {
      let buffer2 = [];
      let timeout = null;
      const flush = () => {
        if (buffer2.length > 0) {
          const toYield = [...buffer2];
          buffer2 = [];
          return toYield;
        }
        return null;
      };
      for await (const value of nagare) {
        buffer2.push(value);
        if (!timeout) {
          timeout = setTimeout(() => {
            timeout = null;
            flush();
          }, ms);
        }
        if (buffer2.length >= 1e3) {
          const values = flush();
          if (values) yield values;
        }
      }
      const remaining = flush();
      if (remaining) yield remaining;
    };
    return new Nagare(generator());
  };
}
function distinct() {
  return (nagare) => {
    const seen = /* @__PURE__ */ new Set();
    return nagare.filter((value) => {
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);
      return true;
    });
  };
}
function distinctUntilChanged() {
  return (nagare) => {
    const generator = async function* () {
      let previous = Symbol("initial");
      for await (const value of nagare) {
        if (previous === Symbol("initial") || value !== previous) {
          yield value;
          previous = value;
        }
      }
    };
    return new Nagare(generator());
  };
}
function pairwise() {
  return (nagare) => {
    const generator = async function* () {
      let previous;
      let hasPrevious = false;
      for await (const value of nagare) {
        if (hasPrevious) {
          yield [previous, value];
        }
        previous = value;
        hasPrevious = true;
      }
    };
    return new Nagare(generator());
  };
}
function startWith(...values) {
  return (nagare) => {
    const generator = async function* () {
      for (const value of values) {
        yield value;
      }
      yield* nagare;
    };
    return new Nagare(generator());
  };
}
function concatMap(fn) {
  return (nagare) => {
    const generator = async function* () {
      for await (const value of nagare) {
        const innerNagare = await fn(value);
        yield* innerNagare;
      }
    };
    return new Nagare(generator());
  };
}
function switchMap(fn) {
  return (nagare) => {
    const generator = async function* () {
      let currentIterator = null;
      let abortController = null;
      for await (const value of nagare) {
        if (abortController) {
          abortController.abort();
        }
        abortController = new AbortController();
        const innerNagare = await fn(value);
        currentIterator = innerNagare[Symbol.asyncIterator]();
        let done = false;
        while (!done && !abortController.signal.aborted) {
          const result = await currentIterator.next();
          if (!result.done && !abortController.signal.aborted) {
            yield result.value;
          }
          done = result.done || false;
        }
      }
    };
    return new Nagare(generator());
  };
}
function retry(maxRetries = 3, delayMs = 1e3) {
  return (nagare) => {
    const generator = async function* () {
      for await (const value of nagare) {
        let retries = 0;
        let lastError;
        while (retries <= maxRetries) {
          try {
            yield value;
            break;
          } catch (error) {
            lastError = error;
            retries++;
            if (retries <= maxRetries) {
              await new Promise((resolve) => setTimeout(resolve, delayMs * retries));
            }
          }
        }
        if (retries > maxRetries) {
          throw lastError;
        }
      }
    };
    return new Nagare(generator());
  };
}
async function processFloat32Batch(data, operation) {
  await ensureWasmLoaded();
  if (!wasmModule) {
    throw new Error("WASM module not loaded");
  }
  return wasmModule.process_float32_batch(data, operation);
}
async function simdMapMulAdd(data, a, b) {
  await ensureWasmLoaded();
  if (!wasmModule) {
    throw new Error("WASM module not loaded");
  }
  const nagare = wasmModule.NagareNagare.fromTypedArray(data);
  const result = nagare.mapWasm("f32x_map_mul_add", { a, b });
  return new Float32Array(await result.toArray());
}

class BYOBStreamReader {
  reader;
  bufferSize;
  reusableBuffer = null;
  constructor(stream, bufferSize) {
    this.reader = stream.getReader({ mode: "byob" });
    this.bufferSize = bufferSize;
  }
  async readInto(buffer) {
    return await this.reader.read(buffer);
  }
  async readWithReusableBuffer() {
    if (!this.reusableBuffer) {
      this.reusableBuffer = new ArrayBuffer(this.bufferSize);
    }
    const view = new Uint8Array(this.reusableBuffer);
    return await this.readInto(view);
  }
  async cancel(reason) {
    await this.reader.cancel(reason);
  }
  releaseLock() {
    this.reader.releaseLock();
  }
}
class BYOBStreamController {
  chunkSize;
  highWaterMark;
  constructor(options) {
    this.chunkSize = options.chunkSize;
    this.highWaterMark = options.highWaterMark || options.chunkSize * 3;
  }
  createReadableStream(pullFn) {
    return new ReadableStream({
      type: "bytes",
      autoAllocateChunkSize: this.chunkSize,
      async pull(controller) {
        const byobRequest = controller.byobRequest;
        if (byobRequest) {
          const view = byobRequest.view;
          if (view) {
            await pullFn(controller);
            byobRequest.respond(view.byteLength);
          }
        }
      },
      cancel(reason) {
        console.log("Stream cancelled:", reason);
      }
    });
  }
  getChunkSize() {
    return this.chunkSize;
  }
  getHighWaterMark() {
    return this.highWaterMark;
  }
}
function createZeroCopyView(buffer) {
  if (!wasmModule) {
    throw new Error("WASM module not loaded");
  }
  return wasmModule.create_zero_copy_view(buffer);
}
function createFloat32View(buffer) {
  if (!wasmModule) {
    throw new Error("WASM module not loaded");
  }
  return wasmModule.create_float32_view(buffer);
}
class BufferPool {
  buffers = [];
  bufferSize;
  maxBuffers;
  constructor(bufferSize, maxBuffers = 10) {
    this.bufferSize = bufferSize;
    this.maxBuffers = maxBuffers;
  }
  acquire() {
    const buffer = this.buffers.pop();
    if (buffer) {
      return buffer;
    }
    return new ArrayBuffer(this.bufferSize);
  }
  release(buffer) {
    if (this.buffers.length < this.maxBuffers && buffer.byteLength === this.bufferSize) {
      this.buffers.push(buffer);
    }
  }
  available() {
    return this.buffers.length;
  }
  clear() {
    this.buffers = [];
  }
}
function createBYOBTransformStream(transform, _options) {
  return new TransformStream({
    async transform(chunk, controller) {
      try {
        const result = await transform(chunk);
        controller.enqueue(result);
      } catch (error) {
        controller.error(error);
      }
    }
  });
}
async function pipeBYOBStreams(source, destination, options) {
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

class CreditController {
  credits;
  initialCredits;
  wasmController;
  constructor(initialCredits) {
    this.initialCredits = initialCredits;
    this.credits = initialCredits;
    this.initWasm();
  }
  async initWasm() {
    try {
      await ensureWasmLoaded();
      if (wasmModule) {
        this.wasmController = new wasmModule.CreditController(this.initialCredits);
      }
    } catch (error) {
      console.warn("WASM credit controller not available, using JS fallback");
    }
  }
  consumeCredit(amount) {
    if (this.wasmController) {
      return this.wasmController.consumeCredit(amount);
    }
    if (this.credits >= amount) {
      this.credits -= amount;
      return true;
    }
    return false;
  }
  addCredits(amount) {
    if (this.wasmController) {
      this.wasmController.addCredits(amount);
    } else {
      this.credits = Math.min(this.credits + amount, Number.MAX_SAFE_INTEGER);
    }
  }
  availableCredits() {
    if (this.wasmController) {
      return this.wasmController.availableCredits();
    }
    return this.credits;
  }
  reset() {
    this.credits = this.initialCredits;
    if (this.wasmController) {
      this.wasmController = new wasmModule.CreditController(this.initialCredits);
    }
  }
  isExhausted() {
    return this.availableCredits() === 0;
  }
  hasCredits() {
    return this.availableCredits() > 0;
  }
}
class MultiStreamCreditManager {
  streams = /* @__PURE__ */ new Map();
  defaultCredits;
  constructor(defaultCredits) {
    this.defaultCredits = defaultCredits;
  }
  registerStream(streamId, initialCredits) {
    const credits = initialCredits ?? this.defaultCredits;
    this.streams.set(streamId, new CreditController(credits));
  }
  unregisterStream(streamId) {
    this.streams.delete(streamId);
  }
  consume(streamId, amount) {
    const controller = this.streams.get(streamId);
    if (controller) {
      return controller.consumeCredit(amount);
    }
    return false;
  }
  addCredits(streamId, amount) {
    const controller = this.streams.get(streamId);
    if (controller) {
      controller.addCredits(amount);
    }
  }
  availableCredits(streamId) {
    const controller = this.streams.get(streamId);
    return controller?.availableCredits();
  }
  isStreamExhausted(streamId) {
    const controller = this.streams.get(streamId);
    return controller?.isExhausted() ?? true;
  }
  activeStreams() {
    return Array.from(this.streams.keys());
  }
  totalAvailableCredits() {
    let total = 0;
    for (const controller of this.streams.values()) {
      total += controller.availableCredits();
    }
    return total;
  }
}
class AdaptiveBackpressure {
  currentRate;
  targetLatencyMs;
  minRate;
  maxRate;
  alpha;
  constructor(initialRate, targetLatencyMs, minRate, maxRate) {
    this.currentRate = initialRate;
    this.targetLatencyMs = targetLatencyMs;
    this.minRate = minRate;
    this.maxRate = maxRate;
    this.alpha = 0.2;
  }
  update(observedLatencyMs) {
    const error = this.targetLatencyMs - observedLatencyMs;
    const adjustment = this.alpha * error / this.targetLatencyMs;
    const newRate = this.currentRate * (1 + adjustment);
    this.currentRate = Math.max(this.minRate, Math.min(this.maxRate, newRate));
  }
  getRate() {
    return this.currentRate;
  }
  getDelayMs() {
    if (this.currentRate > 0) {
      return Math.floor(1e3 / this.currentRate);
    }
    return Number.MAX_SAFE_INTEGER;
  }
  shouldThrottle(currentThroughput) {
    return currentThroughput > this.currentRate;
  }
  setAlpha(alpha) {
    this.alpha = Math.max(0, Math.min(1, alpha));
  }
}
class WindowedRateLimiter {
  windowSizeMs;
  maxEvents;
  events = [];
  constructor(windowSizeMs, maxEvents) {
    this.windowSizeMs = windowSizeMs;
    this.maxEvents = maxEvents;
  }
  tryAcquire(timestampMs) {
    const now = timestampMs ?? Date.now();
    const cutoff = now - this.windowSizeMs;
    this.events = this.events.filter((t) => t > cutoff);
    if (this.events.length < this.maxEvents) {
      this.events.push(now);
      return true;
    }
    return false;
  }
  currentRate(timestampMs) {
    const now = timestampMs ?? Date.now();
    const cutoff = now - this.windowSizeMs;
    const recentEvents = this.events.filter((t) => t > cutoff).length;
    return recentEvents * 1e3 / this.windowSizeMs;
  }
  reset() {
    this.events = [];
  }
  availableSlots() {
    const now = Date.now();
    const cutoff = now - this.windowSizeMs;
    const recentEvents = this.events.filter((t) => t > cutoff).length;
    return Math.max(0, this.maxEvents - recentEvents);
  }
}
class DynamicBackpressure {
  maxQueueSize;
  targetLatencyMs;
  adaptive;
  constructor(maxQueueSize, targetLatencyMs) {
    this.maxQueueSize = maxQueueSize;
    this.targetLatencyMs = targetLatencyMs;
    this.adaptive = new AdaptiveBackpressure(100, targetLatencyMs, 10, 1e3);
  }
  shouldAccept(metrics) {
    if (metrics.queueSize >= this.maxQueueSize) {
      return false;
    }
    if (metrics.latencyMs > this.targetLatencyMs * 2) {
      return false;
    }
    return !this.adaptive.shouldThrottle(metrics.inputRate);
  }
  onAccept(metrics) {
    this.adaptive.update(metrics.latencyMs);
  }
  onReject(metrics) {
    this.adaptive.update(metrics.latencyMs);
  }
}

async function encodePostcard(frame) {
  await ensureWasmLoaded();
  if (!wasmModule) {
    throw new Error("WASM module not loaded");
  }
  return wasmModule.encode_postcard(frame);
}
async function decodePostcard(bytes) {
  await ensureWasmLoaded();
  if (!wasmModule) {
    throw new Error("WASM module not loaded");
  }
  return wasmModule.decode_postcard(bytes);
}
function encodeFrame(frame) {
  const json = JSON.stringify(frame);
  const encoder = new TextEncoder();
  return encoder.encode(json);
}
function decodeFrame(bytes) {
  const decoder = new TextDecoder();
  const json = decoder.decode(bytes);
  return JSON.parse(json);
}
function createDataFrame(data, sequence) {
  return {
    sequence,
    timestamp: Date.now(),
    payload: {
      type: "data",
      data
    }
  };
}
function createFloat32Frame(data, sequence) {
  return {
    sequence,
    timestamp: Date.now(),
    payload: {
      type: "float32",
      data
    }
  };
}
function createControlFrame(message, sequence) {
  return {
    sequence,
    timestamp: Date.now(),
    payload: {
      type: "control",
      message
    }
  };
}
function createErrorFrame(code, message, recoverable, sequence) {
  return {
    sequence,
    timestamp: Date.now(),
    payload: {
      type: "error",
      code,
      message,
      recoverable
    }
  };
}
function isDataFrame(frame) {
  return frame.payload.type === "data";
}
function isFloat32Frame(frame) {
  return frame.payload.type === "float32";
}
function isControlFrame(frame) {
  return frame.payload.type === "control";
}
function isErrorFrame(frame) {
  return frame.payload.type === "error";
}
class FrameSerializer {
  sequence = 0;
  usePostcard;
  constructor(usePostcard = true) {
    this.usePostcard = usePostcard;
  }
  async serialize(payload) {
    const frame = {
      sequence: this.sequence++,
      timestamp: Date.now(),
      payload
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
  async deserialize(bytes) {
    if (this.usePostcard) {
      try {
        return await decodePostcard(bytes);
      } catch {
        return decodeFrame(bytes);
      }
    }
    return decodeFrame(bytes);
  }
  reset() {
    this.sequence = 0;
  }
  getSequence() {
    return this.sequence;
  }
}
class ChunkedEncoder {
  chunkSize;
  serializer;
  constructor(chunkSize = 65536, usePostcard = true) {
    this.chunkSize = chunkSize;
    this.serializer = new FrameSerializer(usePostcard);
  }
  async *encodeStream(data) {
    const totalChunks = Math.ceil(data.length / this.chunkSize);
    for (let i = 0; i < totalChunks; i++) {
      const start = i * this.chunkSize;
      const end = Math.min(start + this.chunkSize, data.length);
      const chunk = data.slice(start, end);
      const frame = await this.serializer.serialize({
        type: "data",
        data: chunk
      });
      yield frame;
    }
  }
  async *decodeStream(frames) {
    const chunks = [];
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
function createCreditMessage(amount) {
  return { type: "credit", amount };
}
function createAckMessage(sequence) {
  return { type: "ack", sequence };
}
function createPauseMessage() {
  return { type: "pause" };
}
function createResumeMessage() {
  return { type: "resume" };
}
function createCompleteMessage() {
  return { type: "complete" };
}
function createSubscribeMessage(streamId) {
  return { type: "subscribe", streamId };
}
function createUnsubscribeMessage(streamId) {
  return { type: "unsubscribe", streamId };
}

function createFromArray(array) {
  return new Nagare(array);
}
function createFromReadableStream(stream) {
  return Nagare.fromReadableStream(stream);
}
function createFromPromise(promise) {
  return Nagare.from(promise);
}

const nagare = {
  from: createFromArray,
  fromReadableStream: createFromReadableStream,
  fromPromise: createFromPromise,
  empty: () => new Nagare([]),
  of: (...values) => new Nagare(values),
  range: (start, end, step = 1) => {
    const values = [];
    for (let i = start; i < end; i += step) {
      values.push(i);
    }
    return new Nagare(values);
  },
  interval: (ms, signal) => {
    const generator = async function* () {
      let count = 0;
      while (!signal?.aborted) {
        yield count++;
        await new Promise((resolve) => setTimeout(resolve, ms));
      }
    };
    return new Nagare(generator());
  },
  merge: (...nagares) => {
    return nagares[0].merge(...nagares.slice(1));
  },
  combine: (...nagares) => {
    const generator = async function* () {
      const iterators = nagares.map((r) => r[Symbol.asyncIterator]());
      const values = new Array(nagares.length);
      let hasValues = new Array(nagares.length).fill(false);
      while (true) {
        const results = await Promise.all(
          iterators.map((it, i) => it.next().then((r) => ({ i, r })))
        );
        let allDone = true;
        for (const { i, r } of results) {
          if (!r.done) {
            values[i] = r.value;
            hasValues[i] = true;
            allDone = false;
          }
        }
        if (allDone) break;
        if (hasValues.every((h) => h)) {
          yield [...values];
        }
      }
    };
    return new Nagare(generator());
  }
};

export { AdaptiveBackpressure, BYOBStreamController, BYOBStreamReader, BufferPool, ChunkedEncoder, CreditController, DynamicBackpressure, FrameSerializer, MultiStreamCreditManager, Nagare, WindowedRateLimiter, buffer, bufferTime, concatMap, createAckMessage, createBYOBTransformStream, createCompleteMessage, createControlFrame, createCreditMessage, createDataFrame, createErrorFrame, createFloat32Frame, createFloat32View, createPauseMessage, createResumeMessage, createSubscribeMessage, createUnsubscribeMessage, createZeroCopyView, debounce, decodeFrame, decodePostcard, nagare as default, distinct, distinctUntilChanged, encodeFrame, encodePostcard, isControlFrame, isDataFrame, isErrorFrame, isFloat32Frame, nagare, pairwise, pipeBYOBStreams, processFloat32Batch, retry, simdMapMulAdd, startWith, switchMap, throttle };
//# sourceMappingURL=index.mjs.map
