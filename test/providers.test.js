import test from 'node:test';import assert from 'node:assert/strict';
import {providerRead} from '../src/providers.js';
import {coordinatorConfig,coordinatorRoute} from '../src/coordinator.js';
import {newSession,closeSession,sessions,limits} from '../src/sessions.js';
const user={closed:false,secrets:new Map([['FLY_API_TOKEN',Buffer.from('synthetic-fly-key')],['IONOS_API_KEY',Buffer.from('synthetic-ionos-key')]])};
const seen=[];
const fetcher=async(url,init)=>{seen.push({url,init});let result={};
  if(url.includes('api.machines.dev'))result=url.endsWith('/machines')?[{id:'m1',state:'started',region:'ams'}]:{name:'example-app',status:'deployed',machine_count:2};
  if(url.includes('api.fly.io/graphql'))result={data:{app:{releases:{nodes:[]}}}};
  if(url.includes('api.hosting.ionos.com'))result={zones:[],ready:true};
  return {ok:true,headers:{get:()=>null},text:async()=>JSON.stringify(result)};
};
test('Fly tools use fixed HTTPS endpoints and no writable operations',async()=>{
  const status=await providerRead(user,{operation:'fly_status',app:'example-app'},{fetcher});
  assert.equal(status.status,'deployed');
  const machines=await providerRead(user,{operation:'fly_machine_list',app:'example-app'},{fetcher});
  assert.equal(machines.length,1);
  await providerRead(user,{operation:'fly_releases',app:'example-app'},{fetcher});
  assert.ok(seen.every(x=>x.init.method==='GET'||x.init.method==='POST'));
  assert.ok(seen.find(x=>x.init.method==='POST').url.endsWith('/graphql'));
  await assert.rejects(()=>providerRead(user,{operation:'fly_status',app:'../../unsafe'},{fetcher}),/Invalid Fly app/);
  await assert.rejects(()=>providerRead(user,{operation:'fly_deploy',app:'example-app'},{fetcher}),/Unsupported/);
});
test('IONOS requires session key and fixed read-only domains/DNS/SSL API hosts',async()=>{
  for(const operation of ['ionos_dns_zones','ionos_ssl_certificates']){
    await providerRead(user,{operation},{fetcher});
    const r=seen.at(-1);assert.equal(r.init.method,'GET');assert.equal(r.init.headers['X-API-Key'],'synthetic-ionos-key');
    assert.ok(r.url.startsWith('https://api.hosting.ionos.com/'));
  }
  await providerRead(user,{operation:'ionos_domains',tenant_id:'tenant1'},{fetcher});
  assert.equal(seen.at(-1).init.headers['X-Tenant-Id'],'tenant1');
  await assert.rejects(()=>providerRead(user,{operation:'ionos_dns_delete'},{fetcher}),/Unsupported/);
  await assert.rejects(()=>providerRead(user,{operation:'ionos_dns_zone',zone_id:'../../etc'},{fetcher}),/Invalid zone_id/);
});
test('Fly replay sends every stateful path to a single coordinator',()=>{
  const env={FLY_APP_NAME:'qumi-tools-gateway',FLY_MACHINE_ID:'1234567890abcdef',MCP_COORDINATOR_MACHINE_ID:'fedcba9876543210'};
  const response={writeHead(code,headers){this.code=code;this.headers=headers;},end(){this.ended=true;}};
  assert.equal(coordinatorRoute({},response,'/mcp',env),true);
  assert.equal(response.code,307);
  assert.match(response.headers['fly-replay'],/instance=fedcba9876543210/);
  assert.equal(coordinatorRoute({},response,'/credential/test',env),true);
  assert.equal(coordinatorRoute({},response,'/mcp',{...env,FLY_MACHINE_ID:env.MCP_COORDINATOR_MACHINE_ID}),false);
  assert.equal(coordinatorRoute({},response,'/mcp',{FLY_APP_NAME:env.FLY_APP_NAME,FLY_MACHINE_ID:env.FLY_MACHINE_ID}),true);
  assert.equal(response.code,503);
  assert.equal(coordinatorConfig({...env,FLY_MACHINE_ID:env.MCP_COORDINATOR_MACHINE_ID}).ready,true);
});
test('global cap of five active sessions across IPs on coordinator',()=>{
  assert.equal(limits.global,5);
  for(const s of sessions.values())closeSession(s);
  const created=[];
  try {
    for(let i=0;i<5;i++){const r=newSession('198.51.100.'+(i+1));assert.ok(r.session);created.push(r.session);}
    assert.equal(newSession('203.0.113.100').error,'global_limit');
    closeSession(created.pop());
    const replacement=newSession('203.0.113.100');assert.ok(replacement.session);created.push(replacement.session);
  }finally{for(const s of created)closeSession(s);}
});
