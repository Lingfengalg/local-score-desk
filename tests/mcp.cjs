'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),{spawn}=require('node:child_process');
async function main(){
 const port=await new Promise((resolve,reject)=>{const s=net.createServer();s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const state=fs.mkdtempSync(path.join(os.tmpdir(),'local-score-mcp-test-'));
 const child=spawn(process.execPath,[path.join(__dirname,'../mcp/mcp-server.cjs')],{windowsHide:true,env:{...process.env,SCORE_DESK_MCP_PORT:String(port),SCORE_DESK_MCP_STATE_DIR:state},stdio:['pipe','pipe','pipe']});
 let buffer='',id=0,readyResolve;const pending=new Map(),ready=new Promise(r=>readyResolve=r);
 child.stderr.on('data',b=>{if(b.toString().includes('ready.'))readyResolve();});
 child.stdout.on('data',b=>{buffer+=b;let n;while((n=buffer.indexOf('\n'))!==-1){const m=JSON.parse(buffer.slice(0,n));buffer=buffer.slice(n+1);const cb=pending.get(m.id);if(cb){pending.delete(m.id);cb(m);}}});
 const rpc=(method,params={})=>new Promise((resolve,reject)=>{const i=++id,t=setTimeout(()=>reject(Error('RPC timeout')),8000);pending.set(i,m=>{clearTimeout(t);resolve(m);});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id:i,method,params})+'\n');});
 const timeout=setTimeout(()=>{child.kill();process.exitCode=1;},15000);
 try{
  await ready;
  const init=await rpc('initialize',{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'test',version:'1'}});assert.equal(init.result.serverInfo.name,'local-score-desk');console.log('PASS MCP stdio initialize');
  child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');
  const list=await rpc('tools/list');assert.equal(list.result.tools.length,10);assert.ok(!list.result.tools.some(t=>/commit|apply|eval|execute/.test(t.name)));console.log('PASS 10 bounded tools; no commit/execute');
  const response=await fetch('http://127.0.0.1:'+port+'/hello',{method:'POST',body:'{}'});assert.equal(response.status,401);console.log('PASS bridge rejects unauthenticated requests');
  const call=await rpc('tools/call',{name:'workspace_summary',arguments:{}});assert.equal(call.result.isError,true);console.log('PASS no data access without HTML authorization');
 }finally{clearTimeout(timeout);child.stdin.end();await new Promise(resolve=>{if(child.exitCode!==null)return resolve();child.once('exit',resolve);setTimeout(()=>{child.kill();resolve();},2000).unref();});}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
