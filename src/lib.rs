use wasm_bindgen::prelude::*;
use js_sys::{Array, Function, Promise, Uint8Array, Float32Array};
use web_sys::{ReadableStream, WritableStream, AbortSignal};
use std::sync::Arc;
use std::sync::Mutex;
use futures::stream::{Stream, StreamExt};
use std::pin::Pin;
use std::task::{Context, Poll};

pub mod river;
pub mod operators;
pub mod byob;
pub mod serialization;
pub mod backpressure;

#[cfg(feature = "simd")]
pub mod simd_ops;

use river::River;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

#[wasm_bindgen(start)]
pub fn init() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub struct NagareRiver {
    inner: Arc<Mutex<river::RiverCore>>,
}

#[wasm_bindgen]
impl NagareRiver {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(river::RiverCore::new())),
        }
    }

    #[wasm_bindgen(js_name = fromReadableStream)]
    pub fn from_readable_stream(stream: ReadableStream) -> Self {
        let core = river::RiverCore::from_readable_stream(stream);
        Self {
            inner: Arc::new(Mutex::new(core)),
        }
    }

    #[wasm_bindgen(js_name = fromArray)]
    pub fn from_array(array: Array) -> Self {
        let core = river::RiverCore::from_js_array(array);
        Self {
            inner: Arc::new(Mutex::new(core)),
        }
    }

    #[wasm_bindgen(js_name = fromTypedArray)]
    pub fn from_typed_array(array: &Uint8Array) -> Self {
        let core = river::RiverCore::from_typed_array(array);
        Self {
            inner: Arc::new(Mutex::new(core)),
        }
    }

    #[wasm_bindgen]
    pub fn observe(
        &self,
        next: Function,
        error: Option<Function>,
        complete: Option<Function>,
        signal: Option<AbortSignal>,
    ) -> Subscription {
        let sub = self.inner.lock().unwrap().observe(
            next,
            error,
            complete,
            signal,
        );
        Subscription { inner: sub }
    }

    #[wasm_bindgen]
    pub fn map(&self, mapper: Function) -> NagareRiver {
        let inner = self.inner.lock().unwrap().map(mapper);
        NagareRiver {
            inner: Arc::new(Mutex::new(inner)),
        }
    }

    #[wasm_bindgen]
    pub fn filter(&self, predicate: Function) -> NagareRiver {
        let inner = self.inner.lock().unwrap().filter(predicate);
        NagareRiver {
            inner: Arc::new(Mutex::new(inner)),
        }
    }

    #[wasm_bindgen]
    pub fn merge(&self, other: &NagareRiver) -> NagareRiver {
        let inner = self.inner.lock().unwrap().merge(&other.inner.lock().unwrap());
        NagareRiver {
            inner: Arc::new(Mutex::new(inner)),
        }
    }

    #[wasm_bindgen]
    pub fn fork(&self, predicate: Function) -> Array {
        let (left, right) = self.inner.lock().unwrap().fork(predicate);
        let result = Array::new();
        result.push(&JsValue::from(NagareRiver {
            inner: Arc::new(Mutex::new(left)),
        }));
        result.push(&JsValue::from(NagareRiver {
            inner: Arc::new(Mutex::new(right)),
        }));
        result
    }

    #[wasm_bindgen(js_name = toReadableStream)]
    pub fn to_readable_stream(&self) -> ReadableStream {
        self.inner.lock().unwrap().to_readable_stream()
    }

    #[wasm_bindgen(js_name = mapWasm)]
    pub fn map_wasm(&self, kernel_name: &str, params: JsValue) -> NagareRiver {
        let inner = self.inner.lock().unwrap().map_wasm(kernel_name, params);
        NagareRiver {
            inner: Arc::new(Mutex::new(inner)),
        }
    }

    #[wasm_bindgen(js_name = windowedAggregate)]
    pub fn windowed_aggregate(&self, window_size: usize, operation: &str) -> NagareRiver {
        let inner = self.inner.lock().unwrap().windowed_aggregate(window_size, operation);
        NagareRiver {
            inner: Arc::new(Mutex::new(inner)),
        }
    }

    #[wasm_bindgen]
    pub fn rescue(&self, handler: Function) -> NagareRiver {
        let inner = self.inner.lock().unwrap().rescue(handler);
        NagareRiver {
            inner: Arc::new(Mutex::new(inner)),
        }
    }

    #[wasm_bindgen(js_name = terminateOnError)]
    pub fn terminate_on_error(&self) -> NagareRiver {
        let inner = self.inner.lock().unwrap().terminate_on_error();
        NagareRiver {
            inner: Arc::new(Mutex::new(inner)),
        }
    }
}

#[wasm_bindgen]
pub struct Subscription {
    inner: river::SubscriptionHandle,
}

#[wasm_bindgen]
impl Subscription {
    #[wasm_bindgen]
    pub fn unsubscribe(&self) {
        self.inner.unsubscribe();
    }

    #[wasm_bindgen(js_name = isActive)]
    pub fn is_active(&self) -> bool {
        self.inner.is_active()
    }
}

#[wasm_bindgen]
pub fn process_float32_batch(data: &Float32Array, operation: &str) -> Float32Array {
    operators::process_float32_batch(data, operation)
}

#[wasm_bindgen]
pub fn encode_postcard(value: JsValue) -> Result<Uint8Array, JsValue> {
    serialization::encode_postcard(value)
}

#[wasm_bindgen]
pub fn decode_postcard(bytes: &Uint8Array) -> Result<JsValue, JsValue> {
    serialization::decode_postcard(bytes)
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