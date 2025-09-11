use std::sync::Arc;
use std::sync::Mutex;
use std::collections::HashMap;

#[derive(Clone)]
pub struct CreditManager {
    credits: Arc<Mutex<u32>>,
    initial_credits: u32,
}

impl CreditManager {
    pub fn new(initial_credits: u32) -> Self {
        Self {
            credits: Arc::new(Mutex::new(initial_credits)),
            initial_credits,
        }
    }

    pub fn consume(&mut self, amount: u32) -> bool {
        let mut credits = self.credits.lock().unwrap();
        if *credits >= amount {
            *credits -= amount;
            true
        } else {
            false
        }
    }

    pub fn add(&mut self, amount: u32) {
        let mut credits = self.credits.lock().unwrap();
        *credits = (*credits).saturating_add(amount);
    }

    pub fn available(&self) -> u32 {
        *self.credits.lock().unwrap()
    }

    pub fn reset(&mut self) {
        let mut credits = self.credits.lock().unwrap();
        *credits = self.initial_credits;
    }

    pub fn is_exhausted(&self) -> bool {
        *self.credits.lock().unwrap() == 0
    }

    pub fn has_credits(&self) -> bool {
        *self.credits.lock().unwrap() > 0
    }
}

pub struct MultiStreamCreditManager {
    streams: Arc<Mutex<HashMap<String, CreditManager>>>,
    default_credits: u32,
}

impl MultiStreamCreditManager {
    pub fn new(default_credits: u32) -> Self {
        Self {
            streams: Arc::new(Mutex::new(HashMap::new())),
            default_credits,
        }
    }

    pub fn register_stream(&mut self, stream_id: String, initial_credits: Option<u32>) {
        let mut streams = self.streams.lock().unwrap();
        let credits = initial_credits.unwrap_or(self.default_credits);
        streams.insert(stream_id, CreditManager::new(credits));
    }

    pub fn unregister_stream(&mut self, stream_id: &str) {
        let mut streams = self.streams.lock().unwrap();
        streams.remove(stream_id);
    }

    pub fn consume(&mut self, stream_id: &str, amount: u32) -> bool {
        let mut streams = self.streams.lock().unwrap();
        if let Some(manager) = streams.get_mut(stream_id) {
            manager.consume(amount)
        } else {
            false
        }
    }

    pub fn add_credits(&mut self, stream_id: &str, amount: u32) {
        let mut streams = self.streams.lock().unwrap();
        if let Some(manager) = streams.get_mut(stream_id) {
            manager.add(amount);
        }
    }

    pub fn available_credits(&self, stream_id: &str) -> Option<u32> {
        let streams = self.streams.lock().unwrap();
        streams.get(stream_id).map(|m| m.available())
    }

    pub fn is_stream_exhausted(&self, stream_id: &str) -> bool {
        let streams = self.streams.lock().unwrap();
        streams.get(stream_id).map_or(true, |m| m.is_exhausted())
    }

    pub fn active_streams(&self) -> Vec<String> {
        let streams = self.streams.lock().unwrap();
        streams.keys().cloned().collect()
    }

    pub fn total_available_credits(&self) -> u32 {
        let streams = self.streams.lock().unwrap();
        streams.values().map(|m| m.available()).sum()
    }
}

pub struct AdaptiveBackpressure {
    current_rate: Arc<Mutex<f64>>,
    target_latency_ms: f64,
    min_rate: f64,
    max_rate: f64,
    alpha: f64,
}

impl AdaptiveBackpressure {
    pub fn new(
        initial_rate: f64,
        target_latency_ms: f64,
        min_rate: f64,
        max_rate: f64,
    ) -> Self {
        Self {
            current_rate: Arc::new(Mutex::new(initial_rate)),
            target_latency_ms,
            min_rate,
            max_rate,
            alpha: 0.2,
        }
    }

    pub fn update(&mut self, observed_latency_ms: f64) {
        let mut rate = self.current_rate.lock().unwrap();
        
        let error = self.target_latency_ms - observed_latency_ms;
        let adjustment = self.alpha * error / self.target_latency_ms;
        
        let new_rate = *rate * (1.0 + adjustment);
        *rate = new_rate.max(self.min_rate).min(self.max_rate);
    }

    pub fn get_rate(&self) -> f64 {
        *self.current_rate.lock().unwrap()
    }

    pub fn get_delay_ms(&self) -> u64 {
        let rate = self.get_rate();
        if rate > 0.0 {
            (1000.0 / rate) as u64
        } else {
            u64::MAX
        }
    }

    pub fn should_throttle(&self, current_throughput: f64) -> bool {
        current_throughput > self.get_rate()
    }
}

pub struct WindowedRateLimiter {
    window_size_ms: u64,
    max_events: u32,
    events: Arc<Mutex<Vec<u64>>>,
}

impl WindowedRateLimiter {
    pub fn new(window_size_ms: u64, max_events: u32) -> Self {
        Self {
            window_size_ms,
            max_events,
            events: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn try_acquire(&mut self, timestamp_ms: u64) -> bool {
        let mut events = self.events.lock().unwrap();
        
        let cutoff = timestamp_ms.saturating_sub(self.window_size_ms);
        events.retain(|&t| t > cutoff);
        
        if events.len() < self.max_events as usize {
            events.push(timestamp_ms);
            true
        } else {
            false
        }
    }

    pub fn current_rate(&self, timestamp_ms: u64) -> f64 {
        let events = self.events.lock().unwrap();
        let cutoff = timestamp_ms.saturating_sub(self.window_size_ms);
        let recent_events = events.iter().filter(|&&t| t > cutoff).count();
        
        (recent_events as f64 * 1000.0) / self.window_size_ms as f64
    }

    pub fn reset(&mut self) {
        let mut events = self.events.lock().unwrap();
        events.clear();
    }
}