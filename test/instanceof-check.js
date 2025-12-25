// Quick JavaScript test to verify instanceof works correctly
import { stream } from '../dist/index.js';

console.log('Testing instanceof ReadableStream...');
const myStream = stream.array([1, 2, 3]);

const isReadableStream = myStream instanceof ReadableStream;
console.log(`stream.array([1,2,3]) instanceof ReadableStream: ${isReadableStream}`);

if (!isReadableStream) {
  console.error('❌ FAILED: Stream is not instanceof ReadableStream');
  process.exit(1);
} else {
  console.log('✅ PASSED: Stream is instanceof ReadableStream');
}

// Test that it can be passed to Response
try {
  new Response(myStream);
  console.log('✅ PASSED: Stream can be passed to Response constructor');
} catch (error) {
  console.error('❌ FAILED: Stream cannot be passed to Response constructor');
  console.error(error);
  process.exit(1);
}

// Test that Stream methods still work
if (typeof myStream.map === 'function') {
  console.log('✅ PASSED: Stream.map method exists');
} else {
  console.error('❌ FAILED: Stream.map method does not exist');
  process.exit(1);
}

console.log('\nAll instanceof checks passed! 🎉');