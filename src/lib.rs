use wasm_bindgen::prelude::*;
use js_sys::{Uint8Array, Float32Array, Float64Array, ArrayBuffer};

// Heavy modules are behind feature flags; minimal web build does not compile them
#[cfg(feature = "river")]
pub mod river;
pub mod operators;
pub mod backpressure;
#[cfg(feature = "byob")]
pub mod byob;
#[cfg(feature = "serialization")]
pub mod serialization;
#[cfg(feature = "simd")]
pub mod simd_ops;

// console logging bindings/macroは未使用のため削除

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

// Heavy River API is only available with feature = "river" (disabled in web_min)

// No Subscription in minimal build

#[wasm_bindgen]
pub fn process_float32_batch(data: &Float32Array, operation: &str) -> Float32Array {
    // Delegate to operators module (pure Rust)
    operators::process_float32_batch(data, operation)
}

#[wasm_bindgen]
pub fn process_float64_batch(data: &Float64Array, operation: &str) -> Float64Array {
    operators::process_float64_batch(data, operation)
}

#[wasm_bindgen]
pub fn encode_postcard(_value: JsValue) -> Result<Uint8Array, JsValue> {
    // Minimal stub: return empty bytes in web_min
    Ok(Uint8Array::new_with_length(0))
}

#[wasm_bindgen]
pub fn decode_postcard(_bytes: &Uint8Array) -> Result<JsValue, JsValue> {
    // Minimal stub: return undefined
    Ok(JsValue::UNDEFINED)
}

#[wasm_bindgen]
pub struct CreditController {
    inner: backpressure::CreditManager,
}

#[wasm_bindgen]
impl CreditController {
    #[wasm_bindgen(constructor)]
    pub fn new(initial_credits: u32) -> Self {
        Self {
            inner: backpressure::CreditManager::new(initial_credits),
        }
    }

    #[wasm_bindgen(js_name = consumeCredit)]
    pub fn consume_credit(&mut self, amount: u32) -> bool {
        self.inner.consume(amount)
    }

    #[wasm_bindgen(js_name = addCredits)]
    pub fn add_credits(&mut self, amount: u32) {
        self.inner.add(amount);
    }

    #[wasm_bindgen(js_name = availableCredits)]
    pub fn available_credits(&self) -> u32 {
        self.inner.available()
    }
}

// BYOB helpers (minimal) used by TS BYOB utilities
#[wasm_bindgen]
pub fn create_zero_copy_view(buffer: &ArrayBuffer) -> Uint8Array {
    js_sys::Uint8Array::new(buffer)
}

#[wasm_bindgen]
pub fn create_float32_view(buffer: &ArrayBuffer) -> Float32Array {
    js_sys::Float32Array::new(buffer)
}

#[wasm_bindgen]
pub fn create_float64_view(buffer: &ArrayBuffer) -> Float64Array {
    js_sys::Float64Array::new(buffer)
}
