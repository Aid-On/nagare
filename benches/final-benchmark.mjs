#!/usr/bin/env node

import { Nagare } from '../dist/index.mjs';

console.log('🚀 Performance Test');
console.log('Compare Nagare with native JavaScript array methods\n');

const testSizes = [10000, 100000, 1000000];

for (const size of testSizes) {
  console.log(`📊 Benchmark Results (${size.toLocaleString()} elements):`);
  
  // Create test data
  const data = Array.from({ length: size }, (_, i) => i);

  // Native JS
  const start1 = performance.now();
  const nativeResult = data
    .map(x => x * 2)
    .filter(x => x % 3 === 0);
  const nativeTime = performance.now() - start1;

  // Nagare 
  const start2 = performance.now();
  const nagareResult = await Nagare
    .from(data)
    .map(x => x * 2)
    .filter(x => x % 3 === 0)
    .toArray();
  const nagareTime = performance.now() - start2;

  const speedup = nativeTime / nagareTime;

  console.log(`Nagare: ${nagareTime.toFixed(2)}ms`);
  console.log(`Native JS: ${nativeTime.toFixed(2)}ms`);
  console.log(`Speedup: ${speedup.toFixed(2)}x${speedup > 1 ? ' faster 🚀' : ' slower'}`);
  
  // Verify results match
  if (nativeResult.length !== nagareResult.length) {
    console.error('❌ Results do not match!');
  } else {
    console.log('✅ Results match!');
  }
  
  console.log('');
}