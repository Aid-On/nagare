#!/usr/bin/env node

import { Nagare } from '../dist/index.mjs';

const DATA_SIZE = 10000; // Smaller for debugging

console.log(`📊 Debug Benchmark Results (${DATA_SIZE.toLocaleString()} elements):\n`);

// Create test data
const data = Array.from({ length: DATA_SIZE }, (_, i) => i);

// Native JS
console.log('Testing Native JS...');
const start1 = performance.now();
const nativeResult = data
  .map(x => x * 2)
  .filter(x => x % 3 === 0);
const nativeTime = performance.now() - start1;

// Nagare - step by step
console.log('Testing Nagare step by step...');

console.log('1. Creating Nagare.from(data)...');
const start2a = performance.now();
const nagareStream = Nagare.from(data);
const time2a = performance.now() - start2a;
console.log(`   Time: ${time2a.toFixed(2)}ms`);

console.log('2. Adding .map(x => x * 2)...');
const start2b = performance.now();
const mapped = nagareStream.map(x => x * 2);
const time2b = performance.now() - start2b;
console.log(`   Time: ${time2b.toFixed(2)}ms`);

console.log('3. Adding .filter(x => x % 3 === 0)...');
const start2c = performance.now();
const filtered = mapped.filter(x => x % 3 === 0);
const time2c = performance.now() - start2c;
console.log(`   Time: ${time2c.toFixed(2)}ms`);

console.log('4. Calling .toArray()...');
const start2d = performance.now();
const nagareResult = await filtered.toArray();
const time2d = performance.now() - start2d;
console.log(`   Time: ${time2d.toFixed(2)}ms`);

const totalNagareTime = time2a + time2b + time2c + time2d;

console.log(`\nResults:`);
console.log(`Native JS: ${nativeTime.toFixed(2)}ms`);
console.log(`Nagare Total: ${totalNagareTime.toFixed(2)}ms`);
console.log(`  - Setup: ${(time2a + time2b + time2c).toFixed(2)}ms`);
console.log(`  - Execution: ${time2d.toFixed(2)}ms`);

const speedup = nativeTime / totalNagareTime;
console.log(`Speedup: ${speedup.toFixed(2)}x`);

// Verify results match
if (nativeResult.length !== nagareResult.length) {
  console.error('❌ Results do not match!');
  console.log(`Native: ${nativeResult.length}, Nagare: ${nagareResult.length}`);
} else {
  console.log('✅ Results match!');
}