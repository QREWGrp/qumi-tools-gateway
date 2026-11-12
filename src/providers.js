// Fixed-host and read-only Fly.io/IONOS provider adapters.
const MAX_BYTES=64*1024;
const APP=/^[a-z0-9][a-z0-9-]{1,62}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clean=(value,re,name)=>{if(typeof value!=='string'||!re.test(value))throw Error(`Invalid ${name}`);return value;};
const credential=(s,key)=>{const b=s.secrets.get(key);if(!b)throw Error(`${key} is not configured for this session`);return b.toString('utf8');};
async function request(url,{headers={},method='GET',body,fetcher=fetch}={}){
  const response=await fetcher(url,{method,headers:{Accept:'application/json',...headers},body,redirect:'error',signal:AbortSignal.timeout(9000)});
  if(!response.ok)throw Error(`Provider returned HTTP ${response.status}`);
  const len=Number(response.headers?.get?.('content-length'));
  if(len>MAX_BYTES)throw Error('Provider response exceeds size limit');
  const raw=await response.text();if(Buffer.byteLength(raw)>MAX_BYTES)throw Error('Provider response exceeds size limit');
  const result=JSON.parse(raw);
  if(result?.errors?.length)throw Error('Provider rejected the read-only request');
  return result;
}
const flyRoot='https://api.machines.dev/v1/apps/';
const ionosRoot='https://api.hosting.ionos.com/';
export const flyOps=['fly_status','fly_machine_list','fly_checks_list','fly_releases','fly_logs'];
export const ionosOps=['ionos_dns_zones','ionos_dns_zone','ionos_domains','ionos_ssl_certificates'];
export async function providerRead(session,args={},options={}){
  if(session.closed)throw Error('MCP session is closed');
  const op=args.operation,fetcher=options.fetcher??fetch;
  if(flyOps.includes(op)){
    const app=clean(args.app,APP,'Fly app'),token=credential(session,'FLY_API_TOKEN'),headers={Authorization:`Bearer ${token}`};
    const root=flyRoot+encodeURIComponent(app);
    if(op==='fly_status'){const a=await request(root,{headers,fetcher});return {name:a.name,status:a.status,machine_count:a.machine_count,organization:a.organization?.name??null};}
    if(op==='fly_machine_list'){
      const a=await request(root+'/machines',{headers,fetcher});
      if(!Array.isArray(a))throw Error('Unexpected Fly machines response');
      return a.slice(0,25).map(m=>({id:m.id,name:m.name,state:m.state,region:m.region}));
    }
    if(op==='fly_checks_list'){
      const a=await request(root+'/machines',{headers,fetcher});
      if(!Array.isArray(a))throw Error('Unexpected Fly machines response');
      return a.slice(0,25).map(m=>({id:m.id,state:m.state,region:m.region,checks:m.checks??[],health:m.health??null}));
    }
    if(op==='fly_releases'){
      const query='query($appName:String!,$limit:Int!){app(name:$appName){releases:releasesUnprocessed(first:$limit){nodes{id version description reason status imageRef stable createdAt}}}}';
      const a=await request('https://api.fly.io/graphql',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({query,variables:{appName:app,limit:10}}),fetcher});
      return a?.data?.app?.releases?.nodes??[];
    }
    if(op==='fly_logs'){
      // Unversioned Fly recent-log endpoint; no indefinite streaming or user cursor.
      const a=await request(`https://api.fly.io/api/v1/apps/${encodeURIComponent(app)}/logs`,{headers,fetcher});
      const rows=Array.isArray(a?.data)?a.data.slice(-20):[];
      const scrub=s=>String(s).split(token).join('[REDACTED]').slice(0,1200);
      return {entries:rows.map(r=>({timestamp:r.attributes?.timestamp??null,region:r.attributes?.region??null,message:scrub(r.attributes?.message??'')})),source:'Fly unversioned recent-log HTTP API',caveat:'Recent log coverage and response format may change'};
    }
  }
  if(ionosOps.includes(op)){
    const key=credential(session,'IONOS_API_KEY'),headers={'X-API-Key':key};
    if(op==='ionos_dns_zones')return request(ionosRoot+'dns/v1/zones',{headers,fetcher});
    if(op==='ionos_dns_zone')return request(ionosRoot+'dns/v1/zones/'+clean(args.zone_id,UUID,'zone_id'),{headers,fetcher});
    if(op==='ionos_domains'){
      headers['X-Tenant-Id']=clean(args.tenant_id,/^[a-zA-Z0-9_-]{1,80}$/,'tenant_id');
      return request(ionosRoot+'domains/v1/domainitems',{headers,fetcher});
    }
    if(op==='ionos_ssl_certificates')return request(ionosRoot+'ssl/v1/certificates',{headers,fetcher});
  }
  throw Error('Unsupported read-only provider operation');
}
