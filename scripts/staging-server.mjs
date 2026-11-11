// A fail-closed local preview of the real staging database, never .env/.env.local.
// No configuration files or credentials are written to the repository.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

try { process.loadEnvFile('.env.staging'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const required=['STAGING_SUPABASE_URL','STAGING_SUPABASE_ANON_KEY','PRODUCTION_SUPABASE_URL','STAGING_PROJECT_REF'];
const missing=required.filter(key=>!process.env[key]);
if(missing.length) { console.error('Staging blocked: configure '+missing.join(', ')+' in ignored .env.staging.'); process.exit(1); }
const stage=new URL(process.env.STAGING_SUPABASE_URL),production=new URL(process.env.PRODUCTION_SUPABASE_URL);
const key=process.env.STAGING_SUPABASE_ANON_KEY;
if(stage.protocol!=='https:' || production.protocol!=='https:' || stage.hostname===production.hostname
  || stage.hostname!==process.env.STAGING_PROJECT_REF+'.supabase.co' || stage.username || stage.password) {
  console.error('Staging blocked: distinct HTTPS projects and the expected staging project reference are required.');process.exit(1);
}
let publicKey=key.startsWith('sb_publishable_');
if(!publicKey) {
  try { const claims=JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString());publicKey=claims.role==='anon' && claims.ref===process.env.STAGING_PROJECT_REF; }
  catch { publicKey=false; }
}
if(!publicKey){console.error('Staging blocked: use the staging public anon/publishable key, never a privileged key.');process.exit(1);}
console.log('Staging configuration checks passed. Project separation is declared; verify the hosted preview configuration before deployment.');
if(process.argv.includes('--check')) process.exit(0);
const root=resolve('web');
http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:8081');
  res.setHeader('Cache-Control','no-store');
  if(url.pathname==='/app-config.js') {
    res.setHeader('Content-Type','text/javascript');
    return res.end('window.CBI_CONFIG='+JSON.stringify({supabaseUrl:stage.origin,supabaseAnonKey:key,environment:'staging'})+';');
  }
  const path=resolve(root,url.pathname==='/'?'index.html':'.'+url.pathname);
  if(!path.startsWith(root+'/')) {res.writeHead(403);return res.end();}
  try {
    const content=await readFile(path);
    res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[extname(path)] || 'application/octet-stream');
    res.end(content);
  }catch {res.writeHead(404);res.end();}
}).listen(8081,'127.0.0.1',()=>console.log('Staging preview: http://127.0.0.1:8081 (writes go to the declared staging project).'));
