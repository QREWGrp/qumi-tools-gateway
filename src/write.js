import net from 'node:net';
const defs=['fly_machine_start','fly_machine_stop','fly_machine_restart','ionos_dns_record_create','ionos_dns_record_update','ionos_dns_record_delete','npm_dist_tag_add','npm_dist_tag_remove','depot_ci_cancel'];
const APP=/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MACHINE=/^[0-9a-f]{12,32}$/i;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PACKAGE=/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const TAG=/^[a-z][a-z0-9._-]{0,31}$/;
const VERSION=/^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9a-zA-Z.-]+)?(?:\+[0-9a-zA-Z.-]+)?$/;
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{3,99}$/;
const HOST=/^(?:\*\.)?[a-z0-9](?:[a-z0-9.-]{0,240}[a-z0-9])?\.?$/i;
const AUTH={fly:'FLY_API_TOKEN',ionos:'IONOS_API_KEY',npm:'NPM_TOKEN',depot:'DEPOT_TOKEN'};
const fail=x=>{throw Error(x)};
const validate=(o,keys)=>{if(!o||typeof o!=='object'||Array.isArray(o))fail('Arguments must be an object');for(const k of Object.keys(o))if(!keys.includes(k))fail('Unrecognized argument: '+k)};
const check=(x,pattern,label)=>typeof x==='string'&&pattern.test(x)?x:fail('Invalid '+label);
export const writeDefinitions=defs.map(name=>({name,description:'State-changing, typed '+name+' operation. Requires a session-scoped provider token and explicit browser approval before execution.',inputSchema:{type:'object',properties:{operation:{type:'string'},args:{type:'object'}},additionalProperties:false},annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:false}}));
export function planWrite(name,args={},env=process.env){
 if(!defs.includes(name))fail('Write operation not permitted');
 if(name.startsWith('fly_machine_')){
  validate(args,['app','machine_id']);
  const app=check(args.app,APP,'Fly app'),machine=check(args.machine_id,MACHINE,'Fly machine');
  if(app===env.FLY_APP_NAME)fail('The gateway cannot modify its own Fly app');
  const action=name.slice('fly_machine_'.length);
  return {name,provider:'fly',target:app+'/'+machine,method:'POST',url:'https://api.machines.dev/v1/apps/'+app+'/machines/'+machine+'/'+action};
 }
 if(name.startsWith('ionos_dns_record_')){
  const action=name.slice('ionos_dns_record_'.length);
  const accepted=action==='create'?['zone_id','name','type','content','ttl']:action==='update'?['zone_id','record_id','name','type','content','ttl']:['zone_id','record_id'];
  validate(args,accepted);
  const zone=check(args.zone_id,UUID,'IONOS zone ID');
  const record=action==='create'?null:check(args.record_id,UUID,'IONOS record ID');
  const url='https://api.hosting.ionos.com/dns/v1/zones/'+zone+'/records'+(record?'/'+record:'');
  let body=null;
  if(action!=='delete'){
   const type=args.type;
   if(!['A','AAAA','CNAME','TXT'].includes(type))fail('Unsupported DNS record type');
   const nameValue=check(args.name,HOST,'DNS name'),value=args.content;
   if(typeof value!=='string'||value.length<1||value.length>500||/[\r\n\x00]/.test(value))fail('Invalid DNS content');
   if(type==='A'&&net.isIP(value)!==4)fail('A record requires IPv4');
   if(type==='AAAA'&&net.isIP(value)!==6)fail('AAAA record requires IPv6');
   if(type==='CNAME'&&!HOST.test(value))fail('CNAME requires a hostname');
   if(!Number.isInteger(args.ttl)||args.ttl<60||args.ttl>86400)fail('TTL out of range');
   const rec={name:nameValue,type,content:value,ttl:args.ttl,prio:0,disabled:false};
   body=action==='create'?[rec]:rec;
  }
  return {name,provider:'ionos',target:zone+(record?'/'+record:''),method:action==='create'?'POST':action==='update'?'PUT':'DELETE',url,body};
 }
 if(name.startsWith('npm_dist_tag_')){
  const action=name.slice('npm_dist_tag_'.length);
  validate(args,action==='add'?['package','version','tag']:['package','tag']);
  const pkg=check(args.package,PACKAGE,'npm package'),tag=check(args.tag,TAG,'npm tag');
  if(action==='add'){
   const version=check(args.version,VERSION,'npm version');
   return {name,provider:'npm',target:pkg+'@'+version+' -> '+tag,command:'npm',argv:['dist-tag','add',pkg+'@'+version,tag,'--registry=https://registry.npmjs.org/']};
  }
  return {name,provider:'npm',target:pkg+' : '+tag,command:'npm',argv:['dist-tag','rm',pkg,tag,'--registry=https://registry.npmjs.org/']};
 }
 validate(args,['run_id','org_id']);
 const run=check(args.run_id,ID,'Depot run ID'),org=check(args.org_id,ID,'Depot org ID');
 return {name,provider:'depot',target:org+'/'+run,command:'depot',argv:['ci','cancel',run,'--org',org,'--output','json']};
}
export function hasToken(s,plan){return s?.secrets?.has(AUTH[plan.provider])===true;}
export async function executeWrite(s,plan,{fetcher=fetch,cliWrite}={}){
 if(s.closed)fail('Session revoked');
 if(!hasToken(s,plan))fail('Provider credential not configured for this session');
 if(plan.command){
  if(typeof cliWrite!=='function')fail('CLI write runner unavailable');
  return cliWrite(s,plan.command,plan.argv);
 }
 const token=s.secrets.get(AUTH[plan.provider]).toString('utf8');
 const headers={Accept:'application/json'};
 if(plan.provider==='fly')headers.Authorization='Bearer '+token;
 else headers['X-API-Key']=token;
 if(plan.body)headers['Content-Type']='application/json';
 const controller=new AbortController();
 s.abort?.add(controller);
 let response,raw;
 try {
  response=await fetcher(plan.url,{method:plan.method,headers,body:plan.body?JSON.stringify(plan.body):undefined,redirect:'error',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(12000)])});
  if(!response.ok)fail(plan.provider+' denied mutation: HTTP '+response.status);
  raw=await response.text();
 } finally {controller.abort();s.abort?.delete(controller);}
 if(Buffer.byteLength(raw)>64000)fail('Provider response too large');
 if(!raw.trim())return {success:true,status:response.status};
 let result;
 try{result=JSON.parse(raw.replaceAll(token,'[REDACTED]'));}
 catch{return {success:true,status:response.status};}
 if(result?.errors?.length)fail('Provider rejected mutation');
 return result;
}
