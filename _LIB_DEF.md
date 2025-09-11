# Nagare Library Definition

## Overview
**nagare** (流れ) - A WASM-first, stream-centric library for high-performance data processing at the edge.

## Core Principles

1. **Performance First**: Target 5-10x speedup over JavaScript for numeric workloads
2. **Zero-Copy Design**: Minimize data copying across JS↔WASM boundary
3. **Edge-Native**: First-class support for Cloudflare Workers and Durable Objects
4. **Binary by Default**: Use compact binary protocols (postcard) over JSON
5. **Backpressure Aware**: Credit-based flow control throughout

## Architecture

```
┌─────────────────────────────────────┐
│      TypeScript Public API          │
│  - River<T, E> interface            │
│  - Operator chaining                │
│  - Observable pattern               │
├─────────────────────────────────────┤
│      WASM Bridge Layer              │
│  - wasm-bindgen bindings            │
│  - Zero-copy views                  │
│  - String interning                 │
├─────────────────────────────────────┤
│      Rust Core (SIMD-enabled)       │
│  - Fused numeric operators          │
│  - SIMD kernels                     │
│  - Buffer management                │
├─────────────────────────────────────┤
│      Runtime Adapters               │
│  - Node.js (pkg-node)               │
│  - Browser (pkg)                    │
│  - Cloudflare Workers (DO)          │
└─────────────────────────────────────┘
```

## Module Structure

```
nagare/
├── src/                    # Rust source
│   ├── lib.rs             # Main WASM exports
│   ├── river.rs           # Core River implementation
│   ├── operators.rs       # Stream operators
│   ├── simd_ops.rs        # SIMD kernels
│   ├── byob.rs            # BYOB streaming
│   ├── serialization.rs   # Binary serialization
│   └── backpressure.rs    # Flow control
├── src/                    # TypeScript source
│   ├── index.ts           # Public API
│   ├── river.ts           # River class
│   ├── types.ts           # Type definitions
│   ├── operators.ts       # TS operators
│   ├── sources.ts         # River factories
│   ├── wasm-loader.ts     # WASM loading
│   ├── byob.ts            # BYOB utilities
│   ├── backpressure.ts    # Credit control
│   └── serialization.ts   # Frame encoding
├── durable-objects/        # Cloudflare DO
│   └── river-do.ts        # DO implementation
├── tests/                  # Test files
├── benches/                # Benchmarks
└── examples/               # Usage examples
```

## Key APIs

### River Creation
```typescript
river.of(...values)
river.from(iterable)
river.fromReadableStream(stream)
river.fromPromise(promise)
river.interval(ms, signal?)
river.range(start, end, step?)
```

### Core Operators
```typescript
.map(fn)
.filter(predicate)
.scan(fn, initial)
.take(n)
.skip(n)
.fork(predicate)
.merge(...rivers)
.windowedAggregate(size, op)
.mapWasm(kernel, params)
```

### Observable Pattern
```typescript
river.observe(
  next: (v: T) => void,
  opts?: {
    signal?: AbortSignal;
    onError?: (e: E) => void;
    onComplete?: () => void;
  }
): Disposable & Subscription
```

## Performance Targets

| Metric | Target | Notes |
|--------|--------|-------|
| Numeric ops | 5-10x JS | Via SIMD fusion |
| String ops | 1-2x JS | Minimize usage |
| Memory copies | <10% overhead | BYOB + views |
| Latency p95 | <10ms | For DO operations |
| Throughput | >1M msgs/sec | Binary frames |

## WASM Optimization Checklist

- [x] Enable SIMD: `-C target-feature=+simd128`
- [x] Use typed arrays for numeric data
- [x] Implement BYOB streaming
- [x] String interning for repeated strings
- [x] Batch operations to reduce crossings
- [x] Binary serialization (postcard)
- [x] Operator fusion for adjacent ops
- [x] Zero-copy views on WASM memory

## Cloudflare Integration

### Durable Objects
- WebSocket hibernation for idle connections
- SQLite storage for queue and history
- Credit-based backpressure per stream
- Alarms for retry and cleanup

### Deployment
```toml
# wrangler.toml
[[durable_objects.bindings]]
name = "RIVER_DO"
class_name = "RiverDurableObject"

[wasm_modules]
NAGARE_WASM = "pkg/nagare_bg.wasm"
```

## Build Commands

```bash
# Build WASM (with SIMD)
RUSTFLAGS="-C target-feature=+simd128" wasm-pack build --target web

# Build TypeScript
tsc && vite build

# Run tests
vitest

# Run benchmarks
node benches/benchmark.js

# Deploy to Cloudflare
wrangler publish
```

## Testing Strategy

1. **Unit Tests**: Core operators and transformations
2. **Integration Tests**: End-to-end stream processing
3. **Performance Tests**: Benchmark vs RxJS/JavaScript
4. **Runtime Tests**: Node, Browser, Workers
5. **Edge Cases**: Backpressure, errors, cancellation

## Documentation Requirements

- [ ] API reference with examples
- [ ] Performance benchmarks
- [ ] Migration guide from RxJS
- [ ] Cloudflare DO patterns
- [ ] WASM/SIMD explanation

## Future Enhancements

1. **WebGPU acceleration** for massive parallel ops
2. **Multi-threaded WASM** when available in Workers
3. **Adaptive operators** that switch JS↔WASM based on data
4. **Stream analytics** integration
5. **PITR (Point-in-Time Recovery)** for DO storage