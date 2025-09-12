// let wasmInstance: WebAssembly.Instance | null = null;
export let wasmModule: any = null;

let loadPromise: Promise<void> | null = null;

// Check if we're in test environment
const isTestEnvironment = () => {
  return typeof process !== 'undefined' &&
    (process.env.NODE_ENV === 'test' ||
      process.env.VITEST === 'true' ||
      typeof (globalThis as Record<string, unknown>).describe === 'function');
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
      const forceReal = typeof process !== 'undefined' && process.env.NAGARE_TEST_REAL_WASM === 'true';
      // Use mock WASM module in test environment unless explicitly forced to load real WASM
      if (isTestEnvironment() && !forceReal) {
        console.log('Loading mock WASM module for test environment');
        wasmModule = createMockWasmModule();
        return;
      }

      if (typeof window !== 'undefined') {
        // Browser: load wasm-pack (web target). Pass the .wasm URL to init for bundlers.
        // Use dynamic import with any to avoid type errors when pkg is absent in typecheck
        // @ts-ignore - generated at build time by wasm-bindgen
        const jsPath: string = ['..','/pkg','/nagare.js'].join('');
        // @ts-ignore - generated at build time by wasm-bindgen
        const wasm = (await import(/* @vite-ignore */ jsPath)) as { default?: (u?: unknown) => Promise<void> | void } & Record<string, unknown>;
        const init = wasm.default;
        if (typeof init === 'function') {
          try {
            // Prefer explicit URL so Vite can rewrite asset path
            // @ts-ignore - url emitted by bundler
            const wasmUrlPath: string = ['..','/pkg','/nagare_bg.wasm?url'].join('');
            // @ts-ignore - url emitted by bundler
            const wasmUrl = (await import(/* @vite-ignore */ wasmUrlPath)) as { default: string };
            await init(wasmUrl.default);
          } catch {
            // Fallback to no-arg init (will try to fetch relative to glue script)
            await init();
          }
        }
        wasmModule = wasm;
      } else if (typeof process !== 'undefined' && process.versions?.node) {
        // Node.js: prefer web build if available (for SSR builds, Vite plugin handles assets). Fallback to mock.
        try {
          // First try node-target build (pkg-node)
          try {
            // @ts-ignore - generated at build time by wasm-bindgen
            const nodeJsPath: string = ['..','/pkg-node','/nagare.js'].join('');
            // @ts-ignore - generated at build time by wasm-bindgen
            const wasmNode = (await import(/* @vite-ignore */ nodeJsPath)) as { default?: (u?: unknown) => Promise<void> | void } & Record<string, unknown>;
            const initNode = wasmNode.default;
            if (typeof initNode === 'function') {
              await initNode();
            }
            wasmModule = wasmNode;
          } catch {
            // Fallback to web-target under Node (Node18+ has fetch)
            // @ts-ignore - generated at build time by wasm-bindgen
            const jsPath: string = ['..','/pkg','/nagare.js'].join('');
            // @ts-ignore - generated at build time by wasm-bindgen
            const wasm = (await import(/* @vite-ignore */ jsPath)) as { default?: (u?: unknown) => Promise<void> | void } & Record<string, unknown>;
            const init = wasm.default;
            if (typeof init === 'function') {
              try {
                // @ts-ignore - url emitted by bundler
                const wasmUrlPath: string = ['..','/pkg','/nagare_bg.wasm?url'].join('');
                // @ts-ignore - url emitted by bundler
                const wasmUrl = (await import(/* @vite-ignore */ wasmUrlPath)) as { default: string };
                await init(wasmUrl.default);
              } catch {
                await init();
              }
            }
            wasmModule = wasm;
          }
        } catch (e) {
          if (isTestEnvironment()) {
            console.warn('WASM (node) not configured, using mock');
            wasmModule = createMockWasmModule();
          } else {
            throw e;
          }
        }
      } else {
        // Other environment - would load from pkg folder
        // @ts-ignore - generated at build time by wasm-bindgen
        const jsPath: string = ['..','/pkg','/nagare.js'].join('');
        // @ts-ignore - generated at build time by wasm-bindgen
        const wasm = (await import(/* @vite-ignore */ jsPath)) as { default?: (u?: unknown) => Promise<void> | void } & Record<string, unknown>;
        const init = wasm.default;
        if (typeof init === 'function') {
          try {
            // @ts-ignore - url emitted by bundler
            const wasmUrlPath: string = ['..','/pkg','/nagare_bg.wasm?url'].join('');
            // @ts-ignore - url emitted by bundler
            const wasmUrl = (await import(/* @vite-ignore */ wasmUrlPath)) as { default: string };
            await init(wasmUrl.default);
          } catch {
            await init();
          }
        }
        wasmModule = wasm;
      }
    } catch (error) {
      if (isTestEnvironment() && !(typeof process !== 'undefined' && process.env.NAGARE_TEST_REAL_WASM === 'true')) {
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
