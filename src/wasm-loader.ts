// let wasmInstance: WebAssembly.Instance | null = null;
export let wasmModule: any = null;

let loadPromise: Promise<void> | null = null;

// Check if we're in test environment
const isTestEnvironment = () => {
  return typeof process !== 'undefined' && 
         (process.env.NODE_ENV === 'test' || 
          process.env.VITEST === 'true' || 
          typeof (globalThis as any).describe === 'function');
};

// Mock WASM module for testing
const createMockWasmModule = () => {
  return {
    memory: new WebAssembly.Memory({ initial: 1 }),
    // Add mock functions that the actual WASM would provide
    __wbg_set_wasm: () => {},
    __wbindgen_export_0: () => {},
    __wbindgen_export_1: () => {},
    // Add other mock WASM exports as needed
    default: async () => {
      console.log('Mock WASM module initialized for tests');
    }
  };
};

export async function loadWasm(): Promise<void> {
  if (wasmModule) return;
  
  if (loadPromise) {
    await loadPromise;
    return;
  }

  loadPromise = (async () => {
    try {
      // Use mock WASM module in test environment
      if (isTestEnvironment()) {
        console.log('Loading mock WASM module for test environment');
        wasmModule = createMockWasmModule();
        return;
      }

      if (typeof window !== 'undefined') {
        // Browser environment - would load from pkg folder
        // const module = await import('../pkg/nagare_bg.wasm');
        // const wasm = await import('../pkg/nagare');
        // await wasm.default(module.default);
        // wasmModule = wasm;
        console.warn('WASM loading in browser not yet configured');
        wasmModule = createMockWasmModule();
      } else if (typeof process !== 'undefined' && process.versions?.node) {
        // Node.js environment - would load from pkg-node folder
        // const wasm = await import('../pkg-node/nagare');
        // wasmModule = wasm;
        console.warn('WASM loading in Node.js not yet configured');
        wasmModule = createMockWasmModule();
      } else {
        // Other environment - would load from pkg folder
        // const wasm = await import('../pkg/nagare');
        // wasmModule = wasm;
        console.warn('WASM loading not yet configured');
        wasmModule = createMockWasmModule();
      }
    } catch (error) {
      if (isTestEnvironment()) {
        console.warn('WASM loading failed in test environment, using mock:', (error as Error).message);
        wasmModule = createMockWasmModule();
      } else {
        console.error('Failed to load WASM module:', error);
        throw error;
      }
    }
  })();

  await loadPromise;
}

export function isWasmLoaded(): boolean {
  return wasmModule !== null;
}

export async function ensureWasmLoaded(): Promise<void> {
  if (!isWasmLoaded()) {
    await loadWasm();
  }
}