import crypto from 'node:crypto';
import {planWrite,hasToken,executeWrite} from './write.js';
const TTL=120000;
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function writeBegin(session,{operation,args}={},base,env=process.env){
 if(session.closed)throw Error('Session revoked');
 const plan=planWrite(operation,args,env);
 if(!hasToken(session,plan))throw Error(plan.provider+' token not connected to this session');
 session.approvals??=new Map();
 for(const [id,p] of session.approvals)if(p.expires<=Date.now())session.approvals.delete(id);
 if(session.approvals.size>=1)throw Error('Finish or expire the existing write approval first');
 const id=crypto.randomBytes(32).toString('base64url');
 session.approvals.set(id,{plan,expires:Date.now()+TTL,csrf:crypto.randomBytes(24).toString('base64url'),approved:false});
 return {approval_id:id,provider:plan.provider,operation:plan.name,target:plan.target,approval_url:base+'/approve/'+id,expiresInSeconds:120,requirements:'Open the HTTPS link, verify the exact operation and target, and explicitly approve. Then call write_execute with approval_id. The provider will independently enforce token scopes.',persistence:'Session memory only'};
}
export async function writeExecute(session,{approval_id}={},options={}){
 if(session.closed)throw Error('Session revoked');
 if(typeof approval_id!=='string'||!(/^[a-zA-Z0-9_-]{43}$/.test(approval_id)))throw Error('Invalid approval ID');
 const p=session.approvals?.get(approval_id);
 if(!p||p.expires<Date.now())throw Error('Write approval expired or unknown');
 if(!p.approved)throw Error('Explicit approval required; confirm the exact operation using the secure HTTPS link');
 session.approvals.delete(approval_id); // consume before network call; never retry writes automatically
 return executeWrite(session,p.plan,options);
}
export async function serveApproval(req,res,pathname,base,sessions){
 const id=pathname.split('/')[2];
 let found;
 if(typeof id==='string'&&/^[a-zA-Z0-9_-]{43}$/.test(id)){
  for(const s of sessions.values()){const a=s.approvals?.get(id);if(a){found={s,a};break;}}
 }
 const headers={'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
 const send=(status,body)=>{res.writeHead(status,headers);res.end(body);};
 if(!found||found.s.closed||found.a.expires<Date.now())return send(410,'This approval has expired or the MCP session was revoked.');
 const {a}=found;
 if(req.method==='GET'){
  const view='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Confirm provider mutation</title><style>body{font:16px system-ui;margin:5vh auto;max-width:590px;padding:24px;background:#141927;color:white}main{padding:24px;border:1px solid #8593a8;border-radius:12px}button{padding:12px;margin-top:16px}strong{color:#ffbb55}</style></head><body><main><h1>Approve a provider write</h1><p>You are authorizing an actual provider-side change, not a read-only lookup.</p><p>Provider: <strong>'+escape(a.plan.provider)+'</strong></p><p>Operation: <strong>'+escape(a.plan.name)+'</strong></p><p>Target: <strong>'+escape(a.plan.target)+'</strong></p><pre>'+escape(JSON.stringify(a.plan.body??a.plan.argv??{},null,2))+'</pre><p>Only approve if this matches your intent. Provider token scope still applies.</p><form method="POST"><input type="hidden" name="csrf" value="'+escape(a.csrf)+'"><label><input type="checkbox" name="confirm" value="yes" required> I authorize this specific change</label><button type="submit">Approve once</button></form></main></body></html>';
  return send(200,view);
 }
 if(req.method!=='POST')return send(405,'Unsupported method');
 if(req.headers.origin!==base)return send(403,'Invalid request origin');
 let body='';for await(const c of req){body+=c;if(body.length>2048)return send(413,'Request too large');}
 const form=new URLSearchParams(body);
 if(form.get('csrf')!==a.csrf||form.get('confirm')!=='yes')return send(403,'Explicit approval required');
 if(a.approved)return send(409,'Approval already submitted');
 a.approved=true;
 return send(200,'Approved once. Return to your agent to execute the pending action.');
}
