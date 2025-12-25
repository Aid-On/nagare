# @aid-on/nagare

<div align="center">

[![npm version](https://img.shields.io/npm/v/@aid-on/nagare.svg?style=flat-square&color=00DC82)](https://www.npmjs.com/package/@aid-on/nagare)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=flat-square)](https://opensource.org/licenses/MIT)
[![Bundle Size](https://img.shields.io/bundlephobia/minzip/@aid-on/nagare?style=flat-square&color=FF6B6B)](https://bundlephobia.com/package/@aid-on/nagare)

<br />

<h3>
<b>nagare</b> (流れ) - The Missing Stream Primitive for Edge Computing
</h3>

<p align="center">
<b>Not just another streaming library.</b><br/>
The <i>only</i> library that makes ReadableStream a first-class citizen with reactive extensions.
</p>

<br/>

[**日本語**](./README.ja.md) | **English**

<br/>

</div>

## Why nagare is Different

### 🎯 **The ONLY Library That...**

#### **1. Makes ReadableStream<T> the Primary Interface**
```typescript
// ❌ Other libraries: Wrap streams in proprietary objects
const rxjsStream = from(readableStream); // Observable wrapper
const mostStream = fromReadable(readableStream); // Most.js wrapper

// ✅ nagare: Stream<T> IS ReadableStream<T> + methods
const nagareStream = stream.from(readableStream); // Zero overhead
nagareStream instanceof ReadableStream; // true! 
```

#### **2. Zero-Cost Reactive Programming**
```typescript
// ❌ RxJS: 100KB+ for basic streaming
import { Observable, from, map, filter } from 'rxjs';

// ✅ nagare: 10KB total, tree-shakeable
import { stream } from '@aid-on/nagare';
// Native performance, no wrapper objects
```

#### **3. Built for Edge, Not Retrofitted**
```typescript
// ❌ Node.js streams: Need polyfills in edge
// ❌ RxJS: Designed for browsers, not edge workers

// ✅ nagare: Native edge runtime support
export default {
  async fetch(request) {
    return stream
      .fromSSE('/api/chat')
      .mapAsync(processWithAI)
      .toResponse(); // Direct to Response object!
  }
}
```

## Unique Features You Won't Find Elsewhere

### 🚀 **Order-Preserving Concurrent Processing**
```typescript
// Process 10 items concurrently but maintain order!
const results = await stream
  .array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  .mapAsync(async (n) => {
    await delay(Math.random() * 1000); // Random delays
    return n * 2;
  }, 10) // Concurrency: 10
  .collect();

console.log(results); // ALWAYS [2, 4, 6, 8, 10, 12, 14, 16, 18, 20]
// Order preserved despite concurrent execution!
```

### 💫 **Automatic Backpressure Handling**
```typescript
// Stream automatically pauses when consumer is slow
stream.subscribe({
  next: async (value) => {
    await heavyProcessing(value); // Stream waits!
    // No memory overflow, no lost data
  }
});
```

### 🔄 **Native SSE with Cross-Platform Line Endings**
```typescript
// Works with ANY server (Windows, Unix, Mac)
const events = await stream.fromSSE('/api/events');
// Automatically handles \r\n, \n, and \r line endings
```

### 🎭 **Dual Interface: Reactive + Imperative**
```typescript
// Choose your style!

// Reactive (pull-based)
const s1 = stream.from(source)
  .map(x => x * 2)
  .filter(x => x > 10);

// Imperative (push-based)
const s2 = stream.create((controller) => {
  controller.next(1);
  controller.next(2);
  controller.complete();
});
```

## Performance Comparison

| Feature | **nagare** | RxJS | Node Streams | Most.js |
|---------|------------|------|--------------|---------|
| Bundle Size | **10KB** | 100KB+ | N/A (Node) | 40KB |
| Edge Support | **Native** | Polyfill | Polyfill | Polyfill |
| Backpressure | **Automatic** | Manual | Yes | Manual |
| Order-preserving concurrency | **Yes** | No | No | No |
| Direct to Response | **Yes** | No | No | No |
| Tree-shakeable | **Yes** | Partial | No | Yes |
| Zero dependencies | **Yes** | No | No | No |

## Real-World Edge Examples

### AI Streaming Response (Cloudflare Workers)
```typescript
export default {
  async fetch(request: Request) {
    const aiStream = stream.create<string>((controller) => {
      // Stream AI responses as they generate
      const response = await ai.complete(prompt, {
        stream: true,
        onToken: (token) => controller.next(token)
      });
    });

    return aiStream
      .tap(token => metrics.record(token))
      .throttle(50) // Prevent client overflow
      .toSSE()
      .toResponse({
        headers: { 
          'Content-Type': 'text/event-stream',
          'X-Powered-By': 'nagare'
        }
      });
  }
};
```

### Real-time Data Pipeline
```typescript
const pipeline = stream
  .fromSSE('/api/market-data')
  .mapAsync(async data => {
    // Parallel enrichment with order preservation
    const [analysis, prediction] = await Promise.all([
      analyzeMarket(data),
      predictTrend(data)
    ]);
    return { ...data, analysis, prediction };
  }, 5) // Process 5 concurrently
  .buffer(10) // Batch for efficiency
  .tap(batch => database.insert(batch))
  .debounce(100); // Prevent UI thrashing
```

## Installation

```bash
npm install @aid-on/nagare
```

## Quick Start

```typescript
import { stream } from '@aid-on/nagare';

// Your first nagare stream
const result = await stream
  .array([1, 2, 3, 4, 5])
  .map(x => x * 2)
  .filter(x => x > 5)
  .collect();

console.log(result); // [6, 8, 10]
```

## The nagare Philosophy

1. **Streams are the primitive** - Not observables, not promises
2. **Edge-first** - Built for Cloudflare, Deno, Bun from day one
3. **Zero magic** - What you see is what runs
4. **Type safety** - Full TypeScript with no compromises
5. **Web standards** - ReadableStream is the foundation

## Who Should Use nagare?

- 🏢 **Edge application developers** - First-class edge runtime support
- 🚀 **Performance enthusiasts** - Minimal overhead, maximum throughput
- 🎯 **Type-safety advocates** - Full TypeScript with strict types
- 🌊 **Stream processing experts** - Advanced operators with backpressure
- 🤖 **AI/ML engineers** - Perfect for streaming LLM responses

## Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for details.

## License

MIT © Aid-On

---

<div align="center">

**Built for the edge. Designed for developers. Ready for production.**

<br/>

[NPM](https://www.npmjs.com/package/@aid-on/nagare) • 
[GitHub](https://github.com/Aid-On/nagare) • 
[Documentation](https://github.com/Aid-On/nagare#readme)

</div>