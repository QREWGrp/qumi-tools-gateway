import test from 'node:test';
import assert from 'node:assert/strict';
import {planWrite,writeDefinitions,executeWrite} from '../src/write.js';
import {writeBegin,writeExecute,serveApproval} from '../src/approvals.js';
import {newSession,closeSession,sessions} from '../src/sessions.js';

const Z='12345678-1234-1234-1234-123456789012',R='87654321-1234-1234-1234-123456789012';
test('Fly writes use fixed endpoints and reject gateway self-mutation',()=>{
 for(const a of ['start','stop','restart']){
  const p=planWrite('fly_machine_'+a,{app:'target-app',machine_id:'1234567890abcdef'},{FLY_APP_NAME:'qumi-tools-gateway'});
  assert.equal(p.method,'POST');
  assert.ok(p.url.endsWith('/'+a));
 }
 assert.throws(()=>planWrite('fly_machine_stop',{app:'qumi-tools-gateway',machine_id:'1234567890abcdef'},{FLY_APP_NAME:'qumi-tools-gateway'}),/cannot modify/);
 assert.throws(()=>planWrite('fly_machine_stop',{app:'target-app',machine_id:'..%2F..'},{}),/Invalid/);
});
test('IONOS DNS writes validate UUIDs, type, TTL and content',()=>{
 const data={zone_id:Z,name:'www.example.com',type:'A',content:'192.0.2.10',ttl:3600};
 const p=planWrite('ionos_dns_record_create',data);
 assert.equal(p.method,'POST');assert.equal(p.body[0].type,'A');
 assert.equal(planWrite('ionos_dns_record_update',{...data,record_id:R}).method,'PUT');
 assert.equal(planWrite('ionos_dns_record_delete',{zone_id:Z,record_id:R}).method,'DELETE');
 assert.throws(()=>planWrite('ionos_dns_record_create',{...data,ttl:1}),/TTL/);
 assert.throws(()=>planWrite('ionos_dns_record_create',{...data,content:'invalid'}),/IPv4/);
});
test('npm and Depot write parameters cannot inject flags, commands or remote registries',()=>{
 const a=planWrite('npm_dist_tag_add',{package:'@scope/package',version:'1.2.3',tag:'latest'});
 assert.deepEqual(a.argv,['dist-tag','add','@scope/package@1.2.3','latest','--registry=https://registry.npmjs.org/']);
 assert.equal(planWrite('depot_ci_cancel',{run_id:'run_12345678',org_id:'org_12345678'}).command,'depot');
 assert.throws(()=>planWrite('npm_dist_tag_add',{package:'pkg',version:'1.2.3',tag:'x;rm -rf /'}),/Invalid/);
 assert.throws(()=>planWrite('depot_ci_cancel',{run_id:'--yes',org_id:'org_12345678'}),/Invalid/);
 assert.equal(writeDefinitions.length,9);
});
test('provider writes do not execute without user-scoped credentials',async()=>{
 const session={closed:false,secrets:new Map()};
 const plan=planWrite('ionos_dns_record_delete',{zone_id:Z,record_id:R});
 await assert.rejects(()=>executeWrite(session,plan,{fetcher:()=>{throw Error('Should not execute')}}),/not configured/);
 session.secrets.set('IONOS_API_KEY',Buffer.from('synthetic-not-real'));
 let recorded;
 const r=await executeWrite(session,plan,{fetcher:async(url,init)=>{recorded={url,init};return {ok:true,status:204,text:async()=>''}}});
 assert.equal(r.status,204);assert.equal(recorded.init.method,'DELETE');assert.equal(recorded.init.headers['X-API-Key'],'synthetic-not-real');
});
test('write execution requires browser approval and cannot be replayed',async()=>{
 const created=newSession('192.0.2.44');const s=created.session;
 s.secrets.set('FLY_API_TOKEN',Buffer.from('synthetic-not-real'));
 try{
  const started=writeBegin(s,{operation:'fly_machine_start',args:{app:'target-app',machine_id:'1234567890abcdef'}},'https://gateway.example',{FLY_APP_NAME:'qumi-tools-gateway'});
  const id=started.approval_id;
  await assert.rejects(()=>writeExecute(s,{approval_id:id}),/Explicit approval/);
  const page=s.approvals.get(id);
  const form='csrf='+encodeURIComponent(page.csrf)+'&confirm=yes';
  const res={writeHead(status){this.status=status},end(body){this.body=body}};
  const req={method:'POST',headers:{origin:'https://gateway.example'},[Symbol.asyncIterator]:async function*(){yield form}};
  await serveApproval(req,res,'/approve/'+id,'https://gateway.example',sessions);
  assert.equal(res.status,200);
  let count=0;
  const output=await writeExecute(s,{approval_id:id},{fetcher:async(url,init)=>{count++;assert.ok(url.endsWith('/start'));return {ok:true,status:200,text:async()=>'{"ok":true}'}}});
  assert.equal(output.ok,true);assert.equal(count,1);
  await assert.rejects(()=>writeExecute(s,{approval_id:id}),/unknown/);
 }finally{closeSession(s);}
});
test('approval is revoked with the session and cannot authorize any later request',()=>{
 const s=newSession('192.0.2.52').session;s.secrets.set('NPM_TOKEN',Buffer.from('synthetic-not-real'));
 const started=writeBegin(s,{operation:'npm_dist_tag_remove',args:{package:'my-package',tag:'beta'}},'https://gateway.example');
 closeSession(s);
 assert.equal(s.approvals?.size??0,0);
 assert.equal(s.secrets.size,0);
});
