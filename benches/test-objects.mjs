#!/usr/bin/env node

import { Nagare } from '../dist/index.mjs';
import * as rxjs from 'rxjs';
import * as operators from 'rxjs/operators';

const dataSize = 20000;
const data = Array.from({ length: dataSize }, (_, i) => i);

console.log('Testing Object Processing...\n');

// Create objects for testing
const objects = data.map(i => ({ id: i, value: Math.random() * 1000, active: i % 2 === 0 }));

console.log('Sample object:', objects[0]);
console.log('Objects array length:', objects.length);
console.log('First object is object?', typeof objects[0] === 'object');

// Native JS
console.log('\nTesting Native JS...');
const nativeStart = performance.now();
const nativeResult = objects
  .filter(obj => obj.active)
  .map(obj => ({ ...obj, value: obj.value * 1.1 }))
  .filter(obj => obj.value > 100)
  .map(obj => obj.value);
const nativeTime = performance.now() - nativeStart;
console.log(`Native JS: ${nativeTime.toFixed(2)}ms, results: ${nativeResult.length}`);

// RxJS
console.log('\nTesting RxJS...');
const rxjsStart = performance.now();
const rxjsResult = await rxjs.firstValueFrom(
  rxjs.from(objects).pipe(
    operators.filter(obj => obj.active),
    operators.map(obj => ({ ...obj, value: obj.value * 1.1 })),
    operators.filter(obj => obj.value > 100),
    operators.map(obj => obj.value),
    operators.toArray()
  )
);
const rxjsTime = performance.now() - rxjsStart;
console.log(`RxJS: ${rxjsTime.toFixed(2)}ms, results: ${rxjsResult.length}`);

// Nagare
console.log('\nTesting Nagare...');
const nagareStart = performance.now();
const nagareResult = await Nagare.from(objects)
  .filter(obj => obj.active)
  .map(obj => ({ ...obj, value: obj.value * 1.1 }))
  .filter(obj => obj.value > 100)
  .map(obj => obj.value)
  .toArray();
const nagareTime = performance.now() - nagareStart;
console.log(`Nagare: ${nagareTime.toFixed(2)}ms, results: ${nagareResult.length}`);

console.log('\nFirst 5 results comparison:');
console.log('Native:', nativeResult.slice(0, 5));
console.log('RxJS:', rxjsResult.slice(0, 5));
console.log('Nagare:', nagareResult.slice(0, 5));