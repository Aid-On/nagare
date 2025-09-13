import { performance } from 'perf_hooks';
import { from, lastValueFrom, map as rxMap, filter as rxFilter, toArray as rxToArray, concatMap as rxConcatMap, reduce as rxReduce } from 'rxjs';
import nagare, { Nagare } from '../dist/index.js';

function fmtMs(ms) { return `${ms.toFixed(2)}ms`; }
function fmtOps(ops) { if (ops>=1e6) return `${(ops/1e6).toFixed(2)}M ops/s`; if (ops>=1e3) return `${(ops/1e3).toFixed(2)}K ops/s`; return `${ops.toFixed(2)} ops/s`; }
function median(arr){ const a=[...arr].sort((x,y)=>x-y); const m=a.length>>1; return a.length%2?a[m]:(a[m-1]+a[m])/2; }
function trimmedMean(arr, p=0.1){ const a=[...arr].sort((x,y)=>x-y); const k=Math.floor(a.length*p); const b=a.slice(k,a.length-k); return b.reduce((s,x)=>s+x,0)/b.length; }
async function measure(label, fn, {warmups=3, runs=8}={}){ for(let i=0;i<warmups;i++) await fn(); const times=[]; for(let i=0;i<runs;i++){ const t0=performance.now(); await fn(); times.push(performance.now()-t0);} const avg=times.reduce((a,b)=>a+b,0)/times.length; return {label, avg, median: median(times), trimmed: trimmedMean(times, 0.125)}; }
function checksum(arr){ let s=0; for(let i=0;i<arr.length;i++) s+=arr[i]; return s; }

async function benchMapFilter(N){
  console.log(`\n📊 Map + Filter (${N.toLocaleString()} elements)`);
  const data = Array.from({length:N}, (_,i)=>i);
  const expected = (()=>{ let s=0; for(let i=0;i<N;i++){ const v=i*2; if (v%3===0) s+=v; } return s; })();
  async function runNative(){ let out=[]; for(let i=0;i<data.length;i++){ const v=data[i]*2; if (v%3===0) out.push(v); } if (checksum(out)!==expected) throw new Error('native checksum mismatch'); }
  async function runRx(){ const out = await lastValueFrom(from(data).pipe(rxMap(x=>x*2), rxFilter(x=>x%3===0), rxToArray())); if (checksum(out)!==expected) throw new Error('rxjs checksum mismatch'); }
  async function runNagFast(){ Nagare.setJitMode('fast'); const out = await nagare.from(data).map(x=>x*2).filter(x=>x%3===0).toArray(); if (checksum(out)!==expected) throw new Error('nagare(fast) checksum mismatch'); }
  const rNative = await measure('Native', runNative); const rRx = await measure('RxJS', runRx); const rNagFast = await measure('Nagare(fast)', runNagFast); for (const r of [rNative,rRx,rNagFast]){ const ops=N/(r.trimmed/1000); console.log(`${r.label.padEnd(12)} ${fmtMs(r.trimmed).padStart(8)}  ${fmtOps(ops).padStart(12)}`);} }

async function benchScan(N){
  console.log(`\n📊 Scan/Reduce (${N.toLocaleString()} elements)`);
  const data = Array.from({length:N}, (_,i)=>i+1); const expected = N*(N+1)/2;
  async function runNative(){ let acc=0; for(let i=0;i<data.length;i++) acc+=data[i]; if (acc!==expected) throw new Error('native checksum mismatch'); }
  async function runRx(){ const out = await lastValueFrom(from(data).pipe(rxReduce((a,x)=>a+x, 0))); if (out!==expected) throw new Error('rxjs checksum mismatch'); }
  async function runNagFast(){ Nagare.setJitMode('fast'); const out = await nagare.from(data).scan((a,x)=>a+x,0).last(); if (out!==expected) throw new Error('nagare(fast) checksum mismatch'); }
  const rNative = await measure('Native', runNative); const rRx = await measure('RxJS', runRx); const rFast = await measure('Nagare(fast)', runNagFast); for (const r of [rNative,rRx,rFast]){ const ops=N/(r.trimmed/1000); console.log(`${r.label.padEnd(12)} ${fmtMs(r.trimmed).padStart(8)}  ${fmtOps(ops).padStart(12)}`);} }

async function benchConcatMap(N, inner=5){
  console.log(`\n📊 ConcatMap (${N.toLocaleString()} outer x ${inner} inner)`);
  const data = Array.from({length:N}, (_,i)=>i); const expectedCount = N*inner;
  async function runNative(){ let out=0; for(let i=0;i<data.length;i++){ for(let j=0;j<inner;j++) out+=1; } if (out!==expectedCount) throw new Error('native mismatch'); }
  async function runRx(){ const out = await lastValueFrom(from(data).pipe(rxConcatMap((x)=>from(Array.from({length:inner}, (_,j)=>x+j))), rxToArray())); if (out.length!==expectedCount) throw new Error('rxjs mismatch'); }
  async function runNagFast(){ Nagare.setJitMode('fast'); const out = await nagare.from(data).concatMap(async (x)=> nagare.of(...Array.from({length:inner},(_,j)=>x+j))).toArray(); if (out.length!==expectedCount) throw new Error('nagare(fast) mismatch'); }
  const rNative = await measure('Native', runNative, {runs:5}); const rRx = await measure('RxJS', runRx, {runs:5}); const rFast = await measure('Nagare(fast)', runNagFast, {runs:5}); for (const r of [rNative,rRx,rFast]){ const ops=expectedCount/(r.trimmed/1000); console.log(`${r.label.padEnd(12)} ${fmtMs(r.trimmed).padStart(8)}  ${fmtOps(ops).padStart(12)}`);} }

async function main(){
  console.log('🚀 Standard Streaming Benchmarks (src build)');
  console.log('='.repeat(60));
  console.log(`Node: ${process.version}  Platform: ${process.platform}/${process.arch}`);
  await benchMapFilter(100000);
  await benchScan(100000);
  await benchConcatMap(20000, 5);
  console.log('\nDone.');
}

main().catch((e)=>{ console.error(e); process.exit(1); });
