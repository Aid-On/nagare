#!/usr/bin/env node

import { River } from '../src/river.ts';
import * as rxjs from 'rxjs';
import * as operators from 'rxjs/operators';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

console.log(`${colors.bright}${colors.cyan}🚀 Production Performance Benchmark: Nagare vs RxJS${colors.reset}`);
console.log('═'.repeat(70));
console.log(`Platform:       ${process.platform} ${process.arch}`);
console.log(`Node:           ${process.version}`);
console.log(`Date:           ${new Date().toISOString()}`);
console.log('═'.repeat(70));

// Performance measurement utilities
const measure = async (name, fn, iterations = 5) => {
  // Warmup
  for (let i = 0; i < 3; i++) await fn();
  
  const times = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times.push(performance.now() - start);
  }
  
  times.sort((a, b) => a - b);
  return {
    median: times[Math.floor(times.length / 2)],
    min: times[0],
    max: times[times.length - 1],
    avg: times.reduce((a, b) => a + b, 0) / times.length,
  };
};

const runBenchmark = async (name, dataSize, nagareSetup, rxjsSetup) => {
  console.log(`\n${colors.bright}📊 ${name}${colors.reset}`);
  console.log('━'.repeat(70));
  console.log(`Data size:      ${dataSize.toLocaleString()} elements`);
  
  const nagareResult = await measure('Nagare', nagareSetup);
  const rxjsResult = await measure('RxJS', rxjsSetup);
  
  const speedup = rxjsResult.median / nagareResult.median;
  const winner = speedup > 1 ? 'Nagare' : 'RxJS';
  const color = speedup > 1 ? colors.green : colors.red;
  
  console.log(`\nNagare:`);
  console.log(`  Median:       ${nagareResult.median.toFixed(3)}ms`);
  console.log(`  Min/Max:      ${nagareResult.min.toFixed(3)}ms / ${nagareResult.max.toFixed(3)}ms`);
  console.log(`  Throughput:   ${(dataSize / nagareResult.median / 1000).toFixed(2)}M ops/s`);
  
  console.log(`\nRxJS:`);
  console.log(`  Median:       ${rxjsResult.median.toFixed(3)}ms`);
  console.log(`  Min/Max:      ${rxjsResult.min.toFixed(3)}ms / ${rxjsResult.max.toFixed(3)}ms`);
  console.log(`  Throughput:   ${(dataSize / rxjsResult.median / 1000).toFixed(2)}M ops/s`);
  
  console.log(`\n${color}Performance:    ${speedup > 1 ? speedup.toFixed(2) + 'x faster' : (1/speedup).toFixed(2) + 'x slower'}${colors.reset}`);
  console.log(`Winner:         ${color}🏆 ${winner}${colors.reset}`);
  
  return { winner, speedup };
};

// Benchmarks
const benchmarks = async () => {
  const results = [];
  
  // 1. Simple transformation (1M elements)
  const data1M = Array.from({ length: 1_000_000 }, (_, i) => i);
  results.push(await runBenchmark(
    'Simple Transformation (1M elements)',
    1_000_000,
    async () => {
      const river = River.from(data1M)
        .map(x => x * 2)
        .filter(x => x % 3 === 0);
      await river.toArray();
    },
    async () => {
      await rxjs.firstValueFrom(
        rxjs.from(data1M).pipe(
          operators.map(x => x * 2),
          operators.filter(x => x % 3 === 0),
          operators.toArray()
        )
      );
    }
  ));
  
  // 2. Heavy computation pipeline (500K elements)
  const data500K = Array.from({ length: 500_000 }, (_, i) => i);
  results.push(await runBenchmark(
    'Heavy Computation Pipeline (500K elements)',
    500_000,
    async () => {
      const river = River.from(data500K)
        .map(x => Math.sqrt(x))
        .filter(x => x > 100)
        .map(x => Math.floor(x * 1000))
        .scan((acc, x) => acc + x, 0)
        .filter(x => x % 2 === 0);
      await river.toArray();
    },
    async () => {
      await rxjs.firstValueFrom(
        rxjs.from(data500K).pipe(
          operators.map(x => Math.sqrt(x)),
          operators.filter(x => x > 100),
          operators.map(x => Math.floor(x * 1000)),
          operators.scan((acc, x) => acc + x, 0),
          operators.filter(x => x % 2 === 0),
          operators.toArray()
        )
      );
    }
  ));
  
  // 3. Batch processing (2M elements, batch size 1000)
  const data2M = Array.from({ length: 2_000_000 }, (_, i) => i);
  results.push(await runBenchmark(
    'Batch Processing (2M elements, batch 1000)',
    2_000_000,
    async () => {
      const river = River.from(data2M)
        .buffer(1000)
        .map(batch => batch.reduce((a, b) => a + b, 0))
        .filter(sum => sum > 10000);
      await river.toArray();
    },
    async () => {
      await rxjs.firstValueFrom(
        rxjs.from(data2M).pipe(
          operators.bufferCount(1000),
          operators.map(batch => batch.reduce((a, b) => a + b, 0)),
          operators.filter(sum => sum > 10000),
          operators.toArray()
        )
      );
    }
  ));
  
  // 4. Real-world scenario: Data processing pipeline (100K records)
  const records = Array.from({ length: 100_000 }, (_, i) => ({
    id: i,
    value: Math.random() * 1000,
    category: ['A', 'B', 'C'][i % 3],
    timestamp: Date.now() + i * 1000,
  }));
  
  results.push(await runBenchmark(
    'Real-world Data Pipeline (100K records)',
    100_000,
    async () => {
      const river = River.from(records)
        .filter(r => r.category !== 'B')
        .map(r => ({ ...r, value: r.value * 1.1 }))
        .filter(r => r.value > 100)
        .map(r => r.value)
        .scan((acc, val) => acc + val, 0);
      await river.toArray();
    },
    async () => {
      await rxjs.firstValueFrom(
        rxjs.from(records).pipe(
          operators.filter(r => r.category !== 'B'),
          operators.map(r => ({ ...r, value: r.value * 1.1 })),
          operators.filter(r => r.value > 100),
          operators.map(r => r.value),
          operators.scan((acc, val) => acc + val, 0),
          operators.toArray()
        )
      );
    }
  ));
  
  // 5. Stream merging (3 streams × 100K elements each)
  const stream1 = Array.from({ length: 100_000 }, (_, i) => i * 3);
  const stream2 = Array.from({ length: 100_000 }, (_, i) => i * 5);
  const stream3 = Array.from({ length: 100_000 }, (_, i) => i * 7);
  
  results.push(await runBenchmark(
    'Stream Merging (3 × 100K elements)',
    300_000,
    async () => {
      const r1 = River.from(stream1);
      const r2 = River.from(stream2);
      const r3 = River.from(stream3);
      const merged = r1.merge(r2, r3)
        .filter(x => x % 2 === 0)
        .map(x => x * 2);
      await merged.toArray();
    },
    async () => {
      await rxjs.firstValueFrom(
        rxjs.merge(
          rxjs.from(stream1),
          rxjs.from(stream2),
          rxjs.from(stream3)
        ).pipe(
          operators.filter(x => x % 2 === 0),
          operators.map(x => x * 2),
          operators.toArray()
        )
      );
    }
  ));
  
  return results;
};

// Run benchmarks and show results
(async () => {
  console.log('\n⏳ Starting comprehensive benchmark suite...\n');
  
  const results = await benchmarks();
  
  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log(`${colors.bright}📊 FINAL RESULTS${colors.reset}`);
  console.log('━'.repeat(70));
  
  const nagareWins = results.filter(r => r.winner === 'Nagare').length;
  const rxjsWins = results.filter(r => r.winner === 'RxJS').length;
  const avgSpeedup = results.reduce((acc, r) => acc + r.speedup, 0) / results.length;
  
  console.log(`Nagare Wins:    ${nagareWins} / ${results.length}`);
  console.log(`RxJS Wins:      ${rxjsWins} / ${results.length}`);
  console.log(`Average Speedup: ${avgSpeedup.toFixed(2)}x`);
  
  if (nagareWins > rxjsWins) {
    console.log(`\n${colors.green}${colors.bright}🏆 OVERALL WINNER: NAGARE! 🎉${colors.reset}`);
    console.log(`${colors.cyan}Nagare demonstrates superior performance in production scenarios!${colors.reset}`);
  } else if (rxjsWins > nagareWins) {
    console.log(`\n${colors.yellow}🏆 OVERALL WINNER: RxJS${colors.reset}`);
    console.log('Further optimizations needed for Nagare.');
  } else {
    console.log(`\n${colors.yellow}🤝 It's a tie!${colors.reset}`);
  }
  
  console.log('\n✨ Benchmark complete!\n');
})();