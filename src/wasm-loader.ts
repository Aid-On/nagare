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
        // Browser: load wasm-pack (web target) output via Vite's wasm plugin
        const wasm = await import('../pkg/nagare.js');
        if (typeof (wasm as any).default === 'function') {
          await (wasm as any).default();
        }
        wasmModule = wasm;
      } else if (typeof process !== 'undefined' && process.versions?.node) {
        // Node.js: prefer web build if available (for SSR builds, Vite plugin handles assets). Fallback to mock.
        try {
          const wasm = await import('../pkg/nagare.js');
          if (typeof (wasm as any).default === 'function') {
            await (wasm as any).default();
          }
          wasmModule = wasm;
        } catch {
          console.warn('WASM (node) not configured, using mock');
          wasmModule = createMockWasmModule();
        }
      } else {
        // Other environment - would load from pkg folder
        const wasm = await import('../pkg/nagare.js');
        if (typeof (wasm as any).default === 'function') {
          await (wasm as any).default();
        }
        wasmModule = wasm;
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
