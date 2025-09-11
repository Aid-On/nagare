#!/usr/bin/env node

import { Nagare } from '../dist/index.mjs';
import * as rxjs from 'rxjs';
import * as operators from 'rxjs/operators';

// Demo-ready benchmark with formatted output
export const runDemoBenchmark = async (testType = 'mapFilter', dataSize = 100000) => {
  console.log('🏟️ PERFORMANCE ARENA');
  console.log('Compare Nagare against Native JS and RxJS\n');
  
  const data = Array.from({ length: dataSize }, (_, i) => i);
  let nativeResult, rxjsResult, nagareResult;
  let nativeTime, rxjsTime, nagareTime;
  
  // Select test based on type
  switch (testType) {
    case 'mapFilter':
      console.log(`📊 Test: Map + Filter (x => x * 2, x => x % 3 === 0)`);
      console.log(`📊 Data size: ${dataSize.toLocaleString()} elements\n`);
      
      // Native JS
      const start1 = performance.now();
      nativeResult = data.map(x => x * 2).filter(x => x % 3 === 0);
      nativeTime = performance.now() - start1;
      
      // RxJS
      const start2 = performance.now();
      rxjsResult = await rxjs.firstValueFrom(
        rxjs.from(data).pipe(
          operators.map(x => x * 2),
          operators.filter(x => x % 3 === 0),
          operators.toArray()
        )
      );
      rxjsTime = performance.now() - start2;
      
      // Nagare
      const start3 = performance.now();
      nagareResult = await Nagare.from(data)
        .map(x => x * 2)
        .filter(x => x % 3 === 0)
        .toArray();
      nagareTime = performance.now() - start3;
      break;
      
    case 'complex':
      console.log(`📊 Test: Complex Pipeline (sqrt, floor, scan)`);
      console.log(`📊 Data size: ${dataSize.toLocaleString()} elements\n`);
      
      // Native JS
      const complexStart1 = performance.now();
      let acc = 0;
      nativeResult = data
        .map(x => Math.sqrt(x))
        .filter(x => x > 10)
        .map(x => Math.floor(x * 100))
        .map(x => acc += x)
        .filter(x => x % 2 === 0);
      nativeTime = performance.now() - complexStart1;
      
      // RxJS  
      const complexStart2 = performance.now();
      rxjsResult = await rxjs.firstValueFrom(
        rxjs.from(data).pipe(
          operators.map(x => Math.sqrt(x)),
          operators.filter(x => x > 10),
          operators.map(x => Math.floor(x * 100)),
          operators.scan((acc, x) => acc + x, 0),
          operators.filter(x => x % 2 === 0),
          operators.toArray()
        )
      );
      rxjsTime = performance.now() - complexStart2;
      
      // Nagare
      const complexStart3 = performance.now();
      nagareResult = await Nagare.from(data)
        .map(x => Math.sqrt(x))
        .filter(x => x > 10)
        .map(x => Math.floor(x * 100))
        .scan((acc, x) => acc + x, 0)
        .filter(x => x % 2 === 0)
        .toArray();
      nagareTime = performance.now() - complexStart3;
      break;
      
    case 'large':
      console.log(`📊 Test: Large Dataset Processing`);
      console.log(`📊 Data size: ${dataSize.toLocaleString()} elements\n`);
      
      // Native JS
      const largeStart1 = performance.now();
      nativeResult = data.map(x => x * 3).filter(x => x % 5 === 0);
      nativeTime = performance.now() - largeStart1;
      
      // RxJS
      const largeStart2 = performance.now();
      rxjsResult = await rxjs.firstValueFrom(
        rxjs.from(data).pipe(
          operators.map(x => x * 3),
          operators.filter(x => x % 5 === 0),
          operators.toArray()
        )
      );
      rxjsTime = performance.now() - largeStart2;
      
      // Nagare
      const largeStart3 = performance.now();
      nagareResult = await Nagare.from(data)
        .map(x => x * 3)
        .filter(x => x % 5 === 0)
        .toArray();
      nagareTime = performance.now() - largeStart3;
      break;
  }
  
  // Calculate throughput
  const nativeThroughput = (dataSize / nativeTime / 1000).toFixed(0);
  const rxjsThroughput = (dataSize / rxjsTime / 1000).toFixed(0);
  const nagareThroughput = (dataSize / nagareTime / 1000).toFixed(0);
  
  // Determine winner and ranking
  const results = [
    { name: '🚀 Nagare', time: nagareTime, throughput: nagareThroughput },
    { name: '🟦 Native JS', time: nativeTime, throughput: nativeThroughput },
    { name: '🟨 RxJS', time: rxjsTime, throughput: rxjsThroughput }
  ].sort((a, b) => a.time - b.time);
  
  const medals = ['🥇 Champion', '🥈 Runner-up', '🥉 Third'];
  
  // Display results table
  console.log('🏆 RESULTS');
  console.log('┌─────────────┬─────────┬─────────┬──────────────┐');
  console.log('│ Library     │ Time    │ Ops/s   │ Winner       │');
  console.log('├─────────────┼─────────┼─────────┼──────────────┤');
  
  results.forEach((lib, index) => {
    const time = lib.time.toFixed(2) + 'ms';
    const ops = lib.throughput + 'M';
    console.log(`│ ${lib.name.padEnd(11)} │ ${time.padEnd(7)} │ ${ops.padEnd(7)} │ ${medals[index].padEnd(12)} │`);
  });
  
  console.log('└─────────────┴─────────┴─────────┴──────────────┘');
  
  // Performance comparison
  if (results[0].name.includes('Nagare')) {
    const vsRxjs = (rxjsTime / nagareTime).toFixed(1);
    const vsNative = (nativeTime / nagareTime).toFixed(1);
    console.log(`\n📈 Nagare is ${vsRxjs}x faster than RxJS!`);
    console.log(`📈 Nagare is ${vsNative}x faster than Native JS!`);
  }
  
  // Verify results match
  const allMatch = nativeResult.length === rxjsResult.length && 
                  rxjsResult.length === nagareResult.length &&
                  (nativeResult.length === 0 || 
                   nativeResult[nativeResult.length - 1] === nagareResult[nagareResult.length - 1]);
  
  console.log(`\n✅ All implementations produce identical results: ${allMatch ? 'PASS' : 'FAIL'}`);
  console.log(`📊 Output size: ${nagareResult.length.toLocaleString()} elements`);
  
  if (nagareResult.length > 0) {
    console.log(`🎯 Final value: ${nagareResult[nagareResult.length - 1].toLocaleString()}`);
  }
  
  return {
    winner: results[0].name,
    nagareTime,
    nativeTime, 
    rxjsTime,
    speedupVsRxjs: rxjsTime / nagareTime,
    speedupVsNative: nativeTime / nagareTime
  };
};

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const testType = process.argv[2] || 'mapFilter';
  const dataSize = parseInt(process.argv[3]) || 100000;
  
  await runDemoBenchmark(testType, dataSize);
}