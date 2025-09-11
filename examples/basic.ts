import { river } from '../src/index';
import { CreditController } from '../src/backpressure';

async function basicExample() {
  console.log('🌊 Nagare Basic Examples\n');

  // Example 1: Simple transformation pipeline
  console.log('1️⃣ Simple Pipeline:');
  const result1 = await river
    .range(1, 10)
    .map(x => x * 2)
    .filter(x => x > 10)
    .take(3)
    .toArray();
  console.log('Result:', result1); // [12, 14, 16]

  // Example 2: Observable pattern with AbortSignal
  console.log('\n2️⃣ Observable Pattern:');
  const controller = new AbortController();
  const values: number[] = [];
  
  const subscription = river
    .interval(100)
    .take(5)
    .observe(
      value => values.push(value),
      {
        signal: controller.signal,
        onComplete: () => console.log('Stream completed!'),
      }
    );

  await new Promise(resolve => setTimeout(resolve, 600));
  console.log('Observed values:', values);
  subscription.unsubscribe();

  // Example 3: Fork and merge streams
  console.log('\n3️⃣ Fork & Merge:');
  const source = river.range(1, 10);
  const [evens, odds] = source.fork(x => x % 2 === 0);
  
  const evenSum = await evens.scan((acc, x) => acc + x, 0).last();
  const oddSum = await odds.scan((acc, x) => acc + x, 0).last();
  
  console.log('Sum of evens:', evenSum); // 20
  console.log('Sum of odds:', oddSum);   // 25

  // Example 4: Windowed aggregation
  console.log('\n4️⃣ Windowed Aggregation:');
  const windowedMean = await river
    .of(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
    .windowedAggregate(3, 'mean')
    .toArray();
  console.log('Rolling mean (window=3):', windowedMean);

  // Example 5: Credit-based flow control
  console.log('\n5️⃣ Backpressure Control:');
  const credits = new CreditController(10);
  
  for (let i = 0; i < 15; i++) {
    if (credits.consumeCredit(1)) {
      console.log(`✅ Processed item ${i} (credits: ${credits.availableCredits()})`);
    } else {
      console.log(`⏸️  Backpressure at item ${i}`);
      credits.addCredits(5);
      console.log(`   Added 5 credits (now: ${credits.availableCredits()})`);
    }
  }

  // Example 6: Error handling with rescue
  console.log('\n6️⃣ Error Handling:');
  const withErrors = await river
    .of(1, 2, 3, 4, 5)
    .map(x => {
      if (x === 3) throw new Error('Error at 3');
      return x * 10;
    })
    .rescue(error => {
      console.log('  Caught error, returning -1');
      return -1;
    })
    .toArray();
  console.log('Result with error handling:', withErrors);

  // Example 7: Stream from Promise
  console.log('\n7️⃣ Promise to Stream:');
  const fromPromise = await river
    .fromPromise(Promise.resolve(42))
    .map(x => x * 2)
    .toArray();
  console.log('From promise:', fromPromise); // [84]

  // Example 8: Combine multiple streams
  console.log('\n8️⃣ Combine Streams:');
  const combined = await river
    .combine(
      river.of(1, 2, 3),
      river.of('a', 'b', 'c'),
      river.of(true, false, true)
    )
    .take(2)
    .toArray();
  console.log('Combined streams:', combined);
}

async function wasmExample() {
  console.log('\n🚀 WASM/SIMD Examples\n');

  // Example 9: SIMD processing
  console.log('9️⃣ SIMD Float32 Processing:');
  const data = new Float32Array([1.0, 2.0, 3.0, 4.0, 5.0]);
  
  const wasmRiver = await river
    .from([data])
    .mapWasm('f32x_map_mul_add', { a: 2.0, b: 1.5 });
  
  const processed = await wasmRiver.toArray();
  
  console.log('Original:', Array.from(data));
  console.log('Processed (x*2 + 1.5):', Array.from(processed[0] as Float32Array));
}

async function streamExample() {
  console.log('\n🔄 Web Streams Examples\n');

  // Example 10: ReadableStream conversion
  console.log('🔟 Web Streams Integration:');
  
  const readable = new ReadableStream<number>({
    start(controller) {
      for (let i = 0; i < 5; i++) {
        controller.enqueue(i);
      }
      controller.close();
    },
  });

  const transformed = river
    .fromReadableStream(readable)
    .map(x => x ** 2)
    .toReadableStream();

  const reader = transformed.getReader();
  const values: number[] = [];
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    values.push(value);
  }
  
  console.log('Squared via streams:', values); // [0, 1, 4, 9, 16]
}

// Run all examples
(async () => {
  try {
    await basicExample();
    await wasmExample();
    await streamExample();
    
    console.log('\n✨ All examples completed successfully!');
  } catch (error) {
    console.error('Error running examples:', error);
  }
})();