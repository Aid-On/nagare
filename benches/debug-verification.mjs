#!/usr/bin/env node

import { Nagare } from '../dist/index.mjs';
import * as rxjs from 'rxjs';
import * as operators from 'rxjs/operators';

const data = Array.from({ length: 100 }, (_, i) => i);

// Native JS
const nativeResult = data.map(x => x * 3).filter(x => x % 5 === 0);

// RxJS
const rxjsResult = await rxjs.firstValueFrom(
  rxjs.from(data).pipe(
    operators.map(x => x * 3),
    operators.filter(x => x % 5 === 0),
    operators.toArray()
  )
);

// Nagare
const nagareResult = await Nagare.from(data)
  .map(x => x * 3)
  .filter(x => x % 5 === 0)
  .toArray();

console.log('Native length:', nativeResult.length);
console.log('RxJS length:', rxjsResult.length);
console.log('Nagare length:', nagareResult.length);

console.log('Native first 10:', nativeResult.slice(0, 10));
console.log('RxJS first 10:', rxjsResult.slice(0, 10));
console.log('Nagare first 10:', nagareResult.slice(0, 10));

console.log('Native last:', nativeResult[nativeResult.length - 1]);
console.log('RxJS last:', rxjsResult[rxjsResult.length - 1]);  
console.log('Nagare last:', nagareResult[nagareResult.length - 1]);

// Check exact equality
const nativeVsRxjs = JSON.stringify(nativeResult) === JSON.stringify(rxjsResult);
const nativeVsNagare = JSON.stringify(nativeResult) === JSON.stringify(nagareResult);
const rxjsVsNagare = JSON.stringify(rxjsResult) === JSON.stringify(nagareResult);

console.log('Native === RxJS:', nativeVsRxjs);
console.log('Native === Nagare:', nativeVsNagare);
console.log('RxJS === Nagare:', rxjsVsNagare);