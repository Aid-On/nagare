import nagare, { Nagare } from '../dist/index.mjs';

function checksum(arr){ let s=0; for(let i=0;i<arr.length;i++) s+=arr[i]; return s; }

async function main(){
  const N = 30;
  const data = Array.from({length:N}, (_,i)=>i);
  const expected = (()=>{ let s=0; for(let i=0;i<N;i++){ const v=i*2; if (v%3===0) s+=v; } return s; })();
  Nagare.setJitMode('fast');
  Nagare.setFusionEnabled(false);
  const out = await nagare.from(data).map(x=>x*2).filter(x=>x%3===0).toArray();
  console.log('expected', expected, 'got', checksum(out), out);
}

main().catch(console.error);

