// Loopback-only PostgreSQL test adapter. It is NOT Supabase/PostgREST/GoTrue.
// Auth is synthetic; SQL functions, constraints, transactions and RLS are real.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { createDatabase, asUser, id } from './database.mjs';

let db = await createDatabase({ migrated: process.env.BASELINE !== '1' });
const port = Number(process.env.TEST_PORT || 4173);
const tables = new Set(['profiles','teams','athlete_teams','exercises','session_templates','template_exercises','programmed_sessions','session_exercises','session_assignments','workout_logs','workout_exercises','set_logs']);
const quote = (name) => { if (!/^[a-z_]+$/.test(name)) throw Error('Invalid identifier'); return '"' + name + '"'; };
const metrics = [];
const session = (coach) => ({ access_token: coach ? 'fixture-coach' : 'fixture-athlete', refresh_token: coach ? 'fixture-coach' : 'fixture-athlete', expires_at: 9999999999, user: { id: id(coach ? 900 : 901) } });
let failNext = false, latency = 80;

async function rest(tx, table, url, method, body) {
  if (!tables.has(table)) throw Error('Unknown test table');
  const params = [], clauses = [], query = url.searchParams;
  const bind = (value) => { params.push(value); return '$' + params.length; };
  const filter = (key, value) => {
    if (key.includes('.')) return; // embedded date filters are applied below
    const col = `t.${quote(key)}`;
    if (value.startsWith('eq.')) clauses.push(`${col} = ${bind(value.slice(3))}`);
    else if (value.startsWith('gte.')) clauses.push(`${col} >= ${bind(value.slice(4))}`);
    else if (value.startsWith('lte.')) clauses.push(`${col} <= ${bind(value.slice(4))}`);
    else if (value.startsWith('in.(')) clauses.push(`${col} in (${value.slice(4,-1).split(',').map(bind).join(',')})`);
  };
  for (const [key,value] of query) {
    if (['select','order','limit','on_conflict','offset'].includes(key)) continue;
    if (key === 'and') for (const term of value.slice(1,-1).split(',')) { const i=term.indexOf('.'); filter(term.slice(0,i),term.slice(i+1)); }
    else filter(key,value);
  }
  const where = clauses.length ? ' where ' + clauses.join(' and ') : '';
  if (method === 'DELETE') return (await tx.query(`delete from ${quote(table)} t${where} returning *`,params)).rows;
  if (method === 'PATCH') {
    const assignments = Object.entries(body).map(([key,value]) => `${quote(key)}=${bind(value)}`).join(',');
    return (await tx.query(`update ${quote(table)} t set ${assignments}${where} returning *`,params)).rows;
  }
  if (method === 'POST') {
    const rows = Array.isArray(body) ? body : [body], cols = [...new Set(rows.flatMap(Object.keys))];
    const values = rows.map(row => '(' + cols.map(col => bind(row[col] ?? null)).join(',') + ')').join(',');
    const conflict = query.get('on_conflict');
    const onConflict = conflict ? ` on conflict (${conflict.split(',').map(quote)}) do update set ` + cols.filter(c=>!conflict.split(',').includes(c)).map(c=>`${quote(c)}=excluded.${quote(c)}`).join(',') : '';
    return (await tx.query(`insert into ${quote(table)} (${cols.map(quote)}) values ${values}${onConflict} returning *`,params)).rows;
  }
  const order = (query.get('order') || '').split(',').filter(Boolean).map(item=>{ const [key,dir]=item.split('.'); return `t.${quote(key)} ${dir==='desc'?'desc':'asc'}`; }).join(',');
  const limit = Math.min(Number(query.get('limit') || 1000),1000), offset=Number(query.get('offset') || 0);
  let rows = (await tx.query(`select t.* from ${quote(table)} t${where}${order?' order by '+order:''} limit ${limit} offset ${offset}`,params)).rows;
  const select = query.get('select') || '*';
  for (const row of rows) {
    for (const [relation, column] of [['teams','team_id'],['profiles','athlete_id'],['programmed_sessions','session_id']]) {
      if (select.includes(relation+'(') || select.includes(relation+'!')) row[relation] = (await tx.query(`select * from ${relation} where id=$1`,[row[column]])).rows[0] || null;
    }
    if (select.includes('session_assignments(')) {
      row.session_assignments = (await tx.query('select * from session_assignments where session_id=$1',[row.id])).rows;
      for (const a of row.session_assignments) a.teams = (await tx.query('select * from teams where id=$1',[a.assigned_team_id])).rows[0] || null;
    }
  }
  if (table==='session_assignments' && query.has('programmed_sessions.session_date')) {
    const start=query.get('programmed_sessions.session_date').slice(4);
    const end=query.get('programmed_sessions.and')?.match(/lte\.([^)]*)/)?.[1];
    rows=rows.filter(r=>r.programmed_sessions?.session_date >= start && (!end || r.programmed_sessions.session_date <= end));
  }
  return rows;
}

const server = http.createServer(async (req,res) => {
  const start=performance.now(), url=new URL(req.url,`http://127.0.0.1:${port}`);
  const send=(data,status=200) => {res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  try {
    if (url.pathname==='/__test/reset') { await db.close(); db=await createDatabase(); metrics.length=0; failNext=false;latency=80;return send({ok:true}); }
    if (url.pathname==='/__test/control') { const body=JSON.parse(await bodyText(req)||'{}'); failNext=Boolean(body.failNext); latency=body.latency ?? latency; return send({ok:true}); }
    if (url.pathname==='/__test/metrics') return send(metrics);
    if (url.pathname==='/__test/db') return send({logs:(await db.query('select * from workout_logs')).rows,sets:(await db.query('select * from set_logs')).rows,exercises:(await db.query('select * from workout_exercises order by position')).rows});
    if (url.pathname==='/auth/v1/user') return send({id:id(req.headers.authorization?.includes('coach')?900:901)});
    if (url.pathname==='/auth/v1/signup') return send(session(false));
    if (url.pathname==='/auth/v1/token') { const body=JSON.parse(await bodyText(req)); if(body.email && (body.email!=='admin@example.test' || body.password!=='test-only-password')) return send({message:'Invalid credentials'},400); return send(session(body.email || body.refresh_token?.includes('coach'))); }
    if (url.pathname==='/auth/v1/logout') return send({});
    if (url.pathname.startsWith('/rest/v1/')) {
      const body=JSON.parse(await bodyText(req)||'null');
      const isWrite=req.method!=='GET';
      if(isWrite) await new Promise(resolve=>setTimeout(resolve,latency));
      if(failNext && isWrite && /save_workout|set_logs|finish_workout/.test(url.pathname)) { failNext=false; return send({message:'Injected test failure'},503); }
      const token=req.headers.authorization || '';
      const user=token.includes('fixture-coach')?id(900):token.includes('fixture-athlete')?id(901):null;
      const sqlStart=performance.now();
      const value=await asUser(db,user,async tx=>{
        if(url.pathname.includes('/rpc/')) {
          const name=url.pathname.split('/').at(-1), args=Object.entries(body || {});
          return (await tx.query(`select * from public.${quote(name)}(${args.map(([key],i)=>`${quote(key)} := $${i+1}`).join(',')})`,args.map(([,v])=>typeof v==='object' && v!==null?JSON.stringify(v):v))).rows;
        }
        return rest(tx,url.pathname.split('/').at(-1),url,req.method,body);
      });
      metrics.push({path:url.pathname,method:req.method,ms:performance.now()-start,sqlMs:performance.now()-sqlStart});
      if(url.pathname.includes('/rpc/verify_')) return send(Object.values(value[0])[0]);
      if(req.headers.accept?.includes('vnd.pgrst.object')) return value[0]?send(value[0]):send({message:'Not found'},406);
      return send(value);
    }
    if(url.pathname==='/app-config.js') {res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});return res.end(`window.CBI_CONFIG={supabaseUrl:'http://127.0.0.1:${port}',supabaseAnonKey:'fixture-public',environment:'test'};`);}
    const path=resolve('web',url.pathname==='/'?'index.html':'.'+url.pathname);
    if(!path.startsWith(resolve('web')+'/')) return send({},404);
    const content=await readFile(path);
    res.writeHead(200,{'Content-Type':({'.js':'text/javascript','.html':'text/html','.css':'text/css','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'})[extname(path)] || 'application/octet-stream','Cache-Control':'no-store'});res.end(content);
  } catch(error) { send({message:error.message,code:error.code},400); }
});
async function bodyText(req) { let body='';for await(const chunk of req)body+=chunk;return body; }
server.listen(port,'127.0.0.1',()=>console.log(`Isolated test server: http://127.0.0.1:${port}`));
