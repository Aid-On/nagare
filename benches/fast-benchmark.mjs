#!/usr/bin/env node

import { FastNagare } from '../dist/index.mjs';

const DATA_SIZE = 100000;

console.log(`📊 Fast Benchmark Results (${DATA_SIZE.toLocaleString()} elements):\n`);

// Create test data
const data = Array.from({ length: DATA_SIZE }, (_, i) => i);

// Native JS
const start1 = performance.now();
const nativeResult = data
  .map(x => x * 2)
  .filter(x => x % 3 === 0);
const nativeTime = performance.now() - start1;

// Fast Nagare 
const start2 = performance.now();
const nagareResult = await FastNagare
  .from(data)
  .map(x => x * 2)
  .filter(x => x % 3 === 0)
  .toArray();
const nagareTime = performance.now() - start2;

const speedup = nativeTime / nagareTime;

console.log(`Fast Nagare: ${nagareTime.toFixed(2)}ms`);
console.log(`Native JS: ${nativeTime.toFixed(2)}ms`);
console.log(`Speedup: ${speedup.toFixed(2)}x`);

console.log(`\n✅ Final value: ${nagareResult[nagareResult.length - 1]}`);

// Verify results match
if (nativeResult.length !== nagareResult.length) {
  console.error('❌ Results do not match!');
} else {
  console.log('✅ Results match!');
}