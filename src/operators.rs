use js_sys::{Float32Array, Float64Array};
use std::collections::VecDeque;

pub fn process_float32_batch(data: &Float32Array, operation: &str) -> Float32Array {
    let input = data.to_vec();
    
    let output = match operation {
        "square" => input.iter().map(|x| x * x).collect(),
        "sqrt" => input.iter().map(|x| x.sqrt()).collect(),
        "normalize" => {
            let sum: f32 = input.iter().sum();
            let mean = sum / input.len() as f32;
            let variance: f32 = input.iter().map(|x| (x - mean).powi(2)).sum::<f32>() / input.len() as f32;
            let std_dev = variance.sqrt();
            input.iter().map(|x| (x - mean) / std_dev).collect()
        }
        "cumsum" => {
            let mut sum = 0.0f32;
            input.iter().map(|x| {
                sum += x;
                sum
            }).collect()
        }
        _ => input,
    };
    
    let result = Float32Array::new_with_length(output.len() as u32);
    result.copy_from(&output);
    result
}

pub fn process_float64_batch(data: &Float64Array, operation: &str) -> Float64Array {
    let input = data.to_vec();
    let output = match operation {
        "square" => input.iter().map(|x| x * x).collect(),
        "sqrt" => input.iter().map(|x| x.sqrt()).collect(),
        "normalize" => {
            let sum: f64 = input.iter().sum();
            let mean = sum / input.len() as f64;
            let variance: f64 = input.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / input.len() as f64;
            let std_dev = variance.sqrt();
            input.iter().map(|x| (x - mean) / std_dev).collect()
        }
        "cumsum" => {
            let mut sum = 0.0f64;
            input.iter().map(|x| { sum += x; sum }).collect()
        }
        _ => input,
    };
    let result = Float64Array::new_with_length(output.len() as u32);
    result.copy_from(&output);
    result
}

pub struct WindowedOperator<T> {
    window_size: usize,
    buffer: VecDeque<T>,
    operation: String,
}

impl<T: Clone> WindowedOperator<T> {
    pub fn new(window_size: usize, operation: String) -> Self {
        Self {
            window_size,
            buffer: VecDeque::with_capacity(window_size),
            operation,
        }
    }

    pub fn push(&mut self, value: T) {
        if self.buffer.len() >= self.window_size {
            self.buffer.pop_front();
        }
        self.buffer.push_back(value);
    }

    pub fn is_ready(&self) -> bool {
        self.buffer.len() == self.window_size
    }

    pub fn get_window(&self) -> Vec<T> {
        self.buffer.iter().cloned().collect()
    }
}

impl WindowedOperator<f32> {
    pub fn compute(&self) -> Option<f32> {
        if !self.is_ready() {
            return None;
        }

        let window: Vec<f32> = self.get_window();
        
        match self.operation.as_str() {
            "mean" => {
                let sum: f32 = window.iter().sum();
                Some(sum / window.len() as f32)
            }
            "max" => window.iter().cloned().fold(f32::NEG_INFINITY, f32::max).into(),
            "min" => window.iter().cloned().fold(f32::INFINITY, f32::min).into(),
            "sum" => Some(window.iter().sum()),
            "variance" => {
                let mean = window.iter().sum::<f32>() / window.len() as f32;
                let variance = window.iter()
                    .map(|x| (x - mean).powi(2))
                    .sum::<f32>() / window.len() as f32;
                Some(variance)
            }
            "std" => {
                let mean = window.iter().sum::<f32>() / window.len() as f32;
                let variance = window.iter()
                    .map(|x| (x - mean).powi(2))
                    .sum::<f32>() / window.len() as f32;
                Some(variance.sqrt())
            }
            _ => None,
        }
    }
}

pub fn batch_process<T, F, R>(
    input: Vec<T>,
    batch_size: usize,
    processor: F,
) -> Vec<R>
where
    F: Fn(&[T]) -> Vec<R>,
    T: Clone,
{
    input
        .chunks(batch_size)
        .flat_map(|chunk| processor(chunk))
        .collect()
}

pub fn parallel_map<T, F, R>(
    input: Vec<T>,
    mapper: F,
) -> Vec<R>
where
    F: Fn(T) -> R + Send + Sync,
    T: Send,
    R: Send,
{
    #[cfg(feature = "parallel")]
    {
        use rayon::prelude::*;
        input.into_par_iter().map(mapper).collect()
    }
    
    #[cfg(not(feature = "parallel"))]
    {
        input.into_iter().map(mapper).collect()
    }
}
