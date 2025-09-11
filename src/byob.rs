use wasm_bindgen::prelude::*;
use js_sys::{Uint8Array, ArrayBuffer, Function, Object};
use web_sys::{ReadableStream};
use std::sync::Arc;
use std::sync::Mutex;

#[wasm_bindgen]
pub struct BYOBStreamReader {
    stream: ReadableStream,
    buffer_size: usize,
    reusable_buffer: Arc<Mutex<Option<ArrayBuffer>>>,
}

#[wasm_bindgen]
impl BYOBStreamReader {
    #[wasm_bindgen(constructor)]
    pub fn new(stream: ReadableStream, buffer_size: usize) -> Result<BYOBStreamReader, JsValue> {
        Ok(BYOBStreamReader {
            stream,
            buffer_size,
            reusable_buffer: Arc::new(Mutex::new(None)),
        })
    }

    #[wasm_bindgen(js_name = readInto)]
    pub async fn read_into(&mut self, buffer: Uint8Array) -> Result<JsValue, JsValue> {
        // Simplified implementation without BYOB reader
        let reader = self.stream.get_reader();
        let result = reader.read().await?;
        reader.release_lock();
        Ok(result)
    }

    #[wasm_bindgen(js_name = readWithReusableBuffer)]
    pub async fn read_with_reusable_buffer(&mut self) -> Result<JsValue, JsValue> {
        let buffer = {
            let mut buf_lock = self.reusable_buffer.lock().unwrap();
            if buf_lock.is_none() {
                *buf_lock = Some(ArrayBuffer::new(self.buffer_size as u32));
            }
            buf_lock.clone().unwrap()
        };

        let view = Uint8Array::new(&buffer);
        self.read_into(view).await
    }

    #[wasm_bindgen]
    pub async fn cancel(&mut self) -> Result<(), JsValue> {
        self.stream.cancel().await?;
        Ok(())
    }
}

#[wasm_bindgen]
pub struct BYOBStreamController {
    chunk_size: usize,
    high_water_mark: usize,
    pending_buffers: Arc<Mutex<Vec<ArrayBuffer>>>,
}

#[wasm_bindgen]
impl BYOBStreamController {
    #[wasm_bindgen(constructor)]
    pub fn new(chunk_size: usize, high_water_mark: usize) -> Self {
        Self {
            chunk_size,
            high_water_mark,
            pending_buffers: Arc::new(Mutex::new(Vec::new())),
        }
    }

    #[wasm_bindgen(js_name = createReadableStream)]
    pub fn create_readable_stream(&self, _pull_fn: Function) -> ReadableStream {
        let underlying_source = Object::new();
        
        js_sys::Reflect::set(
            &underlying_source,
            &"type".into(),
            &"bytes".into(),
        ).unwrap();
        
        js_sys::Reflect::set(
            &underlying_source,
            &"autoAllocateChunkSize".into(),
            &JsValue::from(self.chunk_size as u32),
        ).unwrap();
        
        ReadableStream::new_with_underlying_source(&underlying_source).unwrap()
    }

    #[wasm_bindgen(js_name = getChunkSize)]
    pub fn get_chunk_size(&self) -> usize {
        self.chunk_size
    }

    #[wasm_bindgen(js_name = getHighWaterMark)]
    pub fn get_high_water_mark(&self) -> usize {
        self.high_water_mark
    }
}

#[wasm_bindgen]
pub fn create_zero_copy_view(buffer: &[u8]) -> Uint8Array {
    unsafe {
        let ptr = buffer.as_ptr() as u32;
        let len = buffer.len() as u32;
        
        let memory = wasm_bindgen::memory().unchecked_ref::<js_sys::WebAssembly::Memory>();
        let buffer = memory.buffer();
        
        Uint8Array::new_with_byte_offset_and_length(&buffer, ptr, len)
    }
}

#[wasm_bindgen]
pub fn create_float32_view(buffer: &[f32]) -> js_sys::Float32Array {
    unsafe {
        let ptr = buffer.as_ptr() as u32;
        let len = buffer.len() as u32;
        
        let memory = wasm_bindgen::memory().unchecked_ref::<js_sys::WebAssembly::Memory>();
        let buffer = memory.buffer();
        
        js_sys::Float32Array::new_with_byte_offset_and_length(
            &buffer,
            ptr * 4,
            len,
        )
    }
}

pub struct BufferPool {
    buffers: Vec<Vec<u8>>,
    buffer_size: usize,
    max_buffers: usize,
}

impl BufferPool {
    pub fn new(buffer_size: usize, max_buffers: usize) -> Self {
        Self {
            buffers: Vec::with_capacity(max_buffers),
            buffer_size,
            max_buffers,
        }
    }

    pub fn acquire(&mut self) -> Vec<u8> {
        self.buffers.pop().unwrap_or_else(|| vec![0u8; self.buffer_size])
    }

    pub fn release(&mut self, mut buffer: Vec<u8>) {
        if self.buffers.len() < self.max_buffers {
            buffer.clear();
            buffer.resize(self.buffer_size, 0);
            self.buffers.push(buffer);
        }
    }

    pub fn available(&self) -> usize {
        self.buffers.len()
    }
}