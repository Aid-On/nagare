/**
 * Test setup for nagare
 */

// Polyfill for test environment
if (typeof ReadableStream === "undefined") {
  const { ReadableStream } = require("stream/web");
  global.ReadableStream = ReadableStream;
}

if (typeof TransformStream === "undefined") {
  const { TransformStream } = require("stream/web");
  global.TransformStream = TransformStream;
}

if (typeof WritableStream === "undefined") {
  const { WritableStream } = require("stream/web");
  global.WritableStream = WritableStream;
}

// Mock fetch for tests
global.fetch = global.fetch || (() => {
  throw new Error("Fetch not available in test environment");
});