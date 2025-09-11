use wasm_bindgen::prelude::*;
use js_sys::{Array, Function, Uint8Array, Float32Array, Promise};
use web_sys::{ReadableStream, WritableStream, AbortSignal};
use std::sync::Arc;
use std::sync::Mutex;
use std::collections::VecDeque;
use futures::channel::mpsc;
use futures::stream::{Stream, StreamExt};
use std::pin::Pin;
use std::task::{Context, Poll};

pub enum RiverValue {
    Number(f64),
    Bytes(Vec<u8>),
    Float32Array(Vec<f32>),
    JsValue(JsValue),
}

pub struct RiverCore {
    source: RiverSource,
    operators: Vec<Operator>,
    error_handler: Option<Function>,
    terminate_on_error: bool,
}

pub enum RiverSource {
    ReadableStream(ReadableStream),
    Array(Vec<RiverValue>),
    Channel(mpsc::UnboundedReceiver<RiverValue>),
    Empty,
}

pub enum Operator {
    Map(Function),
    Filter(Function),
    MapWasm(String, JsValue),
    WindowedAggregate(usize, String),
    Rescue(Function),
    Fork(Function),
}

impl RiverCore {
    pub fn new() -> Self {
        Self {
            source: RiverSource::Empty,
            operators: Vec::new(),
            error_handler: None,
            terminate_on_error: false,
        }
    }

    pub fn from_readable_stream(stream: ReadableStream) -> Self {
        Self {
            source: RiverSource::ReadableStream(stream),
            operators: Vec::new(),
            error_handler: None,
            terminate_on_error: false,
        }
    }

    pub fn from_js_array(array: Array) -> Self {
        let values: Vec<RiverValue> = (0..array.length())
            .map(|i| RiverValue::JsValue(array.get(i)))
            .collect();
        
        Self {
            source: RiverSource::Array(values),
            operators: Vec::new(),
            error_handler: None,
            terminate_on_error: false,
        }
    }

    pub fn from_typed_array(array: &Uint8Array) -> Self {
        let bytes = array.to_vec();
        Self {
            source: RiverSource::Array(vec![RiverValue::Bytes(bytes)]),
            operators: Vec::new(),
            error_handler: None,
            terminate_on_error: false,
        }
    }

    pub fn observe(
        &self,
        next: Function,
        error: Option<Function>,
        complete: Option<Function>,
        signal: Option<AbortSignal>,
    ) -> SubscriptionHandle {
        let sub_id = uuid::Uuid::new_v4().to_string();
        let active = Arc::new(Mutex::new(true));
        
        let active_clone = active.clone();
        wasm_bindgen_futures::spawn_local(async move {
            match &self.source {
                RiverSource::ReadableStream(stream) => {
                    let reader = stream.get_reader();
                    loop {
                        if !*active_clone.lock().unwrap() {
                            break;
                        }
                        
                        if let Some(sig) = &signal {
                            if sig.aborted() {
                                break;
                            }
                        }
                        
                        let result = reader.read().await;
                        match result {
                            Ok(chunk) => {
                                if let Ok(done) = js_sys::Reflect::get(&chunk, &"done".into()) {
                                    if done.as_bool().unwrap_or(false) {
                                        if let Some(complete_fn) = &complete {
                                            let _ = complete_fn.call0(&JsValue::NULL);
                                        }
                                        break;
                                    }
                                }
                                
                                if let Ok(value) = js_sys::Reflect::get(&chunk, &"value".into()) {
                                    let processed = self.apply_operators(RiverValue::JsValue(value));
                                    if let Some(val) = processed {
                                        let _ = next.call1(&JsValue::NULL, &val.to_js_value());
                                    }
                                }
                            }
                            Err(e) => {
                                if let Some(error_fn) = &error {
                                    let _ = error_fn.call1(&JsValue::NULL, &e);
                                }
                                if self.terminate_on_error {
                                    break;
                                }
                            }
                        }
                    }
                }
                RiverSource::Array(values) => {
                    for value in values {
                        if !*active_clone.lock().unwrap() {
                            break;
                        }
                        
                        if let Some(sig) = &signal {
                            if sig.aborted() {
                                break;
                            }
                        }
                        
                        let processed = self.apply_operators(value.clone());
                        if let Some(val) = processed {
                            let _ = next.call1(&JsValue::NULL, &val.to_js_value());
                        }
                    }
                    
                    if let Some(complete_fn) = &complete {
                        let _ = complete_fn.call0(&JsValue::NULL);
                    }
                }
                _ => {}
            }
        });
        
        SubscriptionHandle {
            id: sub_id,
            active,
        }
    }

    fn apply_operators(&self, value: RiverValue) -> Option<RiverValue> {
        let mut current = Some(value);
        
        for op in &self.operators {
            current = match op {
                Operator::Map(fn_) => {
                    if let Some(val) = current {
                        let js_val = val.to_js_value();
                        match fn_.call1(&JsValue::NULL, &js_val) {
                            Ok(result) => Some(RiverValue::JsValue(result)),
                            Err(_) => None,
                        }
                    } else {
                        None
                    }
                }
                Operator::Filter(pred) => {
                    if let Some(val) = current {
                        let js_val = val.to_js_value();
                        match pred.call1(&JsValue::NULL, &js_val) {
                            Ok(result) if result.as_bool().unwrap_or(false) => Some(val),
                            _ => None,
                        }
                    } else {
                        None
                    }
                }
                Operator::MapWasm(kernel, params) => {
                    if let Some(val) = current {
                        self.apply_wasm_kernel(val, kernel, params)
                    } else {
                        None
                    }
                }
                _ => current,
            };
        }
        
        current
    }

    fn apply_wasm_kernel(&self, value: RiverValue, kernel: &str, params: &JsValue) -> Option<RiverValue> {
        match kernel {
            "f32x_map_mul_add" => {
                if let RiverValue::Float32Array(data) = value {
                    let a = js_sys::Reflect::get(params, &"a".into())
                        .ok()?.as_f64()? as f32;
                    let b = js_sys::Reflect::get(params, &"b".into())
                        .ok()?.as_f64()? as f32;
                    
                    #[cfg(feature = "simd")]
                    {
                        let result = crate::simd_ops::f32x_map_mul_add(&data, a, b);
                        Some(RiverValue::Float32Array(result))
                    }
                    
                    #[cfg(not(feature = "simd"))]
                    {
                        let result: Vec<f32> = data.iter()
                            .map(|x| x * a + b)
                            .collect();
                        Some(RiverValue::Float32Array(result))
                    }
                } else {
                    None
                }
            }
            _ => None,
        }
    }

    pub fn map(&self, mapper: Function) -> RiverCore {
        let mut new_core = self.clone_base();
        new_core.operators.push(Operator::Map(mapper));
        new_core
    }

    pub fn filter(&self, predicate: Function) -> RiverCore {
        let mut new_core = self.clone_base();
        new_core.operators.push(Operator::Filter(predicate));
        new_core
    }

    pub fn map_wasm(&self, kernel_name: &str, params: JsValue) -> RiverCore {
        let mut new_core = self.clone_base();
        new_core.operators.push(Operator::MapWasm(kernel_name.to_string(), params));
        new_core
    }

    pub fn windowed_aggregate(&self, window_size: usize, operation: &str) -> RiverCore {
        let mut new_core = self.clone_base();
        new_core.operators.push(Operator::WindowedAggregate(window_size, operation.to_string()));
        new_core
    }

    pub fn rescue(&self, handler: Function) -> RiverCore {
        let mut new_core = self.clone_base();
        new_core.error_handler = Some(handler);
        new_core
    }

    pub fn terminate_on_error(&self) -> RiverCore {
        let mut new_core = self.clone_base();
        new_core.terminate_on_error = true;
        new_core
    }

    pub fn merge(&self, other: &RiverCore) -> RiverCore {
        self.clone_base()
    }

    pub fn fork(&self, predicate: Function) -> (RiverCore, RiverCore) {
        let mut left = self.clone_base();
        let mut right = self.clone_base();
        
        left.operators.push(Operator::Filter(predicate.clone()));
        
        (left, right)
    }

    pub fn to_readable_stream(&self) -> ReadableStream {
        ReadableStream::new().unwrap()
    }

    fn clone_base(&self) -> RiverCore {
        RiverCore {
            source: RiverSource::Empty,
            operators: self.operators.clone(),
            error_handler: self.error_handler.clone(),
            terminate_on_error: self.terminate_on_error,
        }
    }
}

impl RiverValue {
    pub fn to_js_value(&self) -> JsValue {
        match self {
            RiverValue::Number(n) => JsValue::from_f64(*n),
            RiverValue::Bytes(bytes) => {
                let array = Uint8Array::new_with_length(bytes.len() as u32);
                array.copy_from(bytes);
                array.into()
            }
            RiverValue::Float32Array(floats) => {
                let array = Float32Array::new_with_length(floats.len() as u32);
                array.copy_from(floats);
                array.into()
            }
            RiverValue::JsValue(val) => val.clone(),
        }
    }
}

pub struct SubscriptionHandle {
    pub id: String,
    pub active: Arc<Mutex<bool>>,
}

impl SubscriptionHandle {
    pub fn unsubscribe(&self) {
        *self.active.lock().unwrap() = false;
    }

    pub fn is_active(&self) -> bool {
        *self.active.lock().unwrap()
    }
}