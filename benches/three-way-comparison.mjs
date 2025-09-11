#!/usr/bin/env node

import { Nagare } from '../dist/index.mjs';
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
  magenta: '\x1b[35m',
};

console.log(`${colors.bright}${colors.cyan}🚀 Comprehensive Performance Comparison${colors.reset}`);
console.log(`${colors.bright}Native JavaScript vs RxJS vs Nagare${colors.reset}`);
console.log('═'.repeat(70));
console.log(`Platform:       ${process.platform} ${process.arch}`);
console.log(`Node:           ${process.version}`);
console.log(`Date:           ${new Date().toISOString()}`);
console.log('═'.repeat(70));

// Performance measurement utilities
const measure = async (name, fn, iterations = 5) => {
  // Warmup
  for (let i = 0; i < 2; i++) await fn();
  
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

const runBenchmark = async (name, dataSize, nativeSetup, rxjsSetup, nagareSetup) => {
  console.log(`\n${colors.bright}📊 ${name}${colors.reset}`);
  console.log('━'.repeat(70));
  console.log(`Data size:      ${dataSize.toLocaleString()} elements`);
  
  const nativeResult = await measure('Native JS', nativeSetup);
  const rxjsResult = await measure('RxJS', rxjsSetup);
  const nagareResult = await measure('Nagare', nagareSetup);
  
  // Find the winner
  const times = [
    { name: 'Native JS', time: nativeResult.median, color: colors.blue },
    { name: 'RxJS', time: rxjsResult.median, color: colors.yellow },
    { name: 'Nagare', time: nagareResult.median, color: colors.green }
  ];
  
  times.sort((a, b) => a.time - b.time);
  const fastest = times[0];
  const slowest = times[2];
  
  console.log(`\n${colors.blue}Native JS:${colors.reset}`);
  console.log(`  Median:       ${nativeResult.median.toFixed(2)}ms`);
  console.log(`  Min/Max:      ${nativeResult.min.toFixed(2)}ms / ${nativeResult.max.toFixed(2)}ms`);
  console.log(`  Throughput:   ${(dataSize / nativeResult.median / 1000).toFixed(2)}M ops/s`);
  
  console.log(`\n${colors.yellow}RxJS:${colors.reset}`);
  console.log(`  Median:       ${rxjsResult.median.toFixed(2)}ms`);
  console.log(`  Min/Max:      ${rxjsResult.min.toFixed(2)}ms / ${rxjsResult.max.toFixed(2)}ms`);
  console.log(`  Throughput:   ${(dataSize / rxjsResult.median / 1000).toFixed(2)}M ops/s`);
  
  console.log(`\n${colors.green}Nagare:${colors.reset}`);
  console.log(`  Median:       ${nagareResult.median.toFixed(2)}ms`);
  console.log(`  Min/Max:      ${nagareResult.min.toFixed(2)}ms / ${nagareResult.max.toFixed(2)}ms`);
  console.log(`  Throughput:   ${(dataSize / nagareResult.median / 1000).toFixed(2)}M ops/s`);
  
  const speedup = slowest.time / fastest.time;
  console.log(`\n${fastest.color}🏆 Winner: ${fastest.name} (${speedup.toFixed(2)}x faster than slowest)${colors.reset}`);
  
  return { winner: fastest.name, times };
};

// Benchmarks
const benchmarks = async () => {
  const results = [];
  
  // 1. Simple Map + Filter (100K elements)
  console.log(`\n${colors.cyan}🧪 Test 1: Simple Transformation Pipeline${colors.reset}`);
  const data100K = Array.from({ length: 100_000 }, (_, i) => i);
  results.push(await runBenchmark(
    'Map + Filter (x => x * 2, x => x % 3 === 0)',
    100_000,
    () => {
      return data100K
        .map(x => x * 2)
        .filter(x => x % 3 === 0);
    },
    async () => {
      return await rxjs.firstValueFrom(
        rxjs.from(data100K).pipe(
          operators.map(x => x * 2),
          operators.filter(x => x % 3 === 0),
          operators.toArray()
        )
      );
    },
    async () => {
      return await Nagare.from(data100K)
        .map(x => x * 2)
        .filter(x => x % 3 === 0)
        .toArray();
    }
  ));
  
  // 2. Heavy Computation Pipeline (50K elements)
  console.log(`\n${colors.cyan}🧪 Test 2: Complex Computation Pipeline${colors.reset}`);
  const data50K = Array.from({ length: 50_000 }, (_, i) => i);
  results.push(await runBenchmark(
    'Multi-step Computation (sqrt, floor, scan)',
    50_000,
    () => {
      let acc = 0;
      return data50K
        .map(x => Math.sqrt(x))
        .filter(x => x > 10)
        .map(x => Math.floor(x * 100))
        .map(x => acc += x)
        .filter(x => x % 2 === 0);
    },
    async () => {
      return await rxjs.firstValueFrom(
        rxjs.from(data50K).pipe(
          operators.map(x => Math.sqrt(x)),
          operators.filter(x => x > 10),
          operators.map(x => Math.floor(x * 100)),
          operators.scan((acc, x) => acc + x, 0),
          operators.filter(x => x % 2 === 0),
          operators.toArray()
        )
      );
    },
    async () => {
      return await Nagare.from(data50K)
        .map(x => Math.sqrt(x))
        .filter(x => x > 10)
        .map(x => Math.floor(x * 100))
        .scan((acc, x) => acc + x, 0)
        .filter(x => x % 2 === 0)
        .toArray();
    }
  ));
  
  // 3. Large Dataset Processing (1M elements)
  console.log(`\n${colors.cyan}🧪 Test 3: Large Dataset Processing${colors.reset}`);
  const data1M = Array.from({ length: 1_000_000 }, (_, i) => i);
  results.push(await runBenchmark(
    'Large Dataset Map + Filter',
    1_000_000,
    () => {
      return data1M
        .map(x => x * 3)
        .filter(x => x % 5 === 0);
    },
    async () => {
      return await rxjs.firstValueFrom(
        rxjs.from(data1M).pipe(
          operators.map(x => x * 3),
          operators.filter(x => x % 5 === 0),
          operators.toArray()
        )
      );
    },
    async () => {
      return await Nagare.from(data1M)
        .map(x => x * 3)
        .filter(x => x % 5 === 0)
        .toArray();
    }
  ));
  
  // 4. Object Processing (20K objects)
  console.log(`\n${colors.cyan}🧪 Test 4: Object Processing Pipeline${colors.reset}`);
  const objects = Array.from({ length: 20_000 }, (_, i) => ({
    id: i,
    value: Math.random() * 1000,
    category: ['A', 'B', 'C'][i % 3],
    active: i % 2 === 0
  }));
  
  results.push(await runBenchmark(
    'Object Transformation + Aggregation',
    20_000,
    () => {
      return objects
        .filter(obj => obj.active && obj.category !== 'B')
        .map(obj => ({ ...obj, value: obj.value * 1.1 }))
        .filter(obj => obj.value > 100)
        .map(obj => obj.value);
    },
    async () => {
      return await rxjs.firstValueFrom(
        rxjs.from(objects).pipe(
          operators.filter(obj => obj.active && obj.category !== 'B'),
          operators.map(obj => ({ ...obj, value: obj.value * 1.1 })),
          operators.filter(obj => obj.value > 100),
          operators.map(obj => obj.value),
          operators.toArray()
        )
      );
    },
    async () => {
      return await Nagare.from(objects)
        .filter(obj => obj.active && obj.category !== 'B')
        .map(obj => ({ ...obj, value: obj.value * 1.1 }))
        .filter(obj => obj.value > 100)
        .map(obj => obj.value)
        .toArray();
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
  console.log(`${colors.bright}📊 FINAL SCOREBOARD${colors.reset}`);
  console.log('━'.repeat(70));
  
  const scores = { 'Native JS': 0, 'RxJS': 0, 'Nagare': 0 };
  results.forEach(r => scores[r.winner]++);
  
  const sortedScores = Object.entries(scores)
    .sort(([,a], [,b]) => b - a)
    .map(([name, wins], index) => {
      const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉';
      const color = name === 'Native JS' ? colors.blue : 
                   name === 'RxJS' ? colors.yellow : colors.green;
      return `${medal} ${color}${name}: ${wins} wins${colors.reset}`;
    });
  
  sortedScores.forEach(score => console.log(score));
  
  const champion = Object.entries(scores).reduce((a, b) => scores[a[0]] > scores[b[0]] ? a : b);
  const championColor = champion[0] === 'Native JS' ? colors.blue : 
                       champion[0] === 'RxJS' ? colors.yellow : colors.green;
  
  console.log(`\n${championColor}${colors.bright}🏆 OVERALL CHAMPION: ${champion[0].toUpperCase()}! 🎉${colors.reset}`);
  
  console.log('\n✨ Benchmark complete!\n');
})();