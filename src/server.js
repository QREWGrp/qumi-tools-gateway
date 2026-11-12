import http from 'node:http';
import crypto from 'node:crypto';
import {clientIp,limits,sessions,newSession,lookupSession,closeSession,prune,rateLimit,sessionRateLimit,sessionStatus} from './sessions.js';
import {beginCredential,servePortal} from './portal.js';
import {cliCatalog,cliHelp,cliRead} from './cli.js';

const port=Number(process.env.PORT||8080);
const bind=process.env.BIND_HOST||'0.0.0.0';
const trustFly=process.env.TRUST_FLY_PROXY==='1';
const base=(process.env.PUBLIC_BASE_URL || (process.env.FLY_APP_NAME?`https://${process.env.FLY_APP_NAME}.fly.dev`:`http://127.0.0.1:${port}`)).replace(/\/$/,'');
const publicUrl=new URL(base);
if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid port');
if(!['http:','https:'].includes(publicUrl.protocol)||publicUrl.username||publicUrl.password||publicUrl.search||publicUrl.hash||publicUrl.pathname!=='/')throw Error('Invalid PUBLIC_BASE_URL');
if(bind!=='127.0.0.1' && publicUrl.protocol!=='https:')throw Error('Public gateway requires HTTPS base URL and Fly TLS termination');
if(trustFly && !process.env.FLY_APP_NAME && process.env.ALLOW_TEST_FLY_HEADER!=='1')throw Error('TRUST_FLY_PROXY requires a Fly deployment');
if(trustFly && bind==='::')throw Error('Fly gateway must not bind the IPv6 private-network interface');
const allowedOrigins=new Set([base,...(process.env.MCP_ALLOWED_ORIGINS||'').split(',').filter(Boolean)]);
const maxBody=24*1024;
const respond=(res,code,data,headers={})=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store','x-content-type-options':'nosniff',...headers});res.end(JSON.stringify(data));};
const error=(id,code,message)=>({jsonrpc:'2.0',id,error:{code,message}});
const success=(id,result)=>({jsonrpc:'2.0',id,result});
const toolResult = data=>({content:[{type:'text',text:JSON.stringify(data)}],isError:false});
const definitions=[
 {name:'gateway_status',description:'Read session status, session-only credential readiness and rate/session limits. Never returns secrets.',inputSchema:{type:'object',properties:{}}},
 {name:'cli_catalog',description:'Discover which safe npm/Depot operations are provided on this public read-only gateway.',inputSchema:{type:'object',properties:{}}},
 {name:'cli_help',description:'Inspect help from an installed npm or Depot CLI. Does not execute a user command.',inputSchema:{type:'object',properties:{provider:{type:'string',enum:['npm','depot']},command:{type:'array',items:{type:'string'}}},required:['provider']}},
 {name:'cli_read',description:'Execute one tightly allowlisted read-only CLI operation. No script execution, arbitrary shell or mutating operations.',inputSchema:{type:'object',properties:{operation:{type:'string',enum:['npm_ping','npm_view','npm_search','npm_whoami','depot_projects','depot_builds']},package:{type:'string'},field:{type:'string'},query:{type:'string'},project_id:{type:'string'}},required:['operation']}},
 {name:'credential_begin',description:'Request a secure HTTPS question for a user-supplied Depot/npm token. NEVER paste the token into chat; session-only RAM, 5-minute one-time link.',inputSchema:{type:'object',properties:{provider:{type:'string',enum:['npm','depot']}},required:['provider']}},
 {name:'credential_forget',description:'Erase a provider token from this session immediately.',inputSchema:{type:'object',properties:{provider:{type:'string',enum:['npm','depot']}},required:['provider']}},
 {name:'session_end',description:'Immediately revoke the MCP session and erase any session-bound provider credentials.',inputSchema:{type:'object',properties:{}}}
];
async function invoke(s,name,args){
 if(name==='gateway_status')return sessionStatus(s);
 if(name==='cli_catalog')return cliCatalog(s);
 if(name==='cli_help')return cliHelp(s,args);
 if(name==='cli_read')return cliRead(s,args);
 if(name==='credential_begin')return beginCredential(s,args.provider,base);
 if(name==='credential_forget'){
  if(!['npm','depot'].includes(args.provider))throw Error('Invalid provider');
  const name=args.provider==='npm'?'NPM_TOKEN':'DEPOT_TOKEN';
  const buf=s.secrets.get(name);if(buf)buf.fill(0);s.secrets.delete(name);
  return {forgotten:true,provider:args.provider};
 }
 if(name==='session_end'){closeSession(s);return {closed:true,credentialsErased:true};}
 throw Error('Unknown tool');
}
const server=http.createServer(async(req,res)=>{
 try{
  prune();
  // Fly's internal health probe may not include the public Host or Fly-Client-IP.
  // Only liveness is exempt; the MCP and credential paths keep all restrictions.
  const pathname=new URL(req.url||'/',base).pathname;
  if(pathname==='/healthz'&&req.method==='GET')return respond(res,200,{status:'ok',service:'engineering-mcp-gateway'});
  const ip=clientIp(req,trustFly);
  if(!ip)return respond(res,400,{error:'Client IP could not be verified'});
  const rate=rateLimit(ip);
  if(!rate.ok)return respond(res,429,{error:'Too many requests from this IP'}, {'retry-after':String(rate.retryAfter)});
  const origin=req.headers.origin;
  if(origin && !allowedOrigins.has(origin))return respond(res,403,{error:'Origin denied'});
  if(req.headers.host!==publicUrl.host)return respond(res,403,{error:'Invalid gateway host'});
  if(pathname==='/'&&req.method==='GET')return respond(res,200,{service:'Engineering CLI MCP Gateway',mcp:'/mcp',documentation:'https://github.com/QREWGrp/qumi-tools-gateway',mode:'public-discovery/read-only-execution',
    warning:'Anonymous sessions are not identities; commands are allowlisted, tokens stay in memory until session termination.'});
  if(pathname.startsWith('/credential/'))return await servePortal(req,res,pathname,base);
  if(pathname!=='/mcp')return respond(res,404,{error:'Not found'});
  if(req.method==='GET')return respond(res,405,{error:'SSE GET not supported'},{Allow:'POST, DELETE'});
  const id=req.headers['mcp-session-id'];
  if(req.method==='DELETE'){
    const s=lookupSession(id,ip);if(!s)return respond(res,404,{error:'Session not found'});
    closeSession(s);res.writeHead(204,{'cache-control':'no-store'});return res.end();
  }
  if(req.method!=='POST')return respond(res,405,{error:'Method not allowed'},{Allow:'POST, DELETE'});
  let body='';for await(const chunk of req){body+=chunk;if(body.length>maxBody)return respond(res,413,{error:'Request too large'});}
  let rpc;try{rpc=JSON.parse(body);}catch{return respond(res,400,error(null,-32700,'Parse error'));}
  if(!rpc||Array.isArray(rpc)||rpc.jsonrpc!=='2.0'||typeof rpc.method!=='string')return respond(res,400,error(rpc?.id??null,-32600,'Invalid Request'));
  if(rpc.method==='initialize'){
    if(id)return respond(res,400,error(rpc.id??null,-32600,'Initialize must not include existing session ID'));
    // Negotiate only compatible session-oriented protocol revisions. The 2026 stateless
    // revision requires a separate adapter and is intentionally not advertised here.
    const chosenVersion=rpc.params?.protocolVersion;
    if(!['2025-03-26','2025-06-18','2025-11-25'].includes(chosenVersion))
      return respond(res,200,error(rpc.id??null,-32602,'Unsupported MCP protocol revision; supported: 2025-03-26, 2025-06-18, 2025-11-25'));
    const created=newSession(ip);
    if(created.error)return respond(res,429,error(rpc.id??null,-32000,'Active session capacity reached'),{'retry-after':'30'});
    return respond(res,200,success(rpc.id,{protocolVersion:chosenVersion,capabilities:{tools:{listChanged:false}},serverInfo:{name:'engineering-mcp-gateway',version:'0.1.0'}}),{'MCP-Session-Id':created.session.id});
  }
  if(!id)return respond(res,400,error(rpc.id??null,-32000,'MCP-Session-Id required'));
  const s=lookupSession(id,ip);if(!s)return respond(res,404,error(rpc.id??null,-32000,'Session not found or expired'));
  const perSession=sessionRateLimit(s);
  if(!perSession.ok)return respond(res,429,error(rpc.id??null,-32000,'Session rate limit reached'),{'retry-after':String(perSession.retryAfter)});
  if(rpc.method.startsWith('notifications/')){res.writeHead(202);return res.end();}
  if(rpc.method==='ping')return respond(res,200,success(rpc.id,{}));
  if(rpc.method==='tools/list')return respond(res,200,success(rpc.id,{tools:definitions}));
  if(rpc.method==='tools/call'){
    const name=rpc.params?.name,args=rpc.params?.arguments??{};
    if(!definitions.some(x=>x.name===name))return respond(res,200,success(rpc.id,{content:[{type:'text',text:'Unknown tool'}],isError:true}));
    if(typeof args!=='object'||args===null||Array.isArray(args))return respond(res,400,error(rpc.id,-32602,'Arguments must be an object'));
    try {const result=await invoke(s,name,args);return respond(res,200,success(rpc.id,toolResult(result)));}
    catch(e){return respond(res,200,success(rpc.id,{content:[{type:'text',text:e.message.slice(0,300)}],isError:true}));}
  }
  return respond(res,200,error(rpc.id??null,-32601,'Method not found'));
 }catch(e){return !res.headersSent?respond(res,500,{error:'Internal gateway error'}):res.end();}
});
const housekeeping=setInterval(prune,30_000);housekeeping.unref();
process.once('SIGTERM',()=>{for(const s of sessions.values())closeSession(s);server.close(()=>process.exit(0));});
process.once('SIGINT',()=>{for(const s of sessions.values())closeSession(s);server.close(()=>process.exit(0));});
server.listen(port,bind,()=>process.stderr.write(`Engineering MCP Gateway ready on ${bind}:${port}; Fly proxy mode ${trustFly}; max ${limits.perIp} sessions/IP\n`));
