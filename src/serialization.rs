use wasm_bindgen::prelude::*;
use js_sys::{Uint8Array, Object, Array};
use serde::{Serialize, Deserialize};
use postcard;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Frame {
    pub sequence: u64,
    pub timestamp: u64,
    pub payload: Payload,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum Payload {
    Data(Vec<u8>),
    Float32Array(Vec<f32>),
    Control(ControlMessage),
    Error(ErrorInfo),
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum ControlMessage {
    Credit(u32),
    Ack(u64),
    Pause,
    Resume,
    Complete,
    Subscribe { stream_id: String },
    Unsubscribe { stream_id: String },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ErrorInfo {
    pub code: u32,
    pub message: String,
    pub recoverable: bool,
}

pub fn encode_postcard(value: JsValue) -> Result<Uint8Array, JsValue> {
    let js_obj = value.dyn_into::<Object>()
        .map_err(|_| JsValue::from_str("Value must be an object"))?;
    
    let frame = js_to_frame(&js_obj)?;
    
    let bytes = postcard::to_allocvec(&frame)
        .map_err(|e| JsValue::from_str(&format!("Serialization error: {}", e)))?;
    
    let array = Uint8Array::new_with_length(bytes.len() as u32);
    array.copy_from(&bytes);
    
    Ok(array)
}

pub fn decode_postcard(bytes: &Uint8Array) -> Result<JsValue, JsValue> {
    let vec = bytes.to_vec();
    
    let frame: Frame = postcard::from_bytes(&vec)
        .map_err(|e| JsValue::from_str(&format!("Deserialization error: {}", e)))?;
    
    Ok(frame_to_js(&frame))
}

fn js_to_frame(obj: &Object) -> Result<Frame, JsValue> {
    let sequence = js_sys::Reflect::get(obj, &"sequence".into())?
        .as_f64()
        .ok_or_else(|| JsValue::from_str("sequence must be a number"))? as u64;
    
    let timestamp = js_sys::Reflect::get(obj, &"timestamp".into())?
        .as_f64()
        .ok_or_else(|| JsValue::from_str("timestamp must be a number"))? as u64;
    
    let payload_obj = js_sys::Reflect::get(obj, &"payload".into())?;
    let payload = js_to_payload(&payload_obj)?;
    
    Ok(Frame {
        sequence,
        timestamp,
        payload,
    })
}

fn js_to_payload(value: &JsValue) -> Result<Payload, JsValue> {
    if let Ok(obj) = value.dyn_ref::<Object>() {
        if let Ok(payload_type) = js_sys::Reflect::get(obj, &"type".into()) {
            let type_str = payload_type.as_string()
                .ok_or_else(|| JsValue::from_str("payload type must be a string"))?;
            
            match type_str.as_str() {
                "data" => {
                    let data = js_sys::Reflect::get(obj, &"data".into())?;
                    if let Ok(uint8_array) = data.dyn_into::<Uint8Array>() {
                        Ok(Payload::Data(uint8_array.to_vec()))
                    } else {
                        Err(JsValue::from_str("data payload must be Uint8Array"))
                    }
                }
                "float32" => {
                    let data = js_sys::Reflect::get(obj, &"data".into())?;
                    if let Ok(float32_array) = data.dyn_into::<js_sys::Float32Array>() {
                        Ok(Payload::Float32Array(float32_array.to_vec()))
                    } else {
                        Err(JsValue::from_str("float32 payload must be Float32Array"))
                    }
                }
                "control" => {
                    let msg = js_sys::Reflect::get(obj, &"message".into())?;
                    let control = js_to_control_message(&msg)?;
                    Ok(Payload::Control(control))
                }
                "error" => {
                    let error = js_to_error_info(obj)?;
                    Ok(Payload::Error(error))
                }
                _ => Err(JsValue::from_str("Unknown payload type"))
            }
        } else {
            Err(JsValue::from_str("payload must have a type field"))
        }
    } else {
        Err(JsValue::from_str("payload must be an object"))
    }
}

fn js_to_control_message(value: &JsValue) -> Result<ControlMessage, JsValue> {
    if let Ok(obj) = value.dyn_ref::<Object>() {
        let msg_type = js_sys::Reflect::get(obj, &"type".into())?
            .as_string()
            .ok_or_else(|| JsValue::from_str("control message type must be a string"))?;
        
        match msg_type.as_str() {
            "credit" => {
                let amount = js_sys::Reflect::get(obj, &"amount".into())?
                    .as_f64()
                    .ok_or_else(|| JsValue::from_str("credit amount must be a number"))? as u32;
                Ok(ControlMessage::Credit(amount))
            }
            "ack" => {
                let seq = js_sys::Reflect::get(obj, &"sequence".into())?
                    .as_f64()
                    .ok_or_else(|| JsValue::from_str("ack sequence must be a number"))? as u64;
                Ok(ControlMessage::Ack(seq))
            }
            "pause" => Ok(ControlMessage::Pause),
            "resume" => Ok(ControlMessage::Resume),
            "complete" => Ok(ControlMessage::Complete),
            "subscribe" => {
                let stream_id = js_sys::Reflect::get(obj, &"streamId".into())?
                    .as_string()
                    .ok_or_else(|| JsValue::from_str("stream_id must be a string"))?;
                Ok(ControlMessage::Subscribe { stream_id })
            }
            "unsubscribe" => {
                let stream_id = js_sys::Reflect::get(obj, &"streamId".into())?
                    .as_string()
                    .ok_or_else(|| JsValue::from_str("stream_id must be a string"))?;
                Ok(ControlMessage::Unsubscribe { stream_id })
            }
            _ => Err(JsValue::from_str("Unknown control message type"))
        }
    } else {
        Err(JsValue::from_str("control message must be an object"))
    }
}

fn js_to_error_info(obj: &Object) -> Result<ErrorInfo, JsValue> {
    let code = js_sys::Reflect::get(obj, &"code".into())?
        .as_f64()
        .ok_or_else(|| JsValue::from_str("error code must be a number"))? as u32;
    
    let message = js_sys::Reflect::get(obj, &"message".into())?
        .as_string()
        .ok_or_else(|| JsValue::from_str("error message must be a string"))?;
    
    let recoverable = js_sys::Reflect::get(obj, &"recoverable".into())?
        .as_bool()
        .unwrap_or(false);
    
    Ok(ErrorInfo {
        code,
        message,
        recoverable,
    })
}

fn frame_to_js(frame: &Frame) -> JsValue {
    let obj = Object::new();
    
    js_sys::Reflect::set(&obj, &"sequence".into(), &JsValue::from(frame.sequence as f64)).unwrap();
    js_sys::Reflect::set(&obj, &"timestamp".into(), &JsValue::from(frame.timestamp as f64)).unwrap();
    js_sys::Reflect::set(&obj, &"payload".into(), &payload_to_js(&frame.payload)).unwrap();
    
    obj.into()
}

fn payload_to_js(payload: &Payload) -> JsValue {
    let obj = Object::new();
    
    match payload {
        Payload::Data(bytes) => {
            js_sys::Reflect::set(&obj, &"type".into(), &"data".into()).unwrap();
            let array = Uint8Array::new_with_length(bytes.len() as u32);
            array.copy_from(bytes);
            js_sys::Reflect::set(&obj, &"data".into(), &array.into()).unwrap();
        }
        Payload::Float32Array(floats) => {
            js_sys::Reflect::set(&obj, &"type".into(), &"float32".into()).unwrap();
            let array = js_sys::Float32Array::new_with_length(floats.len() as u32);
            array.copy_from(floats);
            js_sys::Reflect::set(&obj, &"data".into(), &array.into()).unwrap();
        }
        Payload::Control(msg) => {
            js_sys::Reflect::set(&obj, &"type".into(), &"control".into()).unwrap();
            js_sys::Reflect::set(&obj, &"message".into(), &control_message_to_js(msg)).unwrap();
        }
        Payload::Error(error) => {
            js_sys::Reflect::set(&obj, &"type".into(), &"error".into()).unwrap();
            js_sys::Reflect::set(&obj, &"code".into(), &JsValue::from(error.code as f64)).unwrap();
            js_sys::Reflect::set(&obj, &"message".into(), &error.message.as_str().into()).unwrap();
            js_sys::Reflect::set(&obj, &"recoverable".into(), &JsValue::from(error.recoverable)).unwrap();
        }
    }
    
    obj.into()
}

fn control_message_to_js(msg: &ControlMessage) -> JsValue {
    let obj = Object::new();
    
    match msg {
        ControlMessage::Credit(amount) => {
            js_sys::Reflect::set(&obj, &"type".into(), &"credit".into()).unwrap();
            js_sys::Reflect::set(&obj, &"amount".into(), &JsValue::from(*amount as f64)).unwrap();
        }
        ControlMessage::Ack(seq) => {
            js_sys::Reflect::set(&obj, &"type".into(), &"ack".into()).unwrap();
            js_sys::Reflect::set(&obj, &"sequence".into(), &JsValue::from(*seq as f64)).unwrap();
        }
        ControlMessage::Pause => {
            js_sys::Reflect::set(&obj, &"type".into(), &"pause".into()).unwrap();
        }
        ControlMessage::Resume => {
            js_sys::Reflect::set(&obj, &"type".into(), &"resume".into()).unwrap();
        }
        ControlMessage::Complete => {
            js_sys::Reflect::set(&obj, &"type".into(), &"complete".into()).unwrap();
        }
        ControlMessage::Subscribe { stream_id } => {
            js_sys::Reflect::set(&obj, &"type".into(), &"subscribe".into()).unwrap();
            js_sys::Reflect::set(&obj, &"streamId".into(), &stream_id.as_str().into()).unwrap();
        }
        ControlMessage::Unsubscribe { stream_id } => {
            js_sys::Reflect::set(&obj, &"type".into(), &"unsubscribe".into()).unwrap();
            js_sys::Reflect::set(&obj, &"streamId".into(), &stream_id.as_str().into()).unwrap();
        }
    }
    
    obj.into()
}