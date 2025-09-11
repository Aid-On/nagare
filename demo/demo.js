import { Nagare, nagare } from '../src/index.ts';

// Helper function to update visualization
function updateVisualization(elementId, value, clear = false) {
  const viz = document.getElementById(elementId);
  if (clear) {
    viz.innerHTML = '';
    return;
  }
  
  const item = document.createElement('div');
  item.className = 'stream-item';
  item.textContent = value;
  viz.appendChild(item);
  
  // Keep only last 10 items
  while (viz.children.length > 10) {
    viz.removeChild(viz.firstChild);
  }
}

// Helper function to update output
function updateOutput(elementId, text, append = false) {
  const output = document.getElementById(elementId);
  if (append) {
    output.textContent += text + '\n';
  } else {
    output.textContent = text;
  }
  output.scrollTop = output.scrollHeight;
}

// Basic Stream Demo
document.getElementById('basicDemo').addEventListener('click', async () => {
  const btn = document.getElementById('basicDemo');
  const stopBtn = document.getElementById('basicStop');
  btn.disabled = true;
  stopBtn.disabled = false;
  
  updateOutput('basicOutput', '🚀 Starting basic stream processing...\n');
  updateVisualization('basicViz', null, true);
  
  const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const stream = nagare.from(data)
    .map(x => x * 2)
    .filter(x => x > 5)
    .scan((acc, x) => acc + x, 0);
  
  const results = [];
  const subscription = stream.observe(
    value => {
      results.push(value);
      updateVisualization('basicViz', value);
      updateOutput('basicOutput', `Processed value: ${value}`, true);
    },
    {
      onComplete: () => {
        updateOutput('basicOutput', `\n✅ Stream completed!\nFinal result: [${results.join(', ')}]`, true);
        btn.disabled = false;
        stopBtn.disabled = true;
      }
    }
  );
  
  stopBtn.onclick = () => {
    subscription.unsubscribe();
    updateOutput('basicOutput', '\n⏹️ Stream stopped by user', true);
    btn.disabled = false;
    stopBtn.disabled = true;
  };
});

// Real-time Data Stream
let realtimeSubscription = null;
document.getElementById('realtimeDemo').addEventListener('click', () => {
  const btn = document.getElementById('realtimeDemo');
  const stopBtn = document.getElementById('realtimeStop');
  btn.disabled = true;
  stopBtn.disabled = false;
  
  updateOutput('realtimeOutput', '🌊 Starting real-time stream...\n');
  updateVisualization('realtimeViz', null, true);
  
  let count = 0;
  const stream = nagare.interval(500)
    .map(i => ({
      id: i,
      value: Math.floor(Math.random() * 100),
      timestamp: new Date().toLocaleTimeString()
    }))
    .filter(item => item.value > 30);
  
  realtimeSubscription = stream.observe(
    item => {
      count++;
      updateVisualization('realtimeViz', `${item.value}`);
      updateOutput('realtimeOutput', `[${item.timestamp}] Value: ${item.value}`, true);
      
      if (count >= 20) {
        realtimeSubscription.unsubscribe();
        updateOutput('realtimeOutput', '\n✅ Reached 20 items, stopping...', true);
        btn.disabled = false;
        stopBtn.disabled = true;
      }
    }
  );
  
  stopBtn.onclick = () => {
    if (realtimeSubscription) {
      realtimeSubscription.unsubscribe();
      updateOutput('realtimeOutput', '\n⏹️ Stream stopped by user', true);
      btn.disabled = false;
      stopBtn.disabled = true;
    }
  };
});

document.getElementById('realtimeStop').addEventListener('click', () => {
  if (realtimeSubscription) {
    realtimeSubscription.unsubscribe();
  }
});

// Performance Comparison
document.getElementById('perfDemo').addEventListener('click', async () => {
  const btn = document.getElementById('perfDemo');
  btn.disabled = true;
  
  updateOutput('perfOutput', '⏱️ Running performance benchmark...\n');
  
  const dataSize = 100000;
  const data = Array.from({ length: dataSize }, (_, i) => i);
  
  // Nagare benchmark
  const nagareStart = performance.now();
  const nagareStream = nagare.from(data)
    .map(x => x * 2)
    .filter(x => x % 3 === 0)
    .scan((acc, x) => acc + x, 0);
  const nagareResult = await nagareStream.last();
  const nagareTime = performance.now() - nagareStart;
  
  // Native JS benchmark
  const jsStart = performance.now();
  const jsResult = data
    .map(x => x * 2)
    .filter(x => x % 3 === 0)
    .reduce((acc, x) => acc + x, 0);
  const jsTime = performance.now() - jsStart;
  
  // Update metrics
  document.getElementById('nagareTime').textContent = nagareTime.toFixed(2);
  document.getElementById('jsTime').textContent = jsTime.toFixed(2);
  document.getElementById('speedup').textContent = (jsTime / nagareTime).toFixed(2) + 'x';
  
  updateOutput('perfOutput', 
    `📊 Benchmark Results (${dataSize.toLocaleString()} elements):\n\n` +
    `Nagare: ${nagareTime.toFixed(2)}ms\n` +
    `Native JS: ${jsTime.toFixed(2)}ms\n` +
    `Speedup: ${(jsTime / nagareTime).toFixed(2)}x faster\n\n` +
    `✅ Final value: ${nagareResult?.toLocaleString()}`
  );
  
  btn.disabled = false;
});

// Stream Merging Demo
let mergeSubscription = null;
document.getElementById('mergeDemo').addEventListener('click', () => {
  const btn = document.getElementById('mergeDemo');
  const stopBtn = document.getElementById('mergeStop');
  btn.disabled = true;
  stopBtn.disabled = false;
  
  updateOutput('mergeOutput', '🔄 Merging multiple streams...\n');
  updateVisualization('mergeViz', null, true);
  
  // Create three different streams
  const stream1 = nagare.interval(1000).map(i => `A${i}`).take(5);
  const stream2 = nagare.interval(1500).map(i => `B${i}`).take(5);
  const stream3 = nagare.interval(2000).map(i => `C${i}`).take(5);
  
  const merged = stream1.merge(stream2, stream3);
  
  let count = 0;
  mergeSubscription = merged.observe(
    value => {
      count++;
      updateVisualization('mergeViz', value);
      updateOutput('mergeOutput', `Received: ${value} (item #${count})`, true);
    },
    {
      onComplete: () => {
        updateOutput('mergeOutput', '\n✅ All streams merged and completed!', true);
        btn.disabled = false;
        stopBtn.disabled = true;
      }
    }
  );
  
  stopBtn.onclick = () => {
    if (mergeSubscription) {
      mergeSubscription.unsubscribe();
      updateOutput('mergeOutput', '\n⏹️ Merge stopped by user', true);
      btn.disabled = false;
      stopBtn.disabled = true;
    }
  };
});

// Error Handling Demo
document.getElementById('errorDemo').addEventListener('click', async () => {
  const btn = document.getElementById('errorDemo');
  btn.disabled = true;
  
  updateOutput('errorOutput', '🛡️ Testing error recovery...\n');
  updateVisualization('errorViz', null, true);
  
  const data = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  const stream = nagare.from(data)
    .map(x => {
      if (x === 5 || x === 7) {
        throw new Error(`Error at value ${x}`);
      }
      return x * 2;
    })
    .rescue(error => {
      console.log('Rescued error:', error);
      return -1; // Return -1 for errors
    });
  
  const results = [];
  stream.observe(
    value => {
      results.push(value);
      const isError = value === -1;
      updateVisualization('errorViz', isError ? '❌' : value);
      updateOutput('errorOutput', 
        isError ? `⚠️ Error recovered, replaced with: ${value}` : `✅ Processed: ${value}`, 
        true
      );
    },
    {
      onComplete: () => {
        updateOutput('errorOutput', 
          `\n✅ Stream completed with error recovery!\n` +
          `Results: [${results.join(', ')}]\n` +
          `Errors handled: ${results.filter(v => v === -1).length}`,
          true
        );
        btn.disabled = false;
      }
    }
  );
});

// Window Aggregation Demo
document.getElementById('windowDemo').addEventListener('click', async () => {
  const btn = document.getElementById('windowDemo');
  btn.disabled = true;
  
  updateOutput('windowOutput', '📈 Calculating rolling window statistics...\n');
  updateVisualization('windowViz', null, true);
  
  // Generate sample data (simulated sensor readings)
  const data = Array.from({ length: 20 }, (_, i) => 
    50 + Math.sin(i / 2) * 20 + Math.random() * 10
  );
  
  const stream = nagare.from(data)
    .map(v => Math.round(v))
    .windowedAggregate(5, 'mean');
  
  const results = [];
  let index = 0;
  
  stream.observe(
    value => {
      index++;
      results.push(value);
      const rounded = Math.round(value);
      updateVisualization('windowViz', rounded);
      updateOutput('windowOutput', 
        `Window ${index}: Average = ${rounded} (5-item rolling mean)`,
        true
      );
    },
    {
      onComplete: () => {
        const min = Math.min(...results);
        const max = Math.max(...results);
        const avg = results.reduce((a, b) => a + b, 0) / results.length;
        
        updateOutput('windowOutput', 
          `\n✅ Window aggregation completed!\n` +
          `Windows processed: ${results.length}\n` +
          `Min average: ${Math.round(min)}\n` +
          `Max average: ${Math.round(max)}\n` +
          `Overall average: ${Math.round(avg)}`,
          true
        );
        btn.disabled = false;
      }
    }
  );
});

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  console.log('🌊 Nagare Demo Loaded!');
  updateOutput('basicOutput', 'Ready to demonstrate stream processing...');
  updateOutput('realtimeOutput', 'Ready to start real-time stream...');
  updateOutput('perfOutput', 'Ready to run performance benchmark...');
  updateOutput('mergeOutput', 'Ready to merge streams...');
  updateOutput('errorOutput', 'Ready to demonstrate error recovery...');
  updateOutput('windowOutput', 'Ready to show window aggregation...');
});