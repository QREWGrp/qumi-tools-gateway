import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import net from 'node:net';

async function availablePort(){const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return port;}
async function start(env={}){
 const port=await availablePort();
 const child=spawn(process.execPath,['src/server.js'],{cwd:new URL('../',import.meta.url).pathname,
  env:{...process.env,PORT:String(port),BIND_HOST:'127.0.0.1',PUBLIC_BASE_URL:`http://127.0.0.1:${port}`,TRUST_FLY_PROXY:'0',...env},stdio:['ignore','ignore','pipe']});
 const base=`http://127.0.0.1:${port}`;let ready=false;
 for(let i=0;i<80;i++){if(child.exitCode!==null)break;try{const r=await fetch(base+'/healthz',{headers:env.TRUST_FLY_PROXY==='1'?{'Fly-Client-IP':'198.51.100.17'}:{}});if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,40));}
 if(!ready){child.kill();throw Error('Gateway failed to start');}
 return {base,child,stop:()=>new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM');setTimeout(()=>resolve(),1000).unref();})};
}
const rpc=(method,params,id=1)=>({jsonrpc:'2.0',id,method,params});
const call=(base,method,params,session,extra={})=>fetch(base+'/mcp',{method:'POST',headers:{'content-type':'application/json',...(session?{'mcp-session-id':session}:{}),...extra},body:JSON.stringify(rpc(method,params))});
const initialize=async(base,headers={})=>{const r=await call(base,'initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}},undefined,headers);return {r,session:r.headers.get('mcp-session-id'),result:await r.json()};};

test('five simultaneous sessions/IP; sixth refused; DELETE releases a slot; no session leakage',async()=>{
 const g=await start();try{
  const sessions=[];for(let i=0;i<5;i++){const result=await initialize(g.base);assert.equal(result.r.status,200);assert.ok(result.session);sessions.push(result.session);}
  const denied=await initialize(g.base);assert.equal(denied.r.status,429);
  const stranger=await call(g.base,'tools/list',{},'invalid-session');assert.equal(stranger.status,404);
  const deleted=await fetch(g.base+'/mcp',{method:'DELETE',headers:{'mcp-session-id':sessions[0]}});assert.equal(deleted.status,204);
  const old=await call(g.base,'tools/list',{},sessions[0]);assert.equal(old.status,404);
  const sixth=await initialize(g.base);assert.equal(sixth.r.status,200);
  assert.equal((await call(g.base,'tools/list',{},sessions[1])).status,200);
 }finally{await g.stop();}
});

test('per-IP rate limiter returns 429 and retry-after',async()=>{
 const g=await start({MAX_REQUESTS_PER_MINUTE:'10',MAX_SESSION_REQUESTS_PER_MINUTE:'50'});try{
  const {session}=await initialize(g.base);
  let denied=false;for(let i=0;i<16;i++){const r=await call(g.base,'ping',{},session);if(r.status===429){denied=true;assert.ok(Number(r.headers.get('retry-after'))>=1);break;}}
  assert.equal(denied,true);
 }finally{await g.stop();}
});

test('sessions are bound to trusted Fly client IP when enabled; spoofed X-Forwarded-For ignored',async()=>{
 const g=await start({TRUST_FLY_PROXY:'1',ALLOW_TEST_FLY_HEADER:'1'});try{
  const a=await initialize(g.base,{'Fly-Client-IP':'198.51.100.17','X-Forwarded-For':'203.0.113.8'});
  assert.equal(a.r.status,200);
  const wrong=await call(g.base,'tools/list',{},a.session,{'Fly-Client-IP':'198.51.100.18'});
  assert.equal(wrong.status,404);
  const right=await call(g.base,'tools/list',{},a.session,{'Fly-Client-IP':'198.51.100.17','X-Forwarded-For':'198.51.100.18'});
  assert.equal(right.status,200);
  const missing=await call(g.base,'tools/list',{},a.session);
  assert.equal(missing.status,400);
 }finally{await g.stop();}
});

test('tool registry, restricted CLI help, mutation and arbitrary command refusal',async()=>{
 const g=await start();try{
  const {session}=await initialize(g.base);
  const list=await (await call(g.base,'tools/list',{},session)).json();
  assert.deepEqual(list.result.tools.slice(0,7).map(t=>t.name),['gateway_status','cli_catalog','cli_help','cli_read','credential_begin','credential_forget','session_end']);
  for(const name of ['fly_status','fly_machine_list','fly_checks_list','fly_releases','fly_logs','ionos_dns_zones','ionos_dns_zone','ionos_domains','ionos_ssl_certificates'])assert.ok(list.result.tools.some(t=>t.name===name),name);
  const help=await (await call(g.base,'tools/call',{name:'cli_help',arguments:{provider:'npm'}},session)).json();
  assert.equal(help.result.isError,false,JSON.stringify(help.result));
  assert.match(help.result.content[0].text,/Usage|npm/i);
  const mutation=await (await call(g.base,'tools/call',{name:'cli_read',arguments:{operation:'npm_publish'}},session)).json();
  assert.equal(mutation.result.isError,true);
  const injected=await (await call(g.base,'tools/call',{name:'cli_help',arguments:{provider:'npm',command:['run;rm -rf /']}},session)).json();
  assert.equal(injected.result.isError,true);
 }finally{await g.stop();}
});

test('credential portal hybrid encryption, single-use, session-only, revoke immediately',async()=>{
 const g=await start();try{
  const {session}=await initialize(g.base);
  const begin=await (await call(g.base,'tools/call',{name:'credential_begin',arguments:{provider:'npm'}},session)).json();
  assert.equal(begin.result.isError,false);
  const details=JSON.parse(begin.result.content[0].text);const url=details.url;
  assert.equal(details.persistence,'Memory only; expires when the session ends');
  const page=await fetch(url);assert.equal(page.status,200);const html=await page.text();
  assert.match(html,/Saved|saved passwords|password manager/i);
  const jwk=JSON.parse(/const jwk=(\{[^;]+\}),csrf=/.exec(html)[1]);
  const csrf=JSON.parse(/,csrf=("[^"]+")/.exec(html)[1]);
  const testToken='test-only-not-real-npm-token-1234567890';
  const rsa=await crypto.webcrypto.subtle.importKey('jwk',jwk,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
  const aes=await crypto.webcrypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
  const raw=await crypto.webcrypto.subtle.exportKey('raw',aes);const wrapped=await crypto.webcrypto.subtle.encrypt({name:'RSA-OAEP'},rsa,raw);
  const iv=crypto.randomBytes(12);
  const ciphertext=await crypto.webcrypto.subtle.encrypt({name:'AES-GCM',iv},aes,Buffer.from(JSON.stringify({token:testToken})));
  const payload={wrapped:Buffer.from(wrapped).toString('base64'),iv:iv.toString('base64'),ciphertext:Buffer.from(ciphertext).toString('base64')};
  assert.ok(!JSON.stringify(payload).includes(testToken));
  const forbidden=await fetch(url,{method:'POST',headers:{origin:'https://evil.invalid','x-gateway-csrf':csrf,'content-type':'application/json'},body:JSON.stringify(payload)});
  assert.equal(forbidden.status,403);
  const posted=await fetch(url,{method:'POST',headers:{origin:g.base,'x-gateway-csrf':csrf,'content-type':'application/json'},body:JSON.stringify(payload)});
  assert.equal(posted.status,200);assert.ok(!(await posted.text()).includes(testToken));
  const second=await fetch(url);assert.equal(second.status,410);
  const status=await (await call(g.base,'tools/call',{name:'gateway_status',arguments:{}},session)).json();
  assert.equal(JSON.parse(status.result.content[0].text).credentials.npm,true);
  const ended=await (await call(g.base,'tools/call',{name:'session_end',arguments:{}},session)).json();
  assert.equal(JSON.parse(ended.result.content[0].text).credentialsErased,true);
  assert.equal((await call(g.base,'tools/list',{},session)).status,404);
 }finally{await g.stop();}
});

test('Fly internal liveness probe does not require public Host or Fly client-IP, while MCP still does',async()=>{
 const g=await start({TRUST_FLY_PROXY:'1',ALLOW_TEST_FLY_HEADER:'1'});
 try{
  const internal=await fetch(g.base+'/healthz',{headers:{Host:'internal-healthcheck.invalid'}});
  assert.equal(internal.status,200);
  assert.equal((await internal.json()).status,'ok');
  const mcp=await call(g.base,'tools/list',{},'invalid');
  assert.equal(mcp.status,400);
 }finally{await g.stop();}
});
test('negotiates supported session-based MCP revisions and rejects unsupported stateless version',async()=>{
 const g=await start();
 try{
  for(const version of ['2025-03-26','2025-06-18','2025-11-25']){
    const init=await call(g.base,'initialize',{protocolVersion:version,capabilities:{},clientInfo:{name:'test',version:'1'}});
    const answer=await init.json();
    assert.equal(init.status,200); assert.equal(answer.result.protocolVersion,version);
    await fetch(g.base+'/mcp',{method:'DELETE',headers:{'mcp-session-id':init.headers.get('mcp-session-id')}});
  }
  const bad=await call(g.base,'initialize',{protocolVersion:'2026-07-28',capabilities:{}});
  const message=await bad.json();assert.equal(message.error.code,-32602);
  assert.equal(bad.headers.get('mcp-session-id'),null);
 }finally{await g.stop();}
});
