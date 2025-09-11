// Compilation/JIT helpers extracted from Nagare core.
// These utilities are pure and do not import the Nagare class to avoid circular deps.

export type JitMode = 'fast' | 'off';
import { getOpMeta, FusedOp } from './tags';

interface CompileOptions {
  jitMode: JitMode;
  ASYNC_DETECTED: symbol;
}

export function compileOperatorChain<T = unknown>(
  ops: Array<FusedOp<T>>,
  handler: ((e: any) => any) | undefined,
  terminateOnError: boolean | undefined,
  opts: CompileOptions
): ((value: T) => T | undefined) | null {
  try {
    // Error-handling path: guard each operator and allow handler/terminate semantics
    if (handler || terminateOnError) {
      return (value: T) => {
        let current: T | undefined = value;
        try {
          for (let i = 0; i < ops.length; i++) {
            const r = ops[i](current as T);
            if (r instanceof Promise) throw opts.ASYNC_DETECTED;
            current = r as T | undefined;
            if (current === undefined) return undefined;
          }
          return current as T;
        } catch (err) {
          if (handler) {
            const recovered = handler(err);
            return recovered as T;
          }
          if (terminateOnError) throw err;
          return undefined;
        }
      };
    }

    // JIT: new Function based fast path (disabled when jitMode==='off')
    try {
      if (opts.jitMode === 'off') throw new Error('jit-disabled');
      const argNames: string[] = [];
      const args: unknown[] = [];
      const prologue: string[] = [];
      const body: string[] = [];
      body.push('return function(value){');
      body.push('  let c = value;');
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i];
        const meta = getOpMeta(op);
        if (meta?.kind === 'filter' && typeof meta.predicate === 'function') {
          const name = `p${i}`;
          argNames.push(name);
          args.push(meta.predicate);
          body.push(`  { const b = ${name}(c); if (b instanceof Promise) throw AsyncDetected; if (!b) return undefined; }`);
        } else if (meta?.kind === 'scan' && typeof meta.scanFn === 'function') {
          const sName = `s${i}`;
          const aName = `a${i}`;
          argNames.push(sName, aName);
          args.push(meta.scanFn, meta.initial);
          prologue.push(`let ${aName} = ${aName};`);
          body.push(`  { const t = ${sName}(${aName}, c); if (t instanceof Promise) throw AsyncDetected; ${aName} = t; c = ${aName}; }`);
        } else if (meta?.kind === 'take' && typeof meta.n === 'number') {
          const tName = `t${i}`;
          const nName = `tn${i}`;
          argNames.push(nName);
          args.push(meta.n);
          prologue.push(`let ${tName} = 0;`);
          body.push(`  { if (${tName} >= ${nName}) return undefined; ${tName}++; }`);
        } else if (meta?.kind === 'skip' && typeof meta.n === 'number') {
          const sName = `sk${i}`;
          const nName = `sn${i}`;
          argNames.push(nName);
          args.push(meta.n);
          prologue.push(`let ${sName} = 0;`);
          body.push(`  { if (${sName} < ${nName}) { ${sName}++; return undefined; } }`);
        } else {
          const name = `f${i}`;
          argNames.push(name);
          args.push(op);
          body.push(`  c = ${name}(c);`);
          body.push('  if (c === undefined) return undefined;');
          body.push('  if (c instanceof Promise) throw AsyncDetected;');
        }
      }
      body.push('  return c;');
      body.push('}');
      const factory = new Function('AsyncDetected', ...argNames, [...prologue, ...body].join('\n')) as unknown as (
        ad: symbol,
        ...ops: unknown[]
      ) => (value: T) => T | undefined;
      const compiled = factory(opts.ASYNC_DETECTED, ...args);
      return compiled;
    } catch {
      // Fallback to generic fused function
    }

    // Generic fused function
    return (value: T) => {
      let current: T | undefined = value;
      for (let i = 0; i < ops.length; i++) {
        const r = ops[i](current as T);
        if (r instanceof Promise) throw opts.ASYNC_DETECTED;
        current = r as T | undefined;
        if (current === undefined) return undefined;
      }
      return current as T;
    };
  } catch (error) {
    return null;
  }
}

export function compileOperatorChainUnchecked<T = unknown>(
  ops: Array<FusedOp<T>>,
  opts: CompileOptions
): (value: T) => T | undefined {
  try {
    if (opts.jitMode === 'off') throw new Error('jit-disabled');
    const argNames: string[] = [];
    const args: unknown[] = [];
    const prologue: string[] = [];
    const body: string[] = [];
    body.push('return function(value){');
    body.push('  let c = value;');
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const meta = getOpMeta(op);
      if (meta?.kind === 'filter' && typeof meta.predicate === 'function') {
        const name = `p${i}`;
        argNames.push(name);
        args.push(meta.predicate);
        body.push(`  if (!${name}(c)) return undefined;`);
      } else if (meta?.kind === 'scan' && typeof meta.scanFn === 'function') {
        const sName = `s${i}`;
        const aName = `a${i}`;
        argNames.push(sName, aName);
        args.push(meta.scanFn, meta.initial);
        prologue.push(`let ${aName} = ${aName};`);
        body.push(`  ${aName} = ${sName}(${aName}, c);`);
        body.push(`  c = ${aName};`);
      } else if (meta?.kind === 'take' && typeof meta.n === 'number') {
        const tName = `t${i}`;
        const nName = `tn${i}`;
        argNames.push(nName);
        args.push(meta.n);
        prologue.push(`let ${tName} = 0;`);
        body.push(`  if (${tName} >= ${nName}) return undefined; ${tName}++;`);
      } else if (meta?.kind === 'skip' && typeof meta.n === 'number') {
        const sName = `sk${i}`;
        const nName = `sn${i}`;
        argNames.push(nName);
        args.push(meta.n);
        prologue.push(`let ${sName} = 0;`);
        body.push(`  if (${sName} < ${nName}) { ${sName}++; return undefined; }`);
      } else {
        const name = `f${i}`;
        argNames.push(name);
        args.push(op);
        body.push(`  c = ${name}(c);`);
        body.push('  if (c === undefined) return undefined;');
      }
    }
    body.push('  return c;');
    body.push('}');
    const factory = new Function(...argNames, [...prologue, ...body].join('\n')) as unknown as (
      ...ops: unknown[]
    ) => (value: T) => T | undefined;
    const compiled = factory(...args);
    return compiled;
  } catch {
    // ignore
  }
  return (value: T) => {
    let current: T | undefined = value;
    for (let i = 0; i < ops.length; i++) {
      current = ops[i](current as T) as T | undefined;
      if (current === undefined) return undefined;
    }
    return current as T;
  };
}

// Async per-item fused function (no error handling, state allowed via closures)
export function compileOperatorChainAsync(
  ops: Array<(value: any) => any>
): (value: any) => Promise<any> {
  return async (value: any) => {
    let current = value;
    for (let i = 0; i < ops.length; i++) {
      const r = ops[i](current);
      current = r instanceof Promise ? await r : r;
      if (current === undefined) return undefined;
    }
    return current;
  };
}

export function compileArrayKernelUnchecked<T = unknown>(
  ops: Array<FusedOp<T>>,
  opts: CompileOptions
): ((src: T[], start: number, out: T[], k: number) => number) | null {
  try {
    if (opts.jitMode === 'off') throw new Error('jit-disabled');
    const argNames: string[] = [];
    const args: unknown[] = [];
    const prologue: string[] = [];
    const body: string[] = [];
    body.push('return function(src, start, out, k){');
    body.push('  for (let i = start; i < src.length; i++) {');
    body.push('    let c = src[i];');
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const meta = getOpMeta(op);
      if (meta?.kind === 'filter' && typeof meta.predicate === 'function') {
        const name = `p${i}`;
        argNames.push(name);
        args.push(meta.predicate);
        body.push(`    if (!${name}(c)) continue;`);
      } else if (meta?.kind === 'scan' && typeof meta.scanFn === 'function') {
        const sName = `s${i}`;
        const aName = `a${i}`;
        argNames.push(sName, aName);
        args.push(meta.scanFn, meta.initial);
        prologue.push(`let ${aName} = ${aName};`);
        body.push(`    ${aName} = ${sName}(${aName}, c);`);
        body.push(`    c = ${aName};`);
      } else if (meta?.kind === 'take' && typeof meta.n === 'number') {
        const tName = `t${i}`;
        const nName = `tn${i}`;
        argNames.push(nName);
        args.push(meta.n);
        prologue.push(`let ${tName} = 0;`);
        body.push(`    if (${tName} >= ${nName}) break; ${tName}++;`);
      } else if (meta?.kind === 'skip' && typeof meta.n === 'number') {
        const sName = `sk${i}`;
        const nName = `sn${i}`;
        argNames.push(nName);
        args.push(meta.n);
        prologue.push(`let ${sName} = 0;`);
        body.push(`    if (${sName} < ${nName}) { ${sName}++; continue; }`);
      } else {
        const name = `f${i}`;
        argNames.push(name);
        args.push(op);
        body.push(`    c = ${name}(c);`);
        body.push('    if (c === undefined) continue;');
      }
    }
    body.push('    out[k++] = c;');
    body.push('  }');
    body.push('  return k;');
    body.push('}');
    const factory = new Function(...argNames, [...prologue, ...body].join('\n')) as unknown as (
      ...ops: unknown[]
    ) => (src: T[], start: number, out: T[], k: number) => number;
      const compiled = factory(...args);
      return compiled;
  } catch {
    // ignore
  }
  return null;
}

export function compileArrayKernelUncheckedUnrolled<T = unknown>(
  ops: Array<FusedOp<T>>,
  unroll: number,
  opts: CompileOptions
): ((src: T[], start: number, out: T[], k: number) => number) | null {
  try {
    if (opts.jitMode === 'off') throw new Error('jit-disabled');
    // Exclude take (early break) for unrolled lanes to keep semantics simple
    for (const op of ops) {
      const meta = getOpMeta(op);
      if (meta?.kind === 'take') return null;
    }

    const argNames: string[] = [];
    const args: any[] = [];
    const prologue: string[] = [];
    const body: string[] = [];
    body.push('return function(src, start, out, k){');
    body.push('  const len = src.length;');
    body.push('  let i = start;');
    body.push(`  const stop = len - ((len - start) % ${unroll});`);
    body.push('  for (; i < stop; i += ' + unroll + ') {');
    for (let lane = 0; lane < unroll; lane++) {
      body.push(`    let c${lane} = src[i+${lane}];`);
      body.push(`    let s${lane} = false;`);
    }
    for (let idx = 0; idx < ops.length; idx++) {
        const op = ops[idx];
        const meta = getOpMeta(op);
      if (meta?.kind === 'filter' && typeof meta.predicate === 'function') {
        const name = `p${idx}`;
        argNames.push(name);
        args.push(meta.predicate);
        for (let lane = 0; lane < unroll; lane++) {
          body.push(`    if (!s${lane}) { if (!${name}(c${lane})) { s${lane} = true; } }`);
        }
      } else if (meta?.kind === 'scan' && typeof meta.scanFn === 'function') {
        const sName = `s${idx}`;
        const aName = `a${idx}`;
        argNames.push(sName, aName);
        args.push(meta.scanFn, meta.initial);
        prologue.push(`let ${aName} = ${aName};`);
        for (let lane = 0; lane < unroll; lane++) {
          body.push(`    if (!s${lane}) { ${aName} = ${sName}(${aName}, c${lane}); c${lane} = ${aName}; }`);
        }
      } else if (meta?.kind === 'skip' && typeof meta.n === 'number') {
        const skName = `sk${idx}`;
        const nName = `sn${idx}`;
        argNames.push(nName);
        args.push(meta.n);
        prologue.push(`let ${skName} = 0;`);
        for (let lane = 0; lane < unroll; lane++) {
          body.push(`    if (!s${lane}) { if (${skName} < ${nName}) { ${skName}++; s${lane} = true; } }`);
        }
      } else {
        const name = `f${idx}`;
        argNames.push(name);
        args.push(op);
        for (let lane = 0; lane < unroll; lane++) {
          body.push(`    if (!s${lane}) { c${lane} = ${name}(c${lane}); if (c${lane} === undefined) { s${lane} = true; } }`);
        }
      }
    }
    for (let lane = 0; lane < unroll; lane++) {
      body.push(`    if (!s${lane}) { out[k++] = c${lane}; }`);
    }
    body.push('  }');
    // Tail (scalar)
    body.push('  for (; i < len; i++) {');
    body.push('    let c = src[i];');
    for (let idx = 0; idx < ops.length; idx++) {
      const op = ops[idx];
      const meta = getOpMeta(op);
      if (meta?.kind === 'filter' && typeof meta.predicate === 'function') {
        const name = `tp${idx}`;
        argNames.push(name);
        args.push(meta.predicate);
        body.push(`    if (!${name}(c)) continue;`);
      } else if (meta?.kind === 'scan' && typeof meta.scanFn === 'function') {
        const sName = `ts${idx}`;
        const aName = `ta${idx}`;
        argNames.push(sName, aName);
        args.push(meta.scanFn, meta.initial);
        prologue.push(`let ${aName} = ${aName};`);
        body.push(`    ${aName} = ${sName}(${aName}, c);`);
        body.push(`    c = ${aName};`);
      } else if (meta?.kind === 'skip' && typeof meta.n === 'number') {
        const skName = `tsk${idx}`;
        const nName = `tsn${idx}`;
        argNames.push(nName);
        args.push(meta.n);
        prologue.push(`let ${skName} = 0;`);
        body.push(`    if (${skName} < ${nName}) { ${skName}++; continue; }`);
      } else {
        const name = `tf${idx}`;
        argNames.push(name);
        args.push(op);
        body.push(`    c = ${name}(c); if (c === undefined) continue;`);
      }
    }
    body.push('    out[k++] = c;');
    body.push('  }');
    body.push('  return k;');
    body.push('}');
    const factory = new Function(...argNames, [...prologue, ...body].join('\n')) as unknown as (
      ...ops: unknown[]
    ) => (src: T[], start: number, out: T[], k: number) => number;
    const compiled = factory(...args);
    return compiled;
  } catch {
    // ignore
  }
  return null;
}
