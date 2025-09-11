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
        // Browser: load wasm-pack (web target). Pass the .wasm URL to init for bundlers.
        const wasm: any = await import('../pkg/nagare.js');
        const init = wasm.default;
        if (typeof init === 'function') {
          try {
            // Prefer explicit URL so Vite can rewrite asset path
            const wasmUrl: any = (await import('../pkg/nagare_bg.wasm?url')).default;
            await init(wasmUrl);
          } catch {
            // Fallback to no-arg init (will try to fetch relative to glue script)
            await init();
          }
        }
        wasmModule = wasm;
      } else if (typeof process !== 'undefined' && process.versions?.node) {
        // Node.js: prefer web build if available (for SSR builds, Vite plugin handles assets). Fallback to mock.
        try {
          const wasm: any = await import('../pkg/nagare.js');
          const init = wasm.default;
          if (typeof init === 'function') {
            try {
              const wasmUrl: any = (await import('../pkg/nagare_bg.wasm?url')).default;
              await init(wasmUrl);
            } catch {
              await init();
            }
          }
          wasmModule = wasm;
        } catch {
          console.warn('WASM (node) not configured, using mock');
          wasmModule = createMockWasmModule();
        }
      } else {
        // Other environment - would load from pkg folder
        const wasm: any = await import('../pkg/nagare.js');
        const init = wasm.default;
        if (typeof init === 'function') {
          try {
            const wasmUrl: any = (await import('../pkg/nagare_bg.wasm?url')).default;
            await init(wasmUrl);
          } catch {
            await init();
          }
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
