#!/usr/bin/env node
/* MCP stdio server; authenticated loopback HTTP is an internal HTML bridge, NOT an MCP HTTP endpoint. */
'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const C=require('./tool-contract.cjs');
const port=Number(process.env.SCORE_DESK_MCP_PORT||13125);
const dir=process.env.SCORE_DESK_MCP_STATE_DIR||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'.local','share'),'LocalScoreDeskMCP');
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('SCORE_DESK_MCP_PORT must be 1024–65535');
const infoPath=path.join(dir,'connection.json');let token;
try{const old=JSON.parse(fs.readFileSync(infoPath,'utf8'));if(/^[a-f0-9]{64}$/.test(old.token))token=old.token;}catch{}
token||=crypto.randomBytes(32).toString('hex');
const info={kind:'local-score-desk-mcp-connection',version:C.version,url:'http://127.0.0.1:'+port,token};
const jobs=new Map();let connected=null,waiter=null,initialized=false,ready=false,exiting=false;
const supported=['2025-11-25','2025-06-18','2025-03-26','2024-11-05'];
function emit(obj){process.stdout.write(JSON.stringify(obj)+'\n');}
function result(id,value){emit({jsonrpc:'2.0',id,result:value});}
function error(id,code,message){emit({jsonrpc:'2.0',id,error:{code,message}});}
function toolResult(data,isError=false){return {content:[{type:'text',text:JSON.stringify(data)}],...(isError?{}:{structuredContent:data}),isError};}
function live(){return connected&&Date.now()-connected.seen<35000;}
function settleJob(job,payload){if(!jobs.has(job.id))return;clearTimeout(job.timer);jobs.delete(job.id);job.resolve(payload);}
function clearJobs(message){for(const job of jobs.values())settleJob(job,toolResult({error:message},true));}
function dispatch(){
 if(!waiter)return;const job=[...jobs.values()].find(j=>!j.sent);if(!job)return;
 job.sent=true;const w=waiter;waiter=null;clearTimeout(w.timer);w.send({id:job.id,name:job.name,arguments:job.args});
}
function queue(name,args,requestId){
 if(!live())return Promise.resolve(toolResult({error:'HTML 未连接。请打开本地记录工作台 → AI / MCP → 连接 AI 机器人 / MCP，选择本机 connection.json 并授权。'},true));
 if(jobs.size>=10)return Promise.resolve(toolResult({error:'工具队列已满，请稍后重试'},true));
 return new Promise(resolve=>{const id=crypto.randomUUID();const job={id,name,args,requestId,resolve,sent:false,timer:setTimeout(()=>settleJob(job,toolResult({error:'HTML 响应超时；后台页面可能被浏览器挂起。请回到 HTML 后检查草稿状态，勿盲目重试写入。'},true)),30000)};jobs.set(id,job);dispatch();});
}
async function rpc(m){
 if(!m||m.jsonrpc!=='2.0'||typeof m.method!=='string'||(Object.hasOwn(m,'id')&&typeof m.id!=='number'&&typeof m.id!=='string')){error(m?.id??null,-32600,'Invalid Request');return;}
 const notify=!Object.hasOwn(m,'id');
 if(notify){
  if(m.method==='notifications/initialized'){if(initialized)ready=true;}
  if(m.method==='notifications/cancelled')for(const j of jobs.values())if(j.requestId===m.params?.requestId)settleJob(j,toolResult({error:'请求已取消；已生成草稿不会自动应用。'},true));
  return;
 }
 const id=m.id;
 if(m.method==='initialize'){
  if(initialized){error(id,-32600,'Already initialized');return;}
  if(!m.params||typeof m.params.protocolVersion!=='string'||!m.params.clientInfo||!m.params.capabilities){error(id,-32602,'Invalid initialize parameters');return;}
  initialized=true;result(id,{protocolVersion:supported.includes(m.params.protocolVersion)?m.params.protocolVersion:supported[0],capabilities:{tools:{listChanged:false}},serverInfo:{name:'local-score-desk',version:C.version},instructions:C.instructions+'\n使用前需用户在 HTML 中授权连接。工具包不直接读浏览器数据库，也不需要模型 API Key。'});return;
 }
 if(m.method==='ping'){result(id,{});return;}
 if(!ready){error(id,-32002,'Initialize and send notifications/initialized first');return;}
 if(m.method==='tools/list'){
  if(m.params?.cursor){error(id,-32602,'Invalid cursor');return;}
  result(id,{tools:C.tools});return;
 }
 if(m.method==='tools/call'){
  const name=m.params?.name,args=m.params?.arguments??{};
  if(typeof name!=='string'||!C.tools.some(t=>t.name===name)){error(id,-32602,'Unknown tool');return;}
  try{C.validateTool(name,args);}catch(e){result(id,toolResult({error:e.message},true));return;}
  result(id,await queue(name,args,id));return;
 }
 error(id,-32601,'Method not found');
}
function originAllowed(origin){if(!origin||origin==='null')return true;try{const u=new URL(origin);return ['http:','https:'].includes(u.protocol)&&['127.0.0.1','localhost'].includes(u.hostname)&&u.origin===origin;}catch{return false;}}
function auth(req){const got=Buffer.from(req.headers.authorization||''),expected=Buffer.from('Bearer '+token);return got.length===expected.length&&crypto.timingSafeEqual(got,expected);}
async function body(req){let n=0,parts=[];for await(const p of req){n+=p.length;if(n>16*1024*1024)throw Error('Body too large');parts.push(p);}return JSON.parse(Buffer.concat(parts).toString('utf8'));}
const server=http.createServer(async(req,res)=>{
 const send=(data,status=200)=>{if(res.writableEnded)return;res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));};
 if(req.headers.host!=='127.0.0.1:'+port){send({error:'Invalid host'},403);return;}
 if(!originAllowed(req.headers.origin)){send({error:'Origin not allowed'},403);return;}
 if(req.headers.origin){res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin');}
 if(req.method==='OPTIONS'){
  res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type, X-Score-Client, X-Score-Session');res.setHeader('Access-Control-Max-Age','600');send({});return;
 }
 if(req.method!=='POST'){send({error:'Method not allowed'},405);return;}
 if(!auth(req)){send({error:'Unauthorized'},401);return;}
 const client=req.headers['x-score-client'];if(typeof client!=='string'||client.length<8||client.length>120){send({error:'Invalid client'},400);return;}
 if(!['/connect','/poll','/result','/disconnect'].includes(req.url)){send({error:'Not found'},404);return;}
 try{
  const data=await body(req);
  if(req.url==='/connect'){
   if(live()&&connected.id!==client){send({error:'Another HTML page is connected'},409);return;}
   if(typeof data.workspace_id!=='string'||data.workspace_id.length>120||typeof data.title!=='string'||data.title.length>120){send({error:'Invalid workspace'},400);return;}
   clearJobs('连接会话已更新，旧请求作废，请重新核对草稿状态');
   if(waiter){clearTimeout(waiter.timer);waiter.send({});waiter=null;}
   connected={id:client,workspace:data.workspace_id,epoch:crypto.randomUUID(),seen:Date.now()};send({connected:true,version:C.version,session:connected.epoch});return;
  }
  if(!connected||connected.id!==client||req.headers['x-score-session']!==connected.epoch){send({error:'Not connected or stale session'},409);return;}
  connected.seen=Date.now();
  if(req.url==='/disconnect'){
   connected=null;clearJobs('用户已断开 HTML 连接');if(waiter){clearTimeout(waiter.timer);waiter.send({});waiter=null;}send({disconnected:true});return;
  }
  if(req.url==='/poll'){
   if(waiter){send({error:'Already polling'},409);return;}
   const w={send,timer:null};waiter=w;w.timer=setTimeout(()=>{if(waiter===w){waiter=null;send({});}},20000);
   res.on('close',()=>{if(waiter===w){clearTimeout(w.timer);waiter=null;}});dispatch();return;
  }
  if(req.url==='/result'){
   const job=jobs.get(data.id);if(!job||!job.sent){send({error:'Unknown or expired job'},404);return;}
   if(Object.hasOwn(data,'error'))settleJob(job,toolResult({error:String(data.error).slice(0,2000)},true));
   else if(data.data&&typeof data.data==='object'&&!Array.isArray(data.data))settleJob(job,toolResult(data.data));else{send({error:'Invalid result'},400);return;}
   send({received:true});return;
  }
 }catch{send({error:'Malformed or oversized request'},400);}
});
server.requestTimeout=35000;server.headersTimeout=10000;
server.on('error',err=>{process.stderr.write('Local Score MCP: '+(err.code==='EADDRINUSE'?'端口已占用；可能已有同一工具服务。只启用一个 local-score-desk，或用 SCORE_DESK_MCP_PORT 指定其他端口。':err.code||'HTTP error')+'\n');process.exit(1);});
server.listen(port,'127.0.0.1',()=>{
 try{fs.mkdirSync(dir,{recursive:true,mode:0o700});fs.writeFileSync(infoPath,JSON.stringify(info,null,2),{mode:0o600});process.stderr.write('Local Score MCP '+C.version+' ready. 在 HTML 中选择连接文件：'+infoPath+'\n');}
 catch{process.stderr.write('无法创建连接文件，请检查 SCORE_DESK_MCP_STATE_DIR 权限。\n');process.exit(1);}
});
let input='';process.stdin.setEncoding('utf8');
process.stdin.on('data',chunk=>{
 input+=chunk;
 if(Buffer.byteLength(input)>16*1024*1024){error(null,-32700,'Input limit exceeded');input='';return;}
 let index;while((index=input.indexOf('\n'))!==-1){const line=input.slice(0,index).trim();input=input.slice(index+1);if(!line)continue;let m;try{m=JSON.parse(line);}catch{error(null,-32700,'Parse error');continue;}void rpc(m).catch(()=>error(m?.id??null,-32603,'Internal error'));}
});
function shutdown(){if(exiting)return;exiting=true;clearJobs('MCP 服务已关闭');if(waiter){clearTimeout(waiter.timer);waiter.send({});waiter=null;}server.closeAllConnections();server.close();process.exit(0);}
process.stdin.on('end',shutdown);process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
