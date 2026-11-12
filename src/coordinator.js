// A single authoritative Fly Machine holds all MCP sessions and credentials.
// Every other Machine is a stateless ingress using Fly Proxy's fly-replay.
const machinePattern=/^[0-9a-f]{12,32}$/i;
const appPattern=/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
export function coordinatorConfig(env=process.env){
  if(!env.FLY_APP_NAME)return {fly:false,local:true,ready:true};
  const machine=env.FLY_MACHINE_ID,authority=env.MCP_COORDINATOR_MACHINE_ID,app=env.FLY_APP_NAME;
  if(!machinePattern.test(machine||'')||!machinePattern.test(authority||'')||!appPattern.test(app||''))
    return {fly:true,ready:false,reason:'Fly coordinator configuration missing or invalid'};
  return {fly:true,ready:true,local:machine===authority,authority,app};
}
export function coordinatorRoute(req,res,pathname,env=process.env){
  if(pathname!=='/mcp'&&!pathname.startsWith('/credential/')&&!pathname.startsWith('/approve/'))return false;
  const c=coordinatorConfig(env);
  if(!c.ready){res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store','Retry-After':'10'});res.end(JSON.stringify({error:'MCP coordinator unavailable; configure MCP_COORDINATOR_MACHINE_ID'}));return true;}
  if(!c.fly||c.local)return false;
  res.writeHead(307,{'fly-replay':`app=${c.app};instance=${c.authority};timeout=3s`,'Cache-Control':'no-store'});
  res.end();return true;
}
