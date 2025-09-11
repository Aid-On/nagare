# 🌊 Nagare (流れ)

<div align="center">
  <img src="https://raw.githubusercontent.com/aid-on/nagare/main/assets/nagare-logo.png" alt="Nagare Logo" width="600" />
  
  <h3>WASM-first, stream-centric library for high-performance edge computing</h3>
  
  [![npm version](https://img.shields.io/npm/v/@aid-on/nagare.svg)](https://www.npmjs.com/package/@aid-on/nagare)
  [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5.0%2B-blue)](https://www.typescriptlang.org/)
  [![Rust](https://img.shields.io/badge/Rust-1.70%2B-orange)](https://www.rust-lang.org/)
  [![Tests](https://img.shields.io/badge/tests-23%20passing-brightgreen)](tests)
</div>

---

> **nagare** (流れ) - "flow" in Japanese, representing the seamless flow of data through reactive streams

Nagare is a next-generation stream processing library that delivers **5-10x performance** improvements over traditional JavaScript stream libraries. Built with Rust/WASM for compute-heavy workloads, SIMD acceleration, and designed specifically for edge computing environments like Cloudflare Workers.

## ⚡ Performance First

<div align="center">
  <img src="https://raw.githubusercontent.com/aid-on/nagare/main/assets/benchmark-chart.png" alt="Performance Benchmark" width="700" />
</div>

```
🏆 Benchmark Results (vs RxJS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Map + Filter     : 8.78x faster ⚡
Scan/Reduce      : 7.32x faster ⚡  
Complex Pipeline : 1.52x faster ⚡
Average Speedup  : 5.87x 🚀
```

## ✨ Why Nagare?

### 🎯 **Purpose-Built for Edge**
- First-class Cloudflare Durable Objects support
- WebSocket hibernation for efficient real-time streams
- Optimized for V8 isolates and edge runtimes

### 🚀 **WASM-Powered Performance**
- Rust core compiled to WebAssembly
- SIMD acceleration for numeric operations
- Zero-copy BYOB streaming
- JIT compilation and operator fusion

### 🛡️ **Production Ready**
- Full TypeScript support with strict typing
- Comprehensive error handling and recovery
- Credit-based backpressure control
- Battle-tested in production environments

### 🔧 **Developer Experience**
- Familiar RxJS-like API
- Tree-shakeable and optimized bundles
- Extensive documentation and examples
- Works in Node.js, browsers, and edge

## 📦 Installation

```bash
npm install @aid-on/nagare
```

```bash
yarn add @aid-on/nagare
```

```bash
pnpm add @aid-on/nagare
```

## 🚀 Quick Start

### Basic Stream Processing

```typescript
import { River } from '@aid-on/nagare';

// Create and transform a stream
const stream = River.from([1, 2, 3, 4, 5])
  .map(x => x * 2)
  .filter(x => x > 5)
  .scan((acc, x) => acc + x, 0);

// Subscribe with automatic cleanup
using subscription = stream.observe(
  value => console.log('Value:', value),
  {
    onComplete: () => console.log('Complete!'),
    onError: error => console.error('Error:', error)
  }
);
```

### SIMD-Accelerated Processing

```typescript
// Process large Float32Arrays with SIMD
const audioData = new Float32Array(1_000_000);

const processed = await River
  .from([audioData])
  .mapWasm('fft_transform')      // Fast Fourier Transform
  .mapWasm('noise_reduction')    // SIMD noise reduction
  .toArray();
```

### Real-time WebSocket Streams

```typescript
import { createFromWebSocket } from '@aid-on/nagare';

const wsStream = createFromWebSocket(socket, { 
  binary: true,
  reconnect: true 
});

wsStream
  .map(msg => JSON.parse(msg.data))
  .filter(event => event.type === 'trade')
  .scan((volume, trade) => volume + trade.amount, 0)
  .observe(volume => {
    console.log('Total volume:', volume);
  });
```

## 🎨 Core Concepts

### The River Type

`River<T, E>` is the core abstraction - a lazy, composable stream that can be transformed, merged, and observed.

```typescript
// Multiple ways to create rivers
const fromArray = River.from([1, 2, 3]);
const fromPromise = River.from(Promise.resolve(42));
const fromInterval = river.interval(1000);
const fromWebStream = River.fromReadableStream(stream);

// Chainable operators
const pipeline = source
  .map(transform)
  .filter(predicate)
  .debounce(300)
  .distinctUntilChanged()
  .scan(reducer, initial);
```

### Backpressure Management

```typescript
import { CreditController, AdaptiveBackpressure } from '@aid-on/nagare';

// Credit-based flow control
const credits = new CreditController({
  initialCredits: 100,
  lowWaterMark: 20,
  highWaterMark: 80
});

// Adaptive backpressure based on latency
const adaptive = new AdaptiveBackpressure({
  targetLatency: 50,  // ms
  initialRate: 100,
  minRate: 10,
  maxRate: 1000
});
```

### Error Recovery

```typescript
const resilient = river
  .map(riskyOperation)
  .rescue(error => {
    logger.error('Operation failed:', error);
    return fallbackValue;  // Recover with default
  })
  .retry(3, 1000)  // Retry up to 3 times
  .terminateOnErrorMode();  // Stop on critical errors
```

## 🌐 Edge Computing Features

### Cloudflare Durable Objects

```typescript
export class StreamProcessor extends DurableObject {
  private river?: River<any>;

  async fetch(request: Request) {
    // Create a stateful stream processor
    this.river = River
      .fromWebSocket(request)
      .map(this.processMessage)
      .buffer(100)
      .scan(this.aggregate, {});
      
    return new Response('Stream initialized');
  }
  
  async alarm() {
    // Process buffered data periodically
    const batch = await this.river?.take(100).toArray();
    await this.processBatch(batch);
  }
}
```

### WebSocket with Hibernation

```typescript
// Efficient WebSocket handling with hibernation
export class WebSocketDO extends DurableObject {
  async webSocketMessage(ws: WebSocket, message: string) {
    // Only wake up when messages arrive
    const result = await this.processMessage(message);
    ws.send(JSON.stringify(result));
  }
  
  async webSocketClose(ws: WebSocket) {
    // Clean up on disconnect
    this.state.deleteWebSocket(ws);
  }
}
```

## 📊 Advanced Examples

### Financial Data Processing

```typescript
// Real-time trade aggregation
const trades = River.fromEventSource('/trades')
  .map(e => JSON.parse(e.data))
  .filter(t => t.symbol === 'BTC/USD')
  .windowedAggregate(100, 'mean')  // 100-trade moving average
  .scan((stats, price) => ({
    ...stats,
    vwap: (stats.vwap * stats.count + price) / (stats.count + 1),
    count: stats.count + 1
  }), { vwap: 0, count: 0 })
  .observe(stats => {
    dashboard.update(stats);
  });
```

### IoT Sensor Data

```typescript
// Process sensor telemetry with SIMD
const telemetry = River
  .fromMQTT(mqttClient, 'sensors/+/data')
  .map(msg => new Float32Array(msg.payload))
  .mapWasm('kalman_filter')  // SIMD Kalman filtering
  .mapWasm('anomaly_detection')  // SIMD anomaly detection
  .filter(reading => reading.anomalyScore > 0.8)
  .observe(anomaly => {
    alerts.send(anomaly);
  });
```

### Stream Orchestration

```typescript
// Merge and combine multiple streams
const temperature = River.fromSensor('temp');
const humidity = River.fromSensor('humidity');
const pressure = River.fromSensor('pressure');

// Merge all readings (interleaved)
const allReadings = river.merge(temperature, humidity, pressure);

// Combine latest values from each
const combined = river.combine(temperature, humidity, pressure)
  .map(([t, h, p]) => ({
    temperature: t,
    humidity: h,
    pressure: p,
    timestamp: Date.now()
  }));
```

## 🏗️ Architecture

<div align="center">
  <img src="https://raw.githubusercontent.com/aid-on/nagare/main/assets/architecture.png" alt="Architecture" width="600" />
</div>

```
┌─────────────────────────────────────────────────┐
│            TypeScript API Layer                  │
│         (Reactive operators, type safety)        │
├─────────────────────────────────────────────────┤
│           WASM Bridge (wasm-bindgen)            │
│        (Automatic memory management)             │
├─────────────────────────────────────────────────┤
│             Rust Core Engine                     │
│   ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│   │   SIMD   │ │  Buffer  │ │   Flow   │      │
│   │ Kernels  │ │   Pool   │ │ Control  │      │
│   └──────────┘ └──────────┘ └──────────┘      │
├─────────────────────────────────────────────────┤
│            Runtime Adapters                      │
│     (Node.js / Browser / Edge Workers)          │
└─────────────────────────────────────────────────┘
```

## 📚 Complete API Reference

### Stream Creation

```typescript
River.from(source)           // From iterable/async iterable
River.of(...values)          // From values
River.empty()                // Empty stream
river.range(0, 100)          // Numeric range
river.interval(1000)         // Periodic emissions
createFromWebSocket(ws)      // WebSocket stream
createFromEventSource(url)   // Server-sent events
createFromFetch(url, opts)   // HTTP polling
```

### Transformation Operators

```typescript
map(fn)                      // Transform values
filter(predicate)            // Filter values
scan(reducer, seed)          // Accumulate values
take(n)                      // Take first n
skip(n)                      // Skip first n
distinctUntilChanged()       // Emit on change
debounce(ms)                 // Debounce emissions
throttle(ms)                 // Throttle emissions
buffer(size)                 // Buffer values
bufferTime(ms)              // Time-based buffer
pairwise()                   // Emit consecutive pairs
startWith(...values)         // Prepend values
```

### Combination Operators

```typescript
merge(...rivers)             // Merge streams
fork(predicate)             // Split stream
concatMap(fn)               // Sequential flatten
switchMap(fn)               // Cancel previous
combineLatest(...rivers)    // Combine latest values
withLatestFrom(river)       // Sample other stream
```

### Error Handling

```typescript
rescue(handler)             // Recover from errors
retry(count, delay)         // Retry on failure
terminateOnErrorMode()      // Stop on error
```

### WASM Operators

```typescript
mapWasm(kernel, params)     // Apply WASM kernel
windowedAggregate(n, op)    // SIMD aggregation
```

## 🧪 Testing

```bash
# Run all tests
npm test

# Run benchmarks
npm run bench

# Run specific benchmark
npm run bench:rxjs
npm run bench:wasm

# Test in browser
npm run test:browser
```

## 🚢 Deployment

### Cloudflare Workers

```toml
# wrangler.toml
name = "nagare-app"
main = "dist/worker.js"
compatibility_date = "2024-01-01"

[[durable_objects.bindings]]
name = "STREAM_DO"
class_name = "StreamProcessor"
```

```bash
npm run build:worker
wrangler deploy
```

### Node.js

```javascript
// Automatic WASM loading
import { river } from '@aid-on/nagare';

const result = await river
  .from(data)
  .mapWasm('simd_kernel')
  .toArray();
```

### Browser

```html
<script type="module">
  import { River } from 'https://cdn.skypack.dev/@aid-on/nagare';
  
  const stream = River.from([1, 2, 3])
    .map(x => x * 2)
    .observe(console.log);
</script>
```

---

<div align="center">
  <b>Built with 🦀 Rust + 🔥 WASM + 💙 TypeScript</b>
  <br>
  <sub>Making streams flow faster at the edge</sub>
</div>