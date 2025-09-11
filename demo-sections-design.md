# 🌊 Nagare Demo - Section Design

## Header Section
```
🌊 NAGARE
High-Performance Stream Processing for JavaScript

[GitHub] [Documentation] [NPM]
```

## Navigation Tabs
```
📊 Performance | 🔧 Features | 🚀 Examples | 📖 API
```

---

## 📊 Performance Section

### Benchmark Arena
```
🏟️ PERFORMANCE ARENA
Compare Nagare against Native JS and RxJS

[Select Test] [Map+Filter ▼] [Data Size] [100K ▼] [Run Benchmark]

┌─────────────────────────────────────────────────────┐
│  🏆 RESULTS                                         │
│  ┌─────────────┬─────────┬─────────┬──────────────┐  │
│  │ Library     │ Time    │ Ops/s   │ Winner       │  │
│  ├─────────────┼─────────┼─────────┼──────────────┤  │
│  │ 🚀 Nagare   │ 0.21ms  │ 486M    │ 🥇 Champion  │  │
│  │ 🟦 Native   │ 1.25ms  │ 80M     │ 🥈 Runner-up │  │
│  │ 🟨 RxJS     │ 2.60ms  │ 38M     │ 🥉 Third     │  │
│  └─────────────┴─────────┴─────────┴──────────────┘  │
│                                                     │
│  📈 Nagare is 12x faster than RxJS!                │
│  📈 Nagare is 6x faster than Native JS!            │
└─────────────────────────────────────────────────────┘

Test Options:
• Simple Map + Filter
• Complex Pipeline (sqrt, floor, scan)
• Large Dataset (1M elements)
• Object Processing

Data Sizes:
• 10K elements
• 100K elements  
• 1M elements
• 10M elements
```

---

## 🔧 Features Section

### Interactive Feature Showcase

#### 1. 🔄 Stream Transformation
```
┌─────────────────────────────────────────┐
│ Basic Stream Processing                 │
│ Map, filter, and reduce operations     │
│                                         │
│ Input:  [1, 2, 3, 4, 5, 6, 7, 8, 9]   │
│ ↓ .map(x => x * 2)                     │
│ [2, 4, 6, 8, 10, 12, 14, 16, 18]       │
│ ↓ .filter(x => x % 3 === 0)            │
│ Output: [6, 12, 18]                     │
│                                         │
│ [▶ Run Demo] [📄 Show Code]             │
└─────────────────────────────────────────┘
```

#### 2. ⚡ Real-time Processing  
```
┌─────────────────────────────────────────┐
│ Real-time Data Stream                   │
│ Process continuous data streams         │
│                                         │
│ 📡 Live Data: ████████████ 1,247 items │
│ 📈 Processing Rate: 50K ops/sec        │
│ 🎯 Current Value: 42,851               │
│                                         │
│ [▶ Start Stream] [⏹ Stop] [📊 Stats]    │
└─────────────────────────────────────────┘
```

#### 3. 🔄 Stream Merging
```
┌─────────────────────────────────────────┐
│ Multiple Stream Merging                 │
│ Combine multiple data sources           │
│                                         │
│ Stream A: [1, 3, 5] ──┐                │
│ Stream B: [2, 4, 6] ──┼─→ [1,2,3,4,5,6]│
│ Stream C: [7, 8, 9] ──┘                │
│                                         │
│ [▶ Merge Demo] [📄 Show Code]           │
└─────────────────────────────────────────┘
```

#### 4. 🛡️ Error Recovery
```
┌─────────────────────────────────────────┐
│ Graceful Error Handling                 │
│ Recover from errors with rescue()       │
│                                         │
│ [1, "bad", 3, null, 5] ────rescue────→  │
│ [1, 0, 3, 0, 5]                         │
│                                         │
│ ✅ 4/5 items processed successfully     │
│ [▶ Error Demo] [📄 Show Code]           │
└─────────────────────────────────────────┘
```

#### 5. 📊 Window Operations
```
┌─────────────────────────────────────────┐
│ Windowed Aggregation                    │
│ Rolling statistics over time windows    │
│                                         │
│ [1,2,3,4,5,6,7,8,9] window(3)          │
│ → [2,3,4] avg=3, [3,4,5] avg=4, ...    │
│                                         │
│ 📈 Window Size: 3 ░░░█████░░░           │
│ [▶ Window Demo] [📊 Visualize]          │
└─────────────────────────────────────────┘
```

---

## 🚀 Examples Section

### Code Examples with Live Results

#### Quick Start
```typescript
import { Nagare } from '@aid-on/nagare';

// Simple transformation
const result = await Nagare
  .from([1, 2, 3, 4, 5])
  .map(x => x * 2)
  .filter(x => x > 5)
  .toArray();

console.log(result); // [6, 8, 10]
```

#### Advanced Pipeline
```typescript
// Real-world data processing
const processed = await Nagare
  .from(apiResponse.data)
  .filter(item => item.active)
  .map(item => ({ ...item, score: calculateScore(item) }))
  .filter(item => item.score > threshold)
  .scan((acc, item) => acc + item.score, 0)
  .toArray();
```

---

## 📖 API Section

### Complete API Reference

#### Core Methods
- `from(source)` - Create stream from data
- `map(fn)` - Transform each element  
- `filter(predicate)` - Filter elements
- `scan(fn, initial)` - Accumulate values
- `take(n)` - Take first n elements
- `skip(n)` - Skip first n elements

#### Utility Methods  
- `toArray()` - Collect to array
- `first()` - Get first element
- `count()` - Count elements
- `merge(...streams)` - Merge streams

#### Error Handling
- `rescue(handler)` - Error recovery
- `terminateOnErrorMode()` - Stop on error

---

## Footer
```
Made with ❤️ by the Nagare team
Performance benchmarks run on Node.js v20.10.0
```