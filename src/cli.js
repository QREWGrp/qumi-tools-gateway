import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {sessionStatus} from './sessions.js';
import {flyOps,ionosOps} from './providers.js';

let runningCommands=0;
const MAX_RUNNING_COMMANDS=8;
const MAX_OUTPUT=32*1024;
const TIMEOUT_MS=10_000;
const clean = s => typeof s === 'string' && /^[A-Za-z0-9@._/+-]{1,128}$/.test(s);
function trustedExecutable(provider){
  if(provider==='npm'){
    const nodeDir=path.dirname(process.execPath);
    const npmJs=process.env.NPM_CLI_JS || path.resolve(nodeDir,'../lib/node_modules/npm/bin/npm-cli.js');
    if(fs.existsSync(npmJs))return {file:process.execPath,prefix:[npmJs]};
    return {file:'npm',prefix:[]};
  }
  if(provider==='depot')return {file:process.env.DEPOT_BIN||'depot',prefix:[]};
  throw Error('Unknown provider');
}
function baseEnv(root){
  const env={PATH:'/usr/local/bin:/usr/bin:/bin',HOME:root,TMPDIR:root,TMP:root,LANG:'C.UTF-8',CI:'true',NO_COLOR:'1',
    npm_config_update_notifier:'false',npm_config_fund:'false',npm_config_audit:'false',npm_config_ignore_scripts:'true',
    npm_config_registry:'https://registry.npmjs.org/',NPM_CONFIG_USERCONFIG:path.join(root,'.npmrc')};
  if(process.platform==='win32'){
    for(const n of ['SystemRoot','WINDIR','PATHEXT','COMSPEC'])if(process.env[n])env[n]=process.env[n];
    env.PATH=process.env.SystemRoot+'\\System32';
  }
  return env;
}
function redact(message, secrets){let s=String(message||'');for(const buf of secrets.values()){
  const token=buf.toString('utf8');if(token.length>=6)s=s.split(token).join('[REDACTED]');
}return s;}
async function execute(session,provider,argv,{needsAuth=false}={}){
  if(session.closed)throw Error('Session is closed');
  if(session.inFlight>=2)throw Error('Too many operations running in this session');
  if(runningCommands>=MAX_RUNNING_COMMANDS)throw Error('Global command concurrency limit reached');
  runningCommands++;session.inFlight++;
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mcp-gateway-'));
  const ctrl=new AbortController();session.abort.add(ctrl);
  try {
    const env=baseEnv(dir);
    if(provider==='depot'){
      const token=session.secrets.get('DEPOT_TOKEN');
      if(needsAuth&&!token)throw Error('DEPOT_TOKEN is not provisioned in this session');
      if(token)env.DEPOT_TOKEN=token.toString('utf8');
    }
    if(provider==='npm'){
      const token=session.secrets.get('NPM_TOKEN');
      // npm CLI can only read registry credentials via a temporary private .npmrc.
      // This file is destroyed immediately after execution, not saved across sessions.
      if(needsAuth&&!token)throw Error('NPM_TOKEN is not provisioned in this session');
      const data=token?'//registry.npmjs.org/:_authToken='+token.toString('utf8')+'\n':'';
      fs.writeFileSync(path.join(dir,'.npmrc'),data,{mode:0o600,flag:'wx'});
      env.npm_config_cache=path.join(dir,'cache');
    }
    const {file:binary,prefix}=trustedExecutable(provider);
    const exit=await new Promise((resolve,reject)=>{
      let output='',total=0,timedOut=false;
      const child=spawn(binary,[...prefix,...argv],{cwd:dir,env,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe'],signal:ctrl.signal});
      const timer=setTimeout(()=>{timedOut=true;ctrl.abort();},TIMEOUT_MS);
      const collect=chunk=>{total+=chunk.length;if(total>MAX_OUTPUT){ctrl.abort();return;}output+=chunk.toString('utf8')};
      child.stdout.on('data',collect);child.stderr.on('data',collect);
      child.once('error',e=>{clearTimeout(timer);reject(new Error(e.code==='ENOENT'?`${provider} CLI not installed on gateway`:'Command could not be executed'));});
      child.once('close',code=>{clearTimeout(timer);resolve({code:code??1,output:output.slice(0,MAX_OUTPUT),timedOut,outputTruncated:total>MAX_OUTPUT});});
    });
    return {provider,operation:argv[0]||'--help',exitCode:exit.code,output:redact(exit.output,session.secrets),
      timedOut:exit.timedOut,outputTruncated:exit.outputTruncated,readOnly:true};
  }finally{
    ctrl.abort();session.abort.delete(ctrl);session.inFlight--;runningCommands--;
    fs.rmSync(dir,{recursive:true,force:true});
  }
}
export async function cliWrite(session,command,args){
  if(!Array.isArray(args))throw Error('Invalid CLI args');
  if(command==='npm'){
    if(args[0]!=='dist-tag'||!['add','rm'].includes(args[1]))throw Error('NPM write not allowlisted');
    const output=await execute(session,'npm',args,{needsAuth:true});
    return {...output,readOnly:false};
  }
  if(command==='depot'){
    if(args[0]!=='ci'||args[1]!=='cancel')throw Error('Depot write not allowlisted');
    const output=await execute(session,'depot',args,{needsAuth:true});
    return {...output,readOnly:false};
  }
  throw Error('Unsupported CLI write command');
}
export async function cliCatalog(session){
  return {sessions:sessionStatus(session),installedCommands:'discover with cli_help',
    supported:['npm view','npm search','npm ping','npm whoami','Depot help','Depot list builds','Depot list projects',...flyOps,...ionosOps,'write_begin','write_execute','fly_machine_start/stop/restart','ionos_dns_record_create/update/delete','npm_dist_tag_add/remove','depot_ci_cancel'],
    forbidden:'No arbitrary shell, install, run-script, publish, deploy or user-selected registry/URL. Writes require a bounded operation and one-time browser confirmation.',
    note:'Depot read paths depend on installed Depot CLI version; unsupported CLI syntax is reported safely.'};
}
export async function cliHelp(session,{provider,command=[]}={}){
  if(!['npm','depot'].includes(provider))throw Error('provider must be npm or depot');
  if(!Array.isArray(command)||command.length>4||command.some(c=>!/^([a-z][a-z0-9-]{0,25})$/.test(c)))throw Error('Invalid help command');
  // --help is the only forwarded flag.
  return await execute(session,provider,[...command,'--help']);
}
export async function cliRead(session,args={}){
  const {operation}=args;
  if(operation==='npm_ping')return execute(session,'npm',['ping','--registry=https://registry.npmjs.org/']);
  if(operation==='npm_whoami')return execute(session,'npm',['whoami','--registry=https://registry.npmjs.org/'],{needsAuth:true});
  if(operation==='npm_view'){
    if(!clean(args.package)||args.package.includes('..')||args.package.startsWith('-')||args.package.startsWith('/')||args.package.includes('//'))throw Error('Invalid npm package');
    const field=args.field||'version';
    if(!['version','description','dist-tags','time','name'].includes(field))throw Error('Disallowed field');
    return execute(session,'npm',['view',args.package,field,'--json','--registry=https://registry.npmjs.org/']);
  }
  if(operation==='npm_search'){
    if(typeof args.query!=='string'||! /^[a-zA-Z0-9_.-]{1,60}$/.test(args.query))throw Error('Invalid search query');
    return execute(session,'npm',['search',args.query,'--json','--registry=https://registry.npmjs.org/']);
  }
  if(operation==='depot_projects')return execute(session,'depot',['list','projects'],{needsAuth:true});
  if(operation==='depot_builds'){
    if(typeof args.project_id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(args.project_id))throw Error('Project ID required');
    return execute(session,'depot',['list','builds','--project',args.project_id],{needsAuth:true});
  }
  throw Error('Operation is not supported by the read-only public gateway');
}
