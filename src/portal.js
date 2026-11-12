import crypto from 'node:crypto';
import {sessions} from './sessions.js';

const CLAIM_TTL_MS=5 * 60_000;
const keypair=()=>crypto.generateKeyPairSync('rsa',{modulusLength:3072,publicExponent:0x10001});
const encode=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const json=(res,code,data)=>{res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(data));};
export function beginCredential(session,provider,base){
 if(!['depot','npm','fly','ionos'].includes(provider))throw Error('provider must be depot, npm, fly or ionos');
 if(session.pending.size>=2)throw Error('Two credential requests already pending in this session');
 let totalPending=0;for(const current of sessions.values())totalPending+=current.pending.size;
 if(totalPending>=50)throw Error('Gateway credential question capacity reached');
 const {privateKey,publicKey}=keypair();
 const code=crypto.randomBytes(24).toString('base64url');
 const csrf=crypto.randomBytes(24).toString('base64url');
 session.pending.set(code,{provider,privateKey,publicKey,csrf,expires:Date.now()+CLAIM_TTL_MS,used:false});
 return {question:`Connect ${provider.toUpperCase()} for this active MCP session?`,
  url:`${base}/credential/${code}`,
  expiresInSeconds:300,
  instruction:'Open the HTTPS link and enter the token in its secure question. Do not paste a token into chat or a tool argument.',
  persistence:'Memory only; expires when the session ends',
  passwordManager:'You may use your own password manager to fill the protected form. The gateway cannot read it.'};
}
function findPending(code){
 if(!/^[\w-]{32}$/.test(code||''))return null;
 for(const s of sessions.values()){
  const p=s.pending.get(code);
  if(p){if(s.closed||p.used||p.expires<Date.now()){s.pending.delete(code);return null;}return {session:s,pending:p};}
 }
 return null;
}
function page(code,p){
 const jwk=JSON.stringify(p.publicKey.export({format:'jwk'}));
 const csrf=JSON.stringify(p.csrf);
 const provider=encode(p.provider.toUpperCase());
 const nonce=crypto.randomBytes(16).toString('base64');
 const html=`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${provider} — temporary gateway credential</title><style>body{font:16px system-ui,sans-serif;background:#f7f9fc;color:#15243b;max-width:600px;margin:7vh auto;padding:0 18px}main{background:white;padding:28px;border:1px solid #d9e1ec;border-radius:16px}label{font-weight:600;display:block;margin:16px 0 6px}input{padding:12px;box-sizing:border-box;width:100%;border:1px solid #64748b;border-radius:8px}button{margin-top:18px;padding:12px 20px;border:0;border-radius:9px;background:#1f2937;color:white;cursor:pointer}small{color:#475569;display:block;margin-top:12px}#message{margin-top:15px}</style></head><body><main><h1>Connect ${provider}</h1><p>Enter your own access token for this MCP session. The browser encrypts the answer before sending it to the gateway, over HTTPS.</p><form id="question"><label for="token">${provider} API token</label><input id="token" name="token" type="password" autocomplete="new-password" minlength="8" maxlength="8192" required autofocus><button type="submit">Encrypt and connect</button></form><p role="status" id="message"></p><small>This token is held only in gateway process memory, never added to Git or a persistent vault. The session is revoked on disconnect or expiry. Your saved passwords/personal vault may autofill here, but the gateway cannot fetch secrets from your agent's vault itself.</small></main><script nonce="${nonce}">const form=document.querySelector('#question'),msg=document.querySelector('#message');const jwk=${jwk},csrf=${csrf};const b64=b=>btoa(String.fromCharCode(...new Uint8Array(b)));form.addEventListener('submit',async event=>{event.preventDefault();msg.textContent='Encrypting…';const token=form.elements.token.value;try{const rsa=await crypto.subtle.importKey('jwk',jwk,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);const aes=await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);const raw=await crypto.subtle.exportKey('raw',aes);const wrapped=await crypto.subtle.encrypt({name:'RSA-OAEP'},rsa,raw);const iv=crypto.getRandomValues(new Uint8Array(12));const ct=await crypto.subtle.encrypt({name:'AES-GCM',iv},aes,new TextEncoder().encode(JSON.stringify({token})));form.elements.token.value='';const res=await fetch(location.pathname,{method:'POST',headers:{'content-type':'application/json','x-gateway-csrf':csrf},body:JSON.stringify({wrapped:b64(wrapped),iv:b64(iv),ciphertext:b64(ct)})});if(!res.ok)throw Error('Credential was not accepted');form.hidden=true;msg.textContent='Credential connected to the current MCP session. Return to your agent.';}catch(e){msg.textContent='Submission failed. Return to the agent and request a new secure question.';}});</script></body></html>`;
 return {html,nonce};
}
export async function servePortal(req,res,pathname,base){
 const code=pathname.split('/')[2];
 const found=findPending(code);
 if(!found)return json(res,410,{error:'Credential request expired or revoked'});
 const {session,pending:p}=found;
 if(req.method==='GET'){
  const {html,nonce}=page(code,p);
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer',
   'x-content-type-options':'nosniff','x-frame-options':'DENY',
   'content-security-policy':`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`});
  return res.end(html);
 }
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
 if(req.headers.origin!==base) return json(res,403,{error:'Invalid origin'});
 if(req.headers['x-gateway-csrf']!==p.csrf)return json(res,403,{error:'Invalid request token'});
 let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>20000)return json(res,413,{error:'Request too large'});}
 try{
  const body=JSON.parse(raw);const wrapped=Buffer.from(body.wrapped,'base64');
  const iv=Buffer.from(body.iv,'base64');const ct=Buffer.from(body.ciphertext,'base64');
  if(iv.length!==12||wrapped.length!==384||ct.length<16||ct.length>12000)throw Error('Malformed encrypted input');
  const aes=crypto.privateDecrypt({key:p.privateKey,oaepHash:'sha256',padding:crypto.constants.RSA_PKCS1_OAEP_PADDING},wrapped);
  if(aes.length!==32)throw Error('Invalid key length');
  const decipher=crypto.createDecipheriv('aes-256-gcm',aes,iv);decipher.setAuthTag(ct.subarray(ct.length-16));
  const plain=Buffer.concat([decipher.update(ct.subarray(0,-16)),decipher.final()]);
  const value=JSON.parse(plain.toString('utf8')).token;
  plain.fill(0);aes.fill(0);
  if(typeof value!=='string'||value.length<8||value.length>8192||/[\r\n\x00]/.test(value))throw Error('Invalid credential');
  if(session.closed)throw Error('Session closed');
  const key=({depot:'DEPOT_TOKEN',npm:'NPM_TOKEN',fly:'FLY_API_TOKEN',ionos:'IONOS_API_KEY'})[p.provider];
  const existing=session.secrets.get(key);if(existing)existing.fill(0);
  session.secrets.set(key,Buffer.from(value,'utf8'));
  p.used=true;session.pending.delete(code);
  return json(res,200,{saved:true,persisted:false,scope:'current MCP session only'});
 }catch{return json(res,400,{error:'Invalid or expired encrypted answer'});}
}
