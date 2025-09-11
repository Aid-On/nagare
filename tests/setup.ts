// Test setup file for nagare library
// This file is executed before all test files

import { beforeAll } from 'vitest';

// Mock WASM loading for test environment
// Since WASM files may not exist during testing, we create a mock
let wasmMocked = false;

export function mockWasm() {
  if (wasmMocked) return;
  
  // Mock the WASM loader module
  const mockWasmLoader = {
    loadWasm: async () => {
      // Simulate successful WASM loading
      console.log('WASM loading mocked for tests');
    },
    isWasmLoaded: () => true,
    ensureWasmLoaded: async () => {
      // Already loaded in mock
    },
    wasmModule: {
      // Mock WASM module with basic functionality
      memory: new WebAssembly.Memory({ initial: 1 }),
      // Add other WASM exports as needed
    }
  };

  wasmMocked = true;
  return mockWasmLoader;
}

// Global test setup
beforeAll(() => {
  // Setup test environment
  mockWasm();
});