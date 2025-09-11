import { performance } from 'perf_hooks';
import { from, of, range } from 'rxjs';
import { map, filter, scan, take } from 'rxjs/operators';
import { river } from '../dist/index.mjs';
import { loadWasm } from '../dist/wasm-loader.mjs';

const ITERATIONS = 10;
const DATA_SIZE = 1000000;

function formatTime(ms) {
  return `${ms.toFixed(2)}ms`;
}

function formatThroughput(ops) {
  if (ops > 1000000) {
    return `${(ops / 1000000).toFixed(2)}M ops/s`;
  }
  return `${(ops / 1000).toFixed(2)}K ops/s`;
}

async function benchmarkMapFilter() {
  console.log('\n📊 Map + Filter Benchmark (1M elements)');
  console.log('━'.repeat(50));

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
        )
        .subscribe({
          complete: resolve,
        });
    });
    const time = performance.now() - start;
    rxjsTimes.push(time);
  }

  // Nagare
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

  const rxjsAvg = rxjsTimes.reduce((a, b) => a + b) / rxjsTimes.length;
  const nagareAvg = nagareTimes.reduce((a, b) => a + b) / nagareTimes.length;
  const speedup = rxjsAvg / nagareAvg;

  console.log(`RxJS:    ${formatTime(rxjsAvg)} (${formatThroughput(DATA_SIZE / (rxjsAvg / 1000))})`);
  console.log(`Nagare:  ${formatTime(nagareAvg)} (${formatThroughput(DATA_SIZE / (nagareAvg / 1000))})`);
  console.log(`Speedup: ${speedup.toFixed(2)}x`);
}

async function benchmarkFloat32Processing() {
  console.log('\n📊 Float32 SIMD Processing Benchmark (1M floats)');
  console.log('━'.repeat(50));

  const data = new Float32Array(DATA_SIZE);
  for (let i = 0; i < DATA_SIZE; i++) {
    data[i] = Math.random() * 100;
  }

  // JavaScript baseline
  const jsTimes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    const result = new Float32Array(data.length);
    for (let j = 0; j < data.length; j++) {
      result[j] = data[j] * 2.5 + 1.2;
    }
    const time = performance.now() - start;
    jsTimes.push(time);
  }

  // Nagare WASM/SIMD
  const nagareTimes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    const r = await river.from([data]).mapWasm('f32x_map_mul_add', { a: 2.5, b: 1.2 });
    await r.toArray();
    const time = performance.now() - start;
    nagareTimes.push(time);
  }

  const jsAvg = jsTimes.reduce((a, b) => a + b) / jsTimes.length;
  const nagareAvg = nagareTimes.reduce((a, b) => a + b) / nagareTimes.length;
  const speedup = jsAvg / nagareAvg;

  console.log(`JS Loop:     ${formatTime(jsAvg)} (${formatThroughput(DATA_SIZE / (jsAvg / 1000))})`);
  console.log(`Nagare SIMD: ${formatTime(nagareAvg)} (${formatThroughput(DATA_SIZE / (nagareAvg / 1000))})`);
  console.log(`Speedup:     ${speedup.toFixed(2)}x`);
}

async function benchmarkWindowedAggregation() {
  console.log('\n📊 Windowed Aggregation Benchmark (100K elements, window=100)');
  console.log('━'.repeat(50));

  const data = Array.from({ length: 100000 }, (_, i) => Math.random() * 100);
  const windowSize = 100;

  // JavaScript baseline
  const jsTimes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    const results = [];
    for (let j = 0; j <= data.length - windowSize; j++) {
      const window = data.slice(j, j + windowSize);
      const mean = window.reduce((a, b) => a + b) / window.length;
      results.push(mean);
    }
    const time = performance.now() - start;
    jsTimes.push(time);
  }

  // Nagare
  const nagareTimes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await river
      .from(data)
      .windowedAggregate(windowSize, 'mean')
      .toArray();
    const time = performance.now() - start;
    nagareTimes.push(time);
  }

  const jsAvg = jsTimes.reduce((a, b) => a + b) / jsTimes.length;
  const nagareAvg = nagareTimes.reduce((a, b) => a + b) / nagareTimes.length;
  const speedup = jsAvg / nagareAvg;

  console.log(`JS Loop:  ${formatTime(jsAvg)}`);
  console.log(`Nagare:   ${formatTime(nagareAvg)}`);
  console.log(`Speedup:  ${speedup.toFixed(2)}x`);
}

async function benchmarkMergeStreams() {
  console.log('\n📊 Stream Merge Benchmark (10 streams, 10K elements each)');
  console.log('━'.repeat(50));

  const streams = Array.from({ length: 10 }, () =>
    Array.from({ length: 10000 }, () => Math.random())
  );

  // RxJS
  const rxjsTimes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await new Promise((resolve) => {
      const rxStreams = streams.map(s => from(s));
      rxStreams[0].pipe(
        // merge(...rxStreams.slice(1))
      ).subscribe({
        complete: resolve,
      });
    });
    const time = performance.now() - start;
    rxjsTimes.push(time);
  }

  // Nagare
  const nagareTimes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    const nagareStreams = streams.map(s => river.from(s));
    await river.merge(...nagareStreams).toArray();
    const time = performance.now() - start;
    nagareTimes.push(time);
  }

  const rxjsAvg = rxjsTimes.reduce((a, b) => a + b) / rxjsTimes.length;
  const nagareAvg = nagareTimes.reduce((a, b) => a + b) / nagareTimes.length;
  const speedup = rxjsAvg / nagareAvg;

  console.log(`RxJS:    ${formatTime(rxjsAvg)}`);
  console.log(`Nagare:  ${formatTime(nagareAvg)}`);
  console.log(`Speedup: ${speedup.toFixed(2)}x`);
}

async function benchmarkBackpressure() {
  console.log('\n📊 Backpressure Control Benchmark (100K credit operations)');
  console.log('━'.repeat(50));

  const operations = 100000;

  // JavaScript baseline
  const jsTimes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    let credits = 1000;
    for (let j = 0; j < operations; j++) {
      if (credits >= 1) {
        credits--;
      }
      if (j % 100 === 0) {
        credits += 10;
      }
    }
    const time = performance.now() - start;
    jsTimes.push(time);
  }

  // Nagare CreditController
  const { CreditController } = await import('../dist/backpressure.mjs');
  const nagareTimes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    const controller = new CreditController(1000);
    for (let j = 0; j < operations; j++) {
      controller.consumeCredit(1);
      if (j % 100 === 0) {
        controller.addCredits(10);
      }
    }
    const time = performance.now() - start;
    nagareTimes.push(time);
  }

  const jsAvg = jsTimes.reduce((a, b) => a + b) / jsTimes.length;
  const nagareAvg = nagareTimes.reduce((a, b) => a + b) / nagareTimes.length;
  const speedup = jsAvg / nagareAvg;

  console.log(`JS:      ${formatTime(jsAvg)} (${formatThroughput(operations / (jsAvg / 1000))})`);
  console.log(`Nagare:  ${formatTime(nagareAvg)} (${formatThroughput(operations / (nagareAvg / 1000))})`);
  console.log(`Speedup: ${speedup.toFixed(2)}x`);
}

async function main() {
  console.log('🚀 Nagare Performance Benchmarks');
  console.log('═'.repeat(50));
  console.log(`Platform: ${process.platform} ${process.arch}`);
  console.log(`Node:     ${process.version}`);
  console.log(`Data Size: ${DATA_SIZE.toLocaleString()} elements`);
  console.log(`Iterations: ${ITERATIONS}`);

  console.log('\n⏳ Loading WASM module...');
  await loadWasm();
  console.log('✅ WASM module loaded\n');

  await benchmarkMapFilter();
  await benchmarkFloat32Processing();
  await benchmarkWindowedAggregation();
  await benchmarkMergeStreams();
  await benchmarkBackpressure();

  console.log('\n' + '═'.repeat(50));
  console.log('✨ Benchmarks complete!');
}

main().catch(console.error);