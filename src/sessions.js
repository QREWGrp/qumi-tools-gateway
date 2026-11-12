import crypto from 'node:crypto';
import net from 'node:net';

const now = () => Date.now();
const number = (name, fallback, low, high) => {
  const v = process.env[name] ? Number(process.env[name]) : fallback;
  if (!Number.isInteger(v) || v < low || v > high) throw Error(`Invalid ${name}`);
  return v;
};
export const limits = Object.freeze({
  perIp: number('MAX_SESSIONS_PER_IP', 5, 1, 5),
  global: number('MAX_GLOBAL_SESSIONS', 5, 1, 5),
  perMinute: number('MAX_REQUESTS_PER_MINUTE', 60, 5, 600),
  perSessionMinute: number('MAX_SESSION_REQUESTS_PER_MINUTE', 30, 5, 120),
  idleMs: number('SESSION_IDLE_MS', 10 * 60_000, 30_000, 60 * 60_000),
  absoluteMs: number('SESSION_MAX_AGE_MS', 30 * 60_000, 60_000, 4 * 60 * 60_000),
  maxInFlight: 2,
});
export const sessions = new Map();
const ipBuckets = new Map();
const windowMs = 60_000;

export function clientIp(req, trustFly = false) {
  if (trustFly) {
    // Only enable when this service is reachable exclusively via the Fly HTTP proxy;
    // Fly overwrites Fly-Client-IP. NEVER trust X-Forwarded-For from the public Internet.
    const h = req.headers['fly-client-ip'];
    if (typeof h !== 'string' || net.isIP(h) === 0) return null;
    return h;
  }
  const raw = req.socket.remoteAddress || '';
  const ip = raw.startsWith('::ffff:') ? raw.slice(7) : raw;
  return net.isIP(ip) ? ip : null;
}
function bucket(map, key) {
  let b = map.get(key);
  if (!b || now() - b.since >= windowMs) { b = { since: now(), used: 0 }; map.set(key, b); }
  return b;
}
export function rateLimit(ip) {
  const b = bucket(ipBuckets, ip); b.used++;
  if (b.used > limits.perMinute) return { ok:false, retryAfter:Math.max(1,Math.ceil((windowMs - (now()-b.since))/1000)) };
  return {ok:true};
}
export function sessionRateLimit(session){
 const sb=bucket(session.rateBuckets,'session'); sb.used++;
 if(sb.used>limits.perSessionMinute)return {ok:false,retryAfter:Math.max(1,Math.ceil((windowMs-(now()-sb.since))/1000))};
 return {ok:true};
}
export function activeCountForIp(ip) {
  let n=0;for(const s of sessions.values())if(s.ip===ip)n++;
  return n;
}
export function newSession(ip) {
  prune();
  if(activeCountForIp(ip)>=limits.perIp)return {error:'per_ip_limit'};
  if(sessions.size>=limits.global)return {error:'global_limit'};
  const s={id:crypto.randomBytes(32).toString('base64url'),ip,createdAt:now(),lastAt:now(),
    secrets:new Map(),pending:new Map(),rateBuckets:new Map(),inFlight:0,abort:new Set(),closed:false};
  sessions.set(s.id,s);return {session:s};
}
export function lookupSession(id, ip) {
  if(typeof id!=='string'||id.length>96)return null;
  const s=sessions.get(id);
  if(!s||s.ip!==ip||s.closed)return null;
  if(now()-s.lastAt>=limits.idleMs||now()-s.createdAt>=limits.absoluteMs){closeSession(s);return null;}
  s.lastAt=now();return s;
}
export function closeSession(s) {
  if(!s || s.closed) return;
  s.closed=true;
  for(const controller of s.abort)controller.abort();
  s.abort.clear();
  for(const buf of s.secrets.values())if(Buffer.isBuffer(buf))buf.fill(0);
  s.secrets.clear(); s.pending.clear(); s.rateBuckets.clear();
  sessions.delete(s.id);
}
export function prune() {
  const time=now();
  for(const s of sessions.values())if(time-s.lastAt>=limits.idleMs||time-s.createdAt>=limits.absoluteMs)closeSession(s);
  for(const [ip,b] of ipBuckets)if(time-b.since>windowMs*2)ipBuckets.delete(ip);
  if(ipBuckets.size>10_000){const stale=[...ipBuckets.keys()].slice(0,ipBuckets.size-10_000);for(const ip of stale)ipBuckets.delete(ip);}
}
export function sessionStatus(s) {return {
  active:true,sessionExpiresInSeconds:Math.max(0,Math.ceil((limits.absoluteMs-(now()-s.createdAt))/1000)),
  credentials:{depot:s.secrets.has('DEPOT_TOKEN'),npm:s.secrets.has('NPM_TOKEN'),fly:s.secrets.has('FLY_API_TOKEN'),ionos:s.secrets.has('IONOS_API_KEY')},
  storage:'memory only',activeSessionsGlobal:sessions.size,maxSessionsGlobal:limits.global,maxSessionsPerIP:limits.perIp,requestsPerMinutePerIP:limits.perMinute
};}
