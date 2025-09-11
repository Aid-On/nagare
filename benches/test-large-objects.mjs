#!/usr/bin/env node

import { Nagare } from '../dist/index.mjs';

console.log('Testing Large Object Processing (1M objects)...\n');

try {
  // Create 1M objects
  console.log('Creating 1M objects...');
  const objects = [];
  for (let i = 0; i < 1000000; i++) {
    objects.push({
      id: i,
      value: Math.random() * 1000,
      active: i % 2 === 0
    });
  }
  console.log('✅ Objects created');

  // Test Nagare
  console.log('\nTesting Nagare...');
  const nagareStart = performance.now();
  const nagareResult = await Nagare.from(objects)
    .filter(obj => obj.active)
    .map(obj => ({ ...obj, value: obj.value * 1.1 }))
    .filter(obj => obj.value > 100)
    .map(obj => obj.value)
    .toArray();
  const nagareTime = performance.now() - nagareStart;

  console.log(`Nagare: ${nagareTime.toFixed(2)}ms`);
  console.log(`Results: ${nagareResult.length} items`);
  console.log(`First 3: ${nagareResult.slice(0, 3)}`);

} catch (error) {
  console.error('❌ Error:', error.message);
  console.error('Stack trace:', error.stack);
}