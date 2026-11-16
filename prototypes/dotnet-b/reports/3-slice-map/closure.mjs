// import closure (runtime imports only: skips `import type`), from an entry; prints lines per file
import fs from 'node:fs'; import path from 'node:path';
const root=process.cwd();
const entry=process.argv[2];
const seen=new Map();
function resolve(from,spec){
  if(!spec.startsWith('.')) return null;
  const b=path.resolve(path.dirname(from),spec);
  for(const c of [b+'.ts',path.join(b,'index.ts'),b]) if(fs.existsSync(c)&&fs.statSync(c).isFile()) return c;
  return null;
}
function visit(f){
  if(seen.has(f)) return; const src=fs.readFileSync(f,'utf8'); seen.set(f,src.split('\n').length-(src.endsWith('\n')?1:0));
  const re=/^\s*(import|export)\s+(type\s+)?([^;]*?)\s*from\s*['"]([^'"]+)['"]/gms;
  let m; while((m=re.exec(src))){ if(m[2]) continue;
    const names=m[3]; if(/^\{[^}]*\}$/.test(names.trim())){ const items=names.trim().slice(1,-1).split(',').map(s=>s.trim()).filter(Boolean); if(items.length&&items.every(s=>s.startsWith('type '))) continue; }
    const r=resolve(f,m[4]); if(r) visit(r);}
  const re2=/^\s*import\s+['"]([^'"]+)['"]/gm; while((m=re2.exec(src))){const r=resolve(f,m[1]); if(r) visit(r);}
}
visit(path.resolve(entry));
let tot=0; for(const [f,n] of [...seen].sort()){ console.log(n.toString().padStart(6), path.relative(root,f)); tot+=n;}
console.log(tot,'total',seen.size,'files');
