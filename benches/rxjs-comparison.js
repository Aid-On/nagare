import { performance } from 'perf_hooks';
import { from, of, range } from 'rxjs';
import { map, filter, scan, take, mergeAll, reduce, toArray } from 'rxjs/operators';
import { river } from '../src/index.ts';

const ITERATIONS = 5;
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

  console.log(`Data size:     ${DATA_SIZE.toLocaleString()} elements`);
  console.log(`RxJS:          ${formatTime(rxjsAvg)} (${formatThroughput(DATA_SIZE / (rxjsAvg / 1000))})`);
  console.log(`Nagare:        ${formatTime(nagareAvg)} (${formatThroughput(DATA_SIZE / (nagareAvg / 1000))})`);
  console.log(`Speedup:       ${speedup > 1 ? '+' : ''}${((speedup - 1) * 100).toFixed(1)}%`);
  console.log(`Winner:        ${speedup > 1 ? '🏆 Nagare' : '🏆 RxJS'}`);
}

async function benchmarkComplexPipeline() {
  console.log('\n📊 Complex Pipeline Benchmark (50K elements)');
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

  // Nagare
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

  const rxjsAvg = rxjsTimes.reduce((a, b) => a + b) / rxjsTimes.length;
  const nagareAvg = nagareTimes.reduce((a, b) => a + b) / nagareTimes.length;
  const speedup = rxjsAvg / nagareAvg;

  console.log(`Data size:     ${50000} elements`);
  console.log(`RxJS:          ${formatTime(rxjsAvg)}`);
  console.log(`Nagare:        ${formatTime(nagareAvg)}`);
  console.log(`Speedup:       ${speedup > 1 ? '+' : ''}${((speedup - 1) * 100).toFixed(1)}%`);
  console.log(`Winner:        ${speedup > 1 ? '🏆 Nagare' : '🏆 RxJS'}`);
}

async function benchmarkScan() {
  console.log('\n📊 Scan (Accumulation) Benchmark (100K elements)');
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

  // Nagare
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

  const rxjsAvg = rxjsTimes.reduce((a, b) => a + b) / rxjsTimes.length;
  const nagareAvg = nagareTimes.reduce((a, b) => a + b) / nagareTimes.length;
  const speedup = rxjsAvg / nagareAvg;

  console.log(`Data size:     ${DATA_SIZE.toLocaleString()} elements`);
  console.log(`RxJS:          ${formatTime(rxjsAvg)} (${formatThroughput(DATA_SIZE / (rxjsAvg / 1000))})`);
  console.log(`Nagare:        ${formatTime(nagareAvg)} (${formatThroughput(DATA_SIZE / (nagareAvg / 1000))})`);
  console.log(`Speedup:       ${speedup > 1 ? '+' : ''}${((speedup - 1) * 100).toFixed(1)}%`);
  console.log(`Winner:        ${speedup > 1 ? '🏆 Nagare' : '🏆 RxJS'}`);
}

async function benchmarkMerge() {
  console.log('\n📊 Stream Merge Benchmark (5 streams, 10K elements each)');
  console.log('━'.repeat(60));

  const streams = Array.from({ length: 5 }, () =>
    Array.from({ length: 10000 }, () => Math.random())
  );

  // RxJS
  const rxjsTimes = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const start = performance.now();
    await new Promise((resolve) => {
      const rxStreams = streams.map(s => from(s));
      from(rxStreams)
        .pipe(
          mergeAll(),
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

  console.log(`Total elements: ${50000}`);
  console.log(`RxJS:          ${formatTime(rxjsAvg)}`);
  console.log(`Nagare:        ${formatTime(nagareAvg)}`);
  console.log(`Speedup:       ${speedup > 1 ? '+' : ''}${((speedup - 1) * 100).toFixed(1)}%`);
  console.log(`Winner:        ${speedup > 1 ? '🏆 Nagare' : '🏆 RxJS'}`);
}

async function benchmarkCreationOverhead() {
  console.log('\n📊 Stream Creation Overhead (1K iterations, small data)');
  console.log('━'.repeat(60));

  const iterations = 1000;

  // RxJS
  const rxjsStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    await new Promise((resolve) => {
      of(1, 2, 3, 4, 5)
        .pipe(
          map(x => x * 2),
          toArray()
        )
        .subscribe({
          next: () => {},
          complete: resolve,
        });
    });
  }
  const rxjsTime = performance.now() - rxjsStart;

  // Nagare
  const nagareStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    await river
      .of(1, 2, 3, 4, 5)
      .map(x => x * 2)
      .toArray();
  }
  const nagareTime = performance.now() - nagareStart;

  const speedup = rxjsTime / nagareTime;

  console.log(`Iterations:    ${iterations}`);
  console.log(`RxJS:          ${formatTime(rxjsTime)} (${formatTime(rxjsTime / iterations)} per iteration)`);
  console.log(`Nagare:        ${formatTime(nagareTime)} (${formatTime(nagareTime / iterations)} per iteration)`);
  console.log(`Speedup:       ${speedup > 1 ? '+' : ''}${((speedup - 1) * 100).toFixed(1)}%`);
  console.log(`Winner:        ${speedup > 1 ? '🏆 Nagare' : '🏆 RxJS'}`);
}

async function benchmarkMemoryEfficiency() {
  console.log('\n📊 Memory Efficiency Test (1M elements)');
  console.log('━'.repeat(60));

  const bigData = Array.from({ length: 1000000 }, (_, i) => i);

  // Measure initial memory
  if (global.gc) global.gc();
  const initialMemory = process.memoryUsage().heapUsed;

  // RxJS Memory Test
  if (global.gc) global.gc();
  const rxjsMemStart = process.memoryUsage().heapUsed;
  
  await new Promise((resolve) => {
    from(bigData)
      .pipe(
        map(x => x * 2),
        filter(x => x % 2 === 0),
        take(10000),
        toArray()
      )
      .subscribe({
        complete: resolve,
      });
  });
  
  const rxjsMemPeak = process.memoryUsage().heapUsed - rxjsMemStart;

  // Force GC and test Nagare
  if (global.gc) global.gc();
  const nagareMemStart = process.memoryUsage().heapUsed;
  
  await river
    .from(bigData)
    .map(x => x * 2)
    .filter(x => x % 2 === 0)
    .take(10000)
    .toArray();
  
  const nagareMemPeak = process.memoryUsage().heapUsed - nagareMemStart;

  const memoryRatio = rxjsMemPeak / nagareMemPeak;

  console.log(`Data size:     1,000,000 elements`);
  console.log(`RxJS Memory:   ${(rxjsMemPeak / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Nagare Memory: ${(nagareMemPeak / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Memory Ratio:  ${memoryRatio.toFixed(2)}x`);
  console.log(`Winner:        ${memoryRatio > 1 ? '🏆 Nagare (less memory)' : '🏆 RxJS (less memory)'}`);
}

async function main() {
  console.log('🚀 Nagare vs RxJS Performance Comparison');
  console.log('═'.repeat(60));
  console.log(`Platform:      ${process.platform} ${process.arch}`);
  console.log(`Node:          ${process.version}`);
  console.log(`Iterations:    ${ITERATIONS} per test`);
  console.log(`Date:          ${new Date().toISOString()}`);

  await benchmarkMapFilter();
  await benchmarkComplexPipeline();
  await benchmarkScan();
  await benchmarkMerge();
  await benchmarkCreationOverhead();
  await benchmarkMemoryEfficiency();

  console.log('\n' + '═'.repeat(60));
  console.log('✨ Benchmark complete!');
  console.log('\n📌 Note: These benchmarks run in pure JavaScript mode.');
  console.log('   WASM/SIMD optimizations would show even better performance');
  console.log('   for numeric operations and Float32Array processing.');
}

main().catch(console.error);