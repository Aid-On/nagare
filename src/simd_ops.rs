#[cfg(target_arch = "wasm32")]
use core::arch::wasm32::*;

#[cfg(feature = "simd")]
#[target_feature(enable = "simd128")]
pub fn f32x_map_mul_add(data: &[f32], a: f32, b: f32) -> Vec<f32> {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        let len = data.len();
        let mut result = Vec::with_capacity(len);
        
        let a_vec = f32x4_splat(a);
        let b_vec = f32x4_splat(b);
        
        let chunks = len / 4;
        let remainder = len % 4;
        
        for i in 0..chunks {
            let offset = i * 4;
            let v = v128_load(data.as_ptr().add(offset) as *const v128);
            let v_f32 = v128_bitcast_f32x4(v);
            
            let mul_result = f32x4_mul(v_f32, a_vec);
            let add_result = f32x4_add(mul_result, b_vec);
            
            let mut temp = [0f32; 4];
            v128_store(temp.as_mut_ptr() as *mut v128, add_result);
            result.extend_from_slice(&temp);
        }
        
        for i in (chunks * 4)..len {
            result.push(data[i] * a + b);
        }
        
        result
    }
    
    #[cfg(not(target_arch = "wasm32"))]
    {
        data.iter().map(|x| x * a + b).collect()
    }
}

#[cfg(feature = "simd")]
#[target_feature(enable = "simd128")]
pub fn f32x_dot_product(a: &[f32], b: &[f32]) -> f32 {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        assert_eq!(a.len(), b.len());
        let len = a.len();
        
        let chunks = len / 4;
        let remainder = len % 4;
        
        let mut sum_vec = f32x4_splat(0.0);
        
        for i in 0..chunks {
            let offset = i * 4;
            let a_vec = v128_load(a.as_ptr().add(offset) as *const v128);
            let b_vec = v128_load(b.as_ptr().add(offset) as *const v128);
            
            let a_f32 = v128_bitcast_f32x4(a_vec);
            let b_f32 = v128_bitcast_f32x4(b_vec);
            
            let mul = f32x4_mul(a_f32, b_f32);
            sum_vec = f32x4_add(sum_vec, mul);
        }
        
        let mut temp = [0f32; 4];
        v128_store(temp.as_mut_ptr() as *mut v128, sum_vec);
        let mut sum = temp[0] + temp[1] + temp[2] + temp[3];
        
        for i in (chunks * 4)..len {
            sum += a[i] * b[i];
        }
        
        sum
    }
    
    #[cfg(not(target_arch = "wasm32"))]
    {
        a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
    }
}

#[cfg(feature = "simd")]
#[target_feature(enable = "simd128")]
pub fn f32x_vector_add(a: &[f32], b: &[f32]) -> Vec<f32> {
    #[cfg(target_arch = "wasm32")]
    unsafe {
        assert_eq!(a.len(), b.len());
        let len = a.len();
        let mut result = Vec::with_capacity(len);
        
        let chunks = len / 4;
        let remainder = len % 4;
        
        for i in 0..chunks {
            let offset = i * 4;
            let a_vec = v128_load(a.as_ptr().add(offset) as *const v128);
            let b_vec = v128_load(b.as_ptr().add(offset) as *const v128);
            
            let a_f32 = v128_bitcast_f32x4(a_vec);
            let b_f32 = v128_bitcast_f32x4(b_vec);
            
            let sum = f32x4_add(a_f32, b_f32);
            
            let mut temp = [0f32; 4];
            v128_store(temp.as_mut_ptr() as *mut v128, sum);
            result.extend_from_slice(&temp);
        }
        
        for i in (chunks * 4)..len {
            result.push(a[i] + b[i]);
        }
        
        result
    }
    
    #[cfg(not(target_arch = "wasm32"))]
    {
        a.iter().zip(b.iter()).map(|(x, y)| x + y).collect()
    }
}

#[cfg(feature = "simd")]
#[target_feature(enable = "simd128")]
pub fn f32x_rolling_mean(data: &[f32], window_size: usize) -> Vec<f32> {
    if window_size > data.len() {
        return vec![];
    }
    
    let mut result = Vec::with_capacity(data.len() - window_size + 1);
    let inv_window = 1.0 / window_size as f32;
    
    #[cfg(target_arch = "wasm32")]
    unsafe {
        let inv_window_vec = f32x4_splat(inv_window);
        
        for i in 0..=(data.len() - window_size) {
            let window = &data[i..i + window_size];
            
            let chunks = window_size / 4;
            let remainder = window_size % 4;
            
            let mut sum_vec = f32x4_splat(0.0);
            
            for j in 0..chunks {
                let offset = j * 4;
                let v = v128_load(window.as_ptr().add(offset) as *const v128);
                let v_f32 = v128_bitcast_f32x4(v);
                sum_vec = f32x4_add(sum_vec, v_f32);
            }
            
            let mut temp = [0f32; 4];
            v128_store(temp.as_mut_ptr() as *mut v128, sum_vec);
            let mut sum = temp[0] + temp[1] + temp[2] + temp[3];
            
            for j in (chunks * 4)..window_size {
                sum += window[j];
            }
            
            result.push(sum * inv_window);
        }
        
        result
    }
    
    #[cfg(not(target_arch = "wasm32"))]
    {
        for i in 0..=(data.len() - window_size) {
            let window = &data[i..i + window_size];
            let sum: f32 = window.iter().sum();
            result.push(sum * inv_window);
        }
        result
    }
}

#[cfg(feature = "simd")]
#[target_feature(enable = "simd128")]
pub fn f32x_min_max(data: &[f32]) -> (f32, f32) {
    if data.is_empty() {
        return (0.0, 0.0);
    }
    
    #[cfg(target_arch = "wasm32")]
    unsafe {
        let len = data.len();
        let chunks = len / 4;
        let remainder = len % 4;
        
        let first_vec = v128_load(data.as_ptr() as *const v128);
        let first_f32 = v128_bitcast_f32x4(first_vec);
        
        let mut min_vec = first_f32;
        let mut max_vec = first_f32;
        
        for i in 1..chunks {
            let offset = i * 4;
            let v = v128_load(data.as_ptr().add(offset) as *const v128);
            let v_f32 = v128_bitcast_f32x4(v);
            
            min_vec = f32x4_min(min_vec, v_f32);
            max_vec = f32x4_max(max_vec, v_f32);
        }
        
        let mut min_temp = [0f32; 4];
        let mut max_temp = [0f32; 4];
        v128_store(min_temp.as_mut_ptr() as *mut v128, min_vec);
        v128_store(max_temp.as_mut_ptr() as *mut v128, max_vec);
        
        let mut min = min_temp.iter().cloned().fold(f32::INFINITY, f32::min);
        let mut max = max_temp.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        
        for i in (chunks * 4)..len {
            min = min.min(data[i]);
            max = max.max(data[i]);
        }
        
        (min, max)
    }
    
    #[cfg(not(target_arch = "wasm32"))]
    {
        let min = data.iter().cloned().fold(f32::INFINITY, f32::min);
        let max = data.iter().cloned().fold(f32::NEG_INFINITY, f32::max);
        (min, max)
    }
}