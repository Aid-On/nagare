#!/usr/bin/env node

import { Nagare } from '../dist/index.mjs';

console.log('Testing Large Object Processing with error handling...\n');

async function testObjectProcessing(size) {
  console.log(`Testing ${size.toLocaleString()} objects...`);
  
  try {
    // Create objects incrementally to track memory usage
    console.log('Creating objects...');
    const objects = [];
    
    for (let i = 0; i < size; i++) {
      objects.push({
        id: i,
        value: Math.random() * 1000,
        active: i % 2 === 0
      });
      
      // Progress indicator for large arrays
      if (i % 100000 === 0 && i > 0) {
        console.log(`  Progress: ${(i/size*100).toFixed(1)}% (${i.toLocaleString()} objects)`);
      }
    }
    console.log('✅ Objects created successfully');

    // Test Native JS
    console.log('Testing Native JS...');
    const nativeStart = performance.now();
    const nativeResult = objects
      .filter(obj => obj.active)
      .map(obj => ({ ...obj, value: obj.value * 1.1 }))
      .filter(obj => obj.value > 100)
      .map(obj => obj.value);
    const nativeTime = performance.now() - nativeStart;
    console.log(`Native JS: ${nativeTime.toFixed(2)}ms, results: ${nativeResult.length}`);

    // Test Nagare
    console.log('Testing Nagare...');
    const nagareStart = performance.now();
    const nagareResult = await Nagare.from(objects)
      .filter(obj => obj.active)
      .map(obj => ({ ...obj, value: obj.value * 1.1 }))
      .filter(obj => obj.value > 100)
      .map(obj => obj.value)
      .toArray();
    const nagareTime = performance.now() - nagareStart;
    console.log(`Nagare: ${nagareTime.toFixed(2)}ms, results: ${nagareResult.length}`);

    return { nativeTime, nagareTime, resultCount: nagareResult.length };

  } catch (error) {
    console.error(`❌ Error with ${size} objects:`, error.message);
    return null;
  }
}

// Test different sizes to find the breaking point
const sizes = [10000, 100000, 500000, 1000000];

for (const size of sizes) {
  const result = await testObjectProcessing(size);
  if (!result) {
    console.log(`\n💥 Breaking point found at ${size.toLocaleString()} objects`);
    break;
  }
  console.log(`✅ Success: Native ${result.nativeTime.toFixed(2)}ms, Nagare ${result.nagareTime.toFixed(2)}ms\n`);
}