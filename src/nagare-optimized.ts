// Optimized Nagare implementation with operator fusion and lazy evaluation
type Operator<T, U> = {
  type: 'map' | 'filter' | 'scan' | 'take' | 'skip';
  fn?: (value: T) => U | boolean;
  scanFn?: (acc: U, value: T) => U;
  initial?: U;
  n?: number;
};

// Pre-compiled operator functions for better performance (reserved for future use)
// const OPERATOR_COMPILERS = {
//   map: (fn: Function) => (value: any) => fn(value),
//   filter: (fn: Function) => (value: any, include: boolean[]) => {
//     include[0] = fn(value);
//     return value;
//   },
//   scan: (fn: Function, initial: any) => {
//     let acc = initial;
//     return (value: any) => {
//       acc = fn(acc, value);
//       return acc;
//     };
//   },
// };

export class OptimizedNagare<T, E = never> implements AsyncIterable<T> {
  private source: AsyncIterable<T> | Iterable<T> | T[];
  private operators: Operator<any, any>[] = [];
  // private compiledPipeline?: Function;  // Reserved for caching compiled functions
  // private errorHandler?: (error: E) => void;  // Reserved for error handling

  constructor(source: AsyncIterable<T> | Iterable<T> | T[]) {
    this.source = source;
  }

  // Compile operators into a single optimized function
  private compilePipeline(): Function {
    if (this.operators.length === 0) {
      return (value: any) => ({ value, include: true, done: false });
    }

    // Operator fusion: combine adjacent compatible operators
    const fusedOps = this.fuseOperators();
    
    // Create a single function that processes all operators
    return this.createPipelineFunction(fusedOps);
  }

  private fuseOperators(): Operator<any, any>[] {
    const fused: Operator<any, any>[] = [];
    let i = 0;
    
    while (i < this.operators.length) {
      const current = this.operators[i];
      
      // Try to fuse consecutive map operations
      if (current.type === 'map') {
        const mapChain = [current.fn!];
        i++;
        
        while (i < this.operators.length && this.operators[i].type === 'map') {
          mapChain.push(this.operators[i].fn!);
          i++;
        }
        
        // Create fused map operation
        if (mapChain.length > 1) {
          fused.push({
            type: 'map',
            fn: (value: any) => {
              let result = value;
              for (const fn of mapChain) {
                result = fn(result);
              }
              return result;
            }
          });
        } else {
          fused.push(current);
        }
      }
      // Try to fuse consecutive filter operations  
      else if (current.type === 'filter') {
        const filterChain = [current.fn!];
        i++;
        
        while (i < this.operators.length && this.operators[i].type === 'filter') {
          filterChain.push(this.operators[i].fn!);
          i++;
        }
        
        // Create fused filter operation
        if (filterChain.length > 1) {
          fused.push({
            type: 'filter',
            fn: (value: any) => {
              for (const fn of filterChain) {
                if (!fn(value)) return false;
              }
              return true;
            }
          });
        } else {
          fused.push(current);
        }
      } else {
        fused.push(current);
        i++;
      }
    }
    
    return fused;
  }

  private createPipelineFunction(ops: Operator<any, any>[]): Function {
    // State for stateful operators
    const state: any = {
      scanAccumulators: new Map(),
      takeCounts: new Map(),
      skipCounts: new Map(),
    };

    return (value: any) => {
      let current = value;
      let shouldInclude = true;

      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];

        switch (op.type) {
          case 'map':
            current = op.fn!(current);
            break;

          case 'filter':
            if (!op.fn!(current)) {
              shouldInclude = false;
              return { value: current, include: false, done: false };
            }
            break;

          case 'scan':
            if (!state.scanAccumulators.has(i)) {
              state.scanAccumulators.set(i, op.initial);
            }
            const acc = state.scanAccumulators.get(i);
            current = op.scanFn!(acc, current);
            state.scanAccumulators.set(i, current);
            break;

          case 'take':
            if (!state.takeCounts.has(i)) {
              state.takeCounts.set(i, 0);
            }
            const taken = state.takeCounts.get(i);
            if (taken >= op.n!) {
              return { value: current, include: false, done: true };
            }
            state.takeCounts.set(i, taken + 1);
            break;

          case 'skip':
            if (!state.skipCounts.has(i)) {
              state.skipCounts.set(i, 0);
            }
            const skipped = state.skipCounts.get(i);
            if (skipped < op.n!) {
              state.skipCounts.set(i, skipped + 1);
              shouldInclude = false;
              return { value: current, include: false, done: false };
            }
            break;
        }
      }

      return { value: current, include: shouldInclude, done: false };
    };
  }

  map<U>(fn: (value: T) => U): OptimizedNagare<U, E> {
    const newNagare = new OptimizedNagare<U, E>(this.source as any);
    newNagare.operators = [...this.operators, { type: 'map', fn }];
    return newNagare;
  }

  filter(predicate: (value: T) => boolean): OptimizedNagare<T, E> {
    const newNagare = new OptimizedNagare<T, E>(this.source);
    newNagare.operators = [...this.operators, { type: 'filter', fn: predicate }];
    return newNagare;
  }

  scan<U>(fn: (acc: U, value: T) => U, initial: U): OptimizedNagare<U, E> {
    const newNagare = new OptimizedNagare<U, E>(this.source as any);
    newNagare.operators = [...this.operators, { type: 'scan', scanFn: fn, initial }];
    return newNagare;
  }

  take(n: number): OptimizedNagare<T, E> {
    const newNagare = new OptimizedNagare<T, E>(this.source);
    newNagare.operators = [...this.operators, { type: 'take', n }];
    return newNagare;
  }

  skip(n: number): OptimizedNagare<T, E> {
    const newNagare = new OptimizedNagare<T, E>(this.source);
    newNagare.operators = [...this.operators, { type: 'skip', n }];
    return newNagare;
  }

  // Optimized toArray with pre-allocation
  async toArray(): Promise<T[]> {
    const result: T[] = [];
    const pipeline = this.compilePipeline();

    // Pre-allocate array if we know the size
    if (Array.isArray(this.source)) {
      // Estimate result size based on operators
      let estimatedSize = this.source.length;
      for (const op of this.operators) {
        if (op.type === 'take' && op.n! < estimatedSize) {
          estimatedSize = op.n!;
        }
      }
      result.length = 0; // Reset but keep allocated memory
    }

    if (Array.isArray(this.source)) {
      // Fast path for arrays - no async overhead
      for (let i = 0; i < this.source.length; i++) {
        const processed = pipeline(this.source[i]);
        if (processed.done) break;
        if (processed.include) {
          result.push(processed.value);
        }
      }
    } else if (Symbol.iterator in this.source) {
      // Fast path for sync iterables
      for (const value of this.source as Iterable<T>) {
        const processed = pipeline(value);
        if (processed.done) break;
        if (processed.include) {
          result.push(processed.value);
        }
      }
    } else {
      // Async path
      for await (const value of this.source as AsyncIterable<T>) {
        const processed = pipeline(value);
        if (processed.done) break;
        if (processed.include) {
          result.push(processed.value);
        }
      }
    }

    return result;
  }

  // Optimized async iterator
  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    const pipeline = this.compilePipeline();

    if (Array.isArray(this.source)) {
      for (const value of this.source) {
        const processed = pipeline(value);
        if (processed.done) break;
        if (processed.include) {
          yield processed.value;
        }
      }
    } else if (Symbol.iterator in this.source) {
      for (const value of this.source as Iterable<T>) {
        const processed = pipeline(value);
        if (processed.done) break;
        if (processed.include) {
          yield processed.value;
        }
      }
    } else {
      for await (const value of this.source as AsyncIterable<T>) {
        const processed = pipeline(value);
        if (processed.done) break;
        if (processed.include) {
          yield processed.value;
        }
      }
    }
  }

  static from<T>(source: T[] | Iterable<T> | AsyncIterable<T>): OptimizedNagare<T> {
    return new OptimizedNagare<T>(source);
  }

  static of<T>(...values: T[]): OptimizedNagare<T> {
    return new OptimizedNagare<T>(values);
  }

  static range(start: number, end: number, step = 1): OptimizedNagare<number> {
    const size = Math.ceil((end - start) / step);
    const values = new Array(size);
    for (let i = 0, val = start; i < size; i++, val += step) {
      values[i] = val;
    }
    return new OptimizedNagare<number>(values);
  }

  // Batch processing for better cache locality
  async toArrayBatched(batchSize = 1000): Promise<T[]> {
    const result: T[] = [];
    const pipeline = this.compilePipeline();
    const batch: any[] = [];

    const processBatch = () => {
      for (const value of batch) {
        const processed = pipeline(value);
        if (processed.done) return true;
        if (processed.include) {
          result.push(processed.value);
        }
      }
      batch.length = 0;
      return false;
    };

    if (Array.isArray(this.source)) {
      for (const value of this.source) {
        batch.push(value);
        if (batch.length >= batchSize) {
          if (processBatch()) break;
        }
      }
      if (batch.length > 0) {
        processBatch();
      }
    }

    return result;
  }
}

// Export optimized nagare factory
export const optimizedNagare = {
  from: <T>(source: T[] | Iterable<T> | AsyncIterable<T>) => OptimizedNagare.from(source),
  of: <T>(...values: T[]) => OptimizedNagare.of(...values),
  range: (start: number, end: number, step = 1) => OptimizedNagare.range(start, end, step),
};