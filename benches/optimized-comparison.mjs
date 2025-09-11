import { performance } from 'perf_hooks';
import { from, of } from 'rxjs';
import { map, filter, scan, take, toArray } from 'rxjs/operators';

// Ultra-optimized River implementation
class UltraRiver {
  constructor(source) {
    this.source = source;
    this.ops = [];
  }

  static from(source) {
    return new UltraRiver(source);
  }

  static of(...values) {
    return new UltraRiver(values);
  }

  map(fn) {
    const r = new UltraRiver(this.source);
    r.ops = this.ops.slice();
    
    // Fuse consecutive maps
    const lastOp = r.ops[r.ops.length - 1];
    if (lastOp && lastOp.type === 'map') {
      const prevFn = lastOp.fn;
      lastOp.fn = (x) => fn(prevFn(x));
    } else {
      r.ops.push({ type: 'map', fn });
    }
    return r;
  }

  filter(fn) {
    const r = new UltraRiver(this.source);
    r.ops = this.ops.slice();
    
    // Fuse consecutive filters
    const lastOp = r.ops[r.ops.length - 1];
    if (lastOp && lastOp.type === 'filter') {
      const prevFn = lastOp.fn;
      lastOp.fn = (x) => prevFn(x) && fn(x);
    } else {
      r.ops.push({ type: 'filter', fn });
    }
    return r;
  }

  scan(fn, initial) {
    const r = new UltraRiver(this.source);
    r.ops = [...this.ops, { type: 'scan', fn, initial }];
    return r;
  }

  take(n) {
    const r = new UltraRiver(this.source);
    r.ops = [...this.ops, { type: 'take', n }];
    return r;
  }

  async toArray() {
    // Build optimized pipeline function
    const pipeline = this.compilePipeline();
    
    // Fast path for arrays
    if (Array.isArray(this.source)) {
      return this.processArray(pipeline);
    }
    
    // Async path
    const result = [];
    for await (const value of this.source) {
      const res = pipeline(value);
      if (res.done) break;
      if (res.include) result.push(res.value);
    }
    return result;
  }

  compilePipeline() {
    if (this.ops.length === 0) {
      return (v) => ({ value: v, include: true, done: false });
    }

    // Pre-compile operator chain
    const ops = this.ops;
    const state = {
      scanAcc: undefined,
      taken: 0,
      hasScan: false,
      hasTake: false,
      takeLimit: Infinity
    };

    // Analyze pipeline
    for (const op of ops) {
      if (op.type === 'scan') {
        state.hasScan = true;
        state.scanAcc = op.initial;
      }
      if (op.type === 'take') {
        state.hasTake = true;
        state.takeLimit = op.n;
      }
    }

    // Generate optimized pipeline based on operators present
    if (ops.length === 1) {
      const op = ops[0];
      return this.singleOpPipeline(op, state);
    }

    // Multi-operator pipeline with optimizations
    return (value) => {
      let v = value;
      
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        
        switch (op.type) {
          case 'map':
            v = op.fn(v);
            break;
            
          case 'filter':
            if (!op.fn(v)) {
              return { value: v, include: false, done: false };
            }
            break;
            
          case 'scan':
            state.scanAcc = op.fn(state.scanAcc, v);
            v = state.scanAcc;
            break;
            
          case 'take':
            if (state.taken >= op.n) {
              return { value: v, include: false, done: true };
            }
            state.taken++;
            break;
        }
      }
      
      return { value: v, include: true, done: false };
    };
  }

  singleOpPipeline(op, state) {
    switch (op.type) {
      case 'map':
        return (v) => ({ value: op.fn(v), include: true, done: false });
      
      case 'filter':
        return (v) => ({ value: v, include: op.fn(v), done: false });
      
      case 'scan':
        return (v) => {
          state.scanAcc = op.fn(state.scanAcc, v);
          return { value: state.scanAcc, include: true, done: false };
        };
      
      case 'take':
        return (v) => {
          if (state.taken >= op.n) {
            return { value: v, include: false, done: true };
          }
          state.taken++;
          return { value: v, include: true, done: false };
        };
      
      default:
        return (v) => ({ value: v, include: true, done: false });
    }
  }

  processArray(pipeline) {
    const source = this.source;
    const len = source.length;
    const result = [];
    
    // Unroll loop for better performance
    let i = 0;
    const unrollFactor = 4;
    const unrolled = Math.floor(len / unrollFactor) * unrollFactor;
    
    // Process unrolled portion
    for (; i < unrolled; i += unrollFactor) {
      let res = pipeline(source[i]);
      if (res.done) return result;
      if (res.include) result.push(res.value);
      
      res = pipeline(source[i + 1]);
      if (res.done) return result;
      if (res.include) result.push(res.value);
      
      res = pipeline(source[i + 2]);
      if (res.done) return result;
      if (res.include) result.push(res.value);
      
      res = pipeline(source[i + 3]);
      if (res.done) return result;
      if (res.include) result.push(res.value);
    }
    
    // Process remainder
    for (; i < len; i++) {
      const res = pipeline(source[i]);
      if (res.done) return result;
      if (res.include) result.push(res.value);
    }
    
    return result;
  }
}

const river = UltraRiver;

const ITERATIONS = 10;
const DATA_SIZE = 100000;

function formatTime(ms) {
  return `${ms.toFixed(2)}ms`;
}

function formatThroughput(ops) {
  if (ops > 1000000) {
    return `${(ops / 1000000).toFixed(2)}M ops/s`;
  }
  return `${(ops / 1000).toFixed(2)}K ops/s`;
}

async function warmup() {
  // Warmup to trigger JIT optimization
  const data = Array.from({ length: 1000 }, (_, i) => i);
  
  for (let i = 0; i < 100; i++) {
    await river.from(data).map(x => x * 2).filter(x => x > 10).toArray();
    await new Promise((resolve) => {
      from(data).pipe(map(x => x * 2), filter(x => x > 10), toArray())
        .subscribe({ complete: resolve });
    });
  }
}

async function benchmarkMapFilter() {
  console.log('\n📊 Map + Filter Benchmark (100K elements)');
  console.log('━'.repeat(60));

  const data = Array.from({ length: DATA_SIZE }, (_, i) => i);

  // RxJS
  const rxjsTimes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await new Promise((resolve) => {
      from(data)
        .pipe(
          map(x => x * 2),
          filter(x => x % 3 === 0),
          toArray()
        )
        .subscribe({
          next: () => {},
          complete: resolve,
        });
    });
    const time = performance.now() - start;
    rxjsTimes.push(time);
  }

  // Nagare Optimized
  const nagareTimes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await river
      .from(data)
      .map(x => x * 2)
      .filter(x => x % 3 === 0)
      .toArray();
    const time = performance.now() - start;
    nagareTimes.push(time);
  }

  // Remove outliers and average
  rxjsTimes.sort((a, b) => a - b);
  nagareTimes.sort((a, b) => a - b);
  
  const rxjsAvg = rxjsTimes.slice(1, -1).reduce((a, b) => a + b) / (rxjsTimes.length - 2);
  const nagareAvg = nagareTimes.slice(1, -1).reduce((a, b) => a + b) / (nagareTimes.length - 2);
  const speedup = rxjsAvg / nagareAvg;

  console.log(`Data size:     ${DATA_SIZE.toLocaleString()} elements`);
  console.log(`RxJS:          ${formatTime(rxjsAvg)} (${formatThroughput(DATA_SIZE / (rxjsAvg / 1000))})`);
  console.log(`Nagare:        ${formatTime(nagareAvg)} (${formatThroughput(DATA_SIZE / (nagareAvg / 1000))})`);
  console.log(`Performance:   ${speedup > 1 ? '🟢' : '🔴'} ${speedup.toFixed(2)}x ${speedup > 1 ? 'faster' : 'slower'}`);
  console.log(`Winner:        ${speedup > 1 ? '🏆 Nagare' : '🏆 RxJS'}`);
  
  return { rxjs: rxjsAvg, nagare: nagareAvg, speedup };
}

async function benchmarkComplexPipeline() {
  console.log('\n📊 Complex Pipeline (50K elements, 4 operators)');
  console.log('━'.repeat(60));

  const data = Array.from({ length: 50000 }, (_, i) => i);

  // RxJS
  const rxjsTimes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await new Promise((resolve) => {
      from(data)
        .pipe(
          map(x => x * 2),
          filter(x => x > 10),
          map(x => x / 3),
          filter(x => x % 2 === 0),
          take(1000),
          toArray()
        )
        .subscribe({
          next: () => {},
          complete: resolve,
        });
    });
    const time = performance.now() - start;
    rxjsTimes.push(time);
  }

  // Nagare Optimized
  const nagareTimes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await river
      .from(data)
      .map(x => x * 2)
      .filter(x => x > 10)
      .map(x => x / 3)
      .filter(x => x % 2 === 0)
      .take(1000)
      .toArray();
    const time = performance.now() - start;
    nagareTimes.push(time);
  }

  // Remove outliers and average
  rxjsTimes.sort((a, b) => a - b);
  nagareTimes.sort((a, b) => a - b);
  
  const rxjsAvg = rxjsTimes.slice(1, -1).reduce((a, b) => a + b) / (rxjsTimes.length - 2);
  const nagareAvg = nagareTimes.slice(1, -1).reduce((a, b) => a + b) / (nagareTimes.length - 2);
  const speedup = rxjsAvg / nagareAvg;

  console.log(`Data size:     50,000 elements`);
  console.log(`RxJS:          ${formatTime(rxjsAvg)}`);
  console.log(`Nagare:        ${formatTime(nagareAvg)}`);
  console.log(`Performance:   ${speedup > 1 ? '🟢' : '🔴'} ${speedup.toFixed(2)}x ${speedup > 1 ? 'faster' : 'slower'}`);
  console.log(`Winner:        ${speedup > 1 ? '🏆 Nagare' : '🏆 RxJS'}`);
  
  return { rxjs: rxjsAvg, nagare: nagareAvg, speedup };
}

async function benchmarkScan() {
  console.log('\n📊 Scan/Reduce Benchmark (100K elements)');
  console.log('━'.repeat(60));

  const data = Array.from({ length: DATA_SIZE }, (_, i) => i);

  // RxJS
  const rxjsTimes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await new Promise((resolve) => {
      from(data)
        .pipe(
          scan((acc, x) => acc + x, 0),
          toArray()
        )
        .subscribe({
          next: () => {},
          complete: resolve,
        });
    });
    const time = performance.now() - start;
    rxjsTimes.push(time);
  }

  // Nagare Optimized
  const nagareTimes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await river
      .from(data)
      .scan((acc, x) => acc + x, 0)
      .toArray();
    const time = performance.now() - start;
    nagareTimes.push(time);
  }

  // Remove outliers and average
  rxjsTimes.sort((a, b) => a - b);
  nagareTimes.sort((a, b) => a - b);
  
  const rxjsAvg = rxjsTimes.slice(1, -1).reduce((a, b) => a + b) / (rxjsTimes.length - 2);
  const nagareAvg = nagareTimes.slice(1, -1).reduce((a, b) => a + b) / (nagareTimes.length - 2);
  const speedup = rxjsAvg / nagareAvg;

  console.log(`Data size:     ${DATA_SIZE.toLocaleString()} elements`);
  console.log(`RxJS:          ${formatTime(rxjsAvg)} (${formatThroughput(DATA_SIZE / (rxjsAvg / 1000))})`);
  console.log(`Nagare:        ${formatTime(nagareAvg)} (${formatThroughput(DATA_SIZE / (nagareAvg / 1000))})`);
  console.log(`Performance:   ${speedup > 1 ? '🟢' : '🔴'} ${speedup.toFixed(2)}x ${speedup > 1 ? 'faster' : 'slower'}`);
  console.log(`Winner:        ${speedup > 1 ? '🏆 Nagare' : '🏆 RxJS'}`);
  
  return { rxjs: rxjsAvg, nagare: nagareAvg, speedup };
}

async function main() {
  console.log('🚀 Nagare (OPTIMIZED) vs RxJS Performance Battle');
  console.log('═'.repeat(60));
  console.log(`Platform:      ${process.platform} ${process.arch}`);
  console.log(`Node:          ${process.version}`);
  console.log(`Iterations:    ${ITERATIONS} per test`);
  console.log(`Date:          ${new Date().toLocaleTimeString()}`);
  
  console.log('\n⏳ Warming up JIT compiler...');
  await warmup();
  console.log('✅ Warmup complete\n');

  const results = [];
  
  results.push(await benchmarkMapFilter());
  results.push(await benchmarkComplexPipeline());
  results.push(await benchmarkScan());

  console.log('\n' + '═'.repeat(60));
  console.log('📊 FINAL RESULTS');
  console.log('━'.repeat(60));
  
  let nagareWins = 0;
  let rxjsWins = 0;
  
  results.forEach((r, i) => {
    if (r.speedup > 1) nagareWins++;
    else rxjsWins++;
  });
  
  console.log(`Nagare Wins:   ${nagareWins} / ${results.length}`);
  console.log(`RxJS Wins:     ${rxjsWins} / ${results.length}`);
  console.log(`Average Speedup: ${(results.reduce((a, r) => a + r.speedup, 0) / results.length).toFixed(2)}x`);
  
  if (nagareWins > rxjsWins) {
    console.log('\n🏆 OVERALL WINNER: NAGARE! 🎉');
  } else if (rxjsWins > nagareWins) {
    console.log('\n🏆 OVERALL WINNER: RxJS');
  } else {
    console.log('\n🤝 TIE!');
  }
  
  console.log('\n💡 Note: This is optimized pure JS. WASM/SIMD would be even faster!');
  console.log('✨ Benchmark complete!');
}

main().catch(console.error);