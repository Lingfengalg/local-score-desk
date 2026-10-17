/* HTML remains the data owner. MCP and optional model calls use the same allowlist. */
(function(){
'use strict';
const C=ScoreToolContract, proposals=new Map(), logs=[];
let connection=null, bridgeAbort=null, activeTab='review', shown='', draftPage=1, busy=false, modelAbort=null, mcpClientId='';
let modelKey='', modelConfig={url:'https://api.deepseek.com',model:'deepseek-flash'};
const box=document.createElement('dialog');box.id='automationDialog';box.setAttribute('aria-labelledby','automationTitle');
const topButton=document.createElement('button');topButton.id='automationButton';topButton.textContent='AI / MCP';
document.querySelector('.top-actions').prepend(topButton);
const badge=()=>{const n=[...proposals.values()].filter(p=>p.status==='pending'&&p.workspace===project.workspaceId).length;topButton.textContent='AI / MCP'+(n?' · '+n+' 份待确认':'');};
const warn=m=>{const el=box.querySelector('#automationError');if(el)el.textContent=m;else toast(m);};
const pageSlice=(a,args={})=>{const size=args.page_size||30,p=args.page||1;return {total:a.length,page:p,page_size:size,items:a.slice((p-1)*size,p*size)};};
const byId=id=>{const s=project.students.find(s=>s.id===id);if(!s)throw Error('学号不存在：'+id+'。请重新查询；不能按相似姓名猜测。');return s;};
const obs=id=>{const o=ruleMap.get(id);if(!o)throw Error('观测点不存在：'+id);return o;};
const summaryScore=s=>{const r=E.calculate(s,project.config,RULES);return {total:r.total,basic:r.basic,professional:r.professional,development:r.development,status:r.status,dimensions:r.dimensions};};
const identity=s=>({id:s.id,name:s.name,group:s.group,revision:s.revision});
function log(name,ok){logs.unshift({time:stamp(),name,ok});logs.splice(100);if(box.open&&activeTab==='connect')drawLog();}
function ensureReady(){if(!ScoreApp.ready())throw Error('工作区尚未打开');}
function ensureVersion(id,serial){ensureReady();if(id!==project.workspaceId||serial!==project.serial)throw Error('工作区已变化，请重新读取工作区版本、核对并生成新草稿；旧草稿不能覆盖新数据。');}
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function validateField(o,index,v){
 const f=o.fields[index];if(!f)throw Error(o.id+' 字段索引不存在');
 if(['award','range','discipline'].includes(o.type))throw Error('奖项请使用 award_add / award_update');
 if(f.kind==='bool'){if(!['是','否'].includes(v))throw Error(f.label+' 只能选是或否');}
 else if(f.kind==='option'){if(!o.options.some(p=>String(p[0])===String(v)))throw Error(f.label+' 不是允许的认定级别');}
 else if(f.kind==='tenure'){if(!['不足半年','半年','超过半年'].includes(v))throw Error('任期无效');}
 else if(typeof v!=='number'||!Number.isFinite(v)||v<(f.lo??0)||v>(f.hi??999999)||(f.kind==='count'&&!Number.isInteger(v)))throw Error(o.name+' / '+f.label+' 类型或范围无效');
}
function materialize(operations){
 const candidate=clone(project),lookup=new Map(candidate.students.map(s=>[s.id,s])),rows=[],changed=new Map(),seen=new Set(),removals=[];
 const changing=new Set(operations.map(x=>x.student_id));
 for(const op of operations){
  if(op.action==='student_remove'&&operations.filter(x=>x.student_id===op.student_id).length>1)throw Error('删除学生不能与同一学生的其他操作混用');
  if(op.action==='student_add'){
   if(lookup.has(op.student_id))throw Error('新增学号已经存在：'+op.student_id);
   const s={id:op.student_id,name:op.name,group:op.group,professional:null,values:{},awards:{},revision:0,qualified:false,exception:false,note:''};
   lookup.set(s.id,s);candidate.students.push(s);
  }
 }
 if(candidate.students.length>500)throw Error('班级人数不能超过 500');
 const mark=(id,key)=>{const k=id+'\u0000'+key;if(seen.has(k))throw Error('同一草稿重复修改同一字段 / 奖项行：'+id+' / '+key);seen.add(k);};
 for(const op of operations){
  const s=lookup.get(op.student_id);if(!s)throw Error('学号不存在：'+op.student_id);
  const original=project.students.find(x=>x.id===s.id);let before,after,label;
  if(op.action==='student_add'){mark(s.id,'identity');before='未在名单中';after=s.name+' / '+s.group;label='新增学生';}
  else if(op.action==='student_update'){
   if(!['name','group','note'].some(k=>Object.hasOwn(op,k)))throw Error('学生修改未提供任何字段');
   before={name:s.name,group:s.group,note:s.note};for(const k of ['name','group','note'])if(Object.hasOwn(op,k)){mark(s.id,k);s[k]=op[k];}after={name:s.name,group:s.group,note:s.note};label='修改身份 / 备注';
  }else if(op.action==='student_remove'){mark(s.id,'remove');before=identity(s);after='删除学生及其全部记录';label='删除学生';candidate.students=candidate.students.filter(x=>x.id!==s.id);}
  else if(op.action==='professional_set'){mark(s.id,'professional');before=s.professional;after=op.value;s.professional=op.value;label='专业素质成绩';}
  else if(op.action==='values_set'){
   const o=obs(op.observation_id);const fields=s.values[o.id]??=[];before=[];after=[];
   for(const f of op.fields){
    mark(s.id,o.id+'.'+f.index);validateField(o,f.index,f.value);const old=fields[f.index]??'';let value=f.value;
    if(op.mode==='add'){
     if(!['qty','activity','hours'].includes(o.type)||typeof value!=='number')throw Error('仅次数 / 参与活动 / 小时允许累加；成绩及认定项须替换');
     value=(old===''?0:old)+value;validateField(o,f.index,value);
    }
    before.push({field:o.fields[f.index].label,value:old});after.push({field:o.fields[f.index].label,value});
    while(fields.length<=f.index)fields.push('');fields[f.index]=value;
   }
   label=o.id+' '+o.name+'（'+(op.mode==='add'?'累加':'替换')+'）';
   if(['activity','qty','bool','hours'].includes(o.type)){
    s.activityLog??=[];s.activityLog.unshift({id:o.id,event:op.source.slice(0,200),mode:op.mode,values:clone(fields),time:stamp(),actor:'AI 草稿 / 人工确认'});s.activityLog.splice(100);
   }
  }else{
   const o=obs(op.observation_id);if(!['award','range','discipline'].includes(o.type))throw Error('该项目不是奖项 / 认定记录');
   const list=s.awards[o.id]??=[];let a;
   if(op.action==='award_add'){
    a={option:op.option,count:op.count,team:op.team??'',ratio:op.ratio??'',approval:op.approval??'',event:op.event,note:op.note||'',status:'待审核'};
    if(o.team&&!Object.hasOwn(op,'team'))throw Error(o.name+' 需要明确团队人数，个人请明确填 1');
    before='无此记录';list.push(a);
   }else{
    mark(s.id,o.id+'.row.'+op.row);a=list[op.row];if(!a)throw Error('奖项行不存在，请重新查询');before=clone(a);
    if(op.action==='award_remove'){removals.push({list,row:op.row});after='移除此条记录';}
    else{
     if(!['option','count','team','ratio','approval','event','note'].some(k=>Object.hasOwn(op,k)))throw Error('奖项修改未提供字段');
     for(const k of ['option','count','team','ratio','approval','event','note'])if(Object.hasOwn(op,k))a[k]=op[k];
     a.status='待审核';delete a.reviewActor;delete a.reviewTime;delete a.reviewNote;
    }
   }
   if(op.action!=='award_remove'){
    if(!o.options.some(p=>String(p[0])===String(a.option)))throw Error(o.id+' 奖次 / 认定分不在规则选项中');
    if(!a.event?.trim())throw Error('必须填写事项名称 / 凭据编号');
    if(!o.team&&op.team!==undefined)throw Error('该项目没有团队人数设置');
    if(!o.collective&&op.ratio!==undefined)throw Error('该项目没有认定比例设置');
    if(o.type!=='discipline'&&op.approval!==undefined)throw Error('该项目没有处分审批分字段');
    after=clone(a);
   }
   label=o.id+' '+o.name+' / '+({'award_add':'新增待审核记录','award_update':'修改后重新待审核','award_remove':'移除记录'}[op.action]);
  }
  rows.push({student_id:s.id,name:s.name,label,before:before??'',after:after??'',source:op.source,destructive:['student_remove','award_remove'].includes(op.action)});
  changed.set(s.id,s);
 }
 // Row addresses always refer to the original version, never shifted indexes.
 removals.sort((a,b)=>b.row-a.row).forEach(x=>x.list.splice(x.row,1));
 E.validateProject(candidate,RULES);
 for(const [id,s] of changed){
  if(!candidate.students.includes(s))continue;
  const targets=operations.filter(x=>x.student_id===id),r=E.calculate(s,candidate.config,RULES);
  for(const op of targets){
   const key=op.action==='professional_set'?'professional':op.observation_id;
   if(!key)continue;
   const bad=r.issues.filter(i=>i.id===key&&!i.message.includes('未填写'));
   if(bad.length)throw Error(bad.map(x=>x.message).join('；'));
   if(op.action==='award_add'||op.action==='award_update'){
    const o=obs(key),list=s.awards[key]||[];
    const relevant=list.map((a,i)=>({a,d:r.details[key]?.[i]})).filter(x=>x.a.status==='待审核');
    for(const x of relevant)if(x.d?.errors?.length||x.d?.missing?.length)throw Error(o.name+'：'+[...x.d.errors,...x.d.missing].join('；'));
   }
  }
  // Include pending records in deduplication; the score engine itself checks effective ones.
  const events=new Map();for(const [oid,list] of Object.entries(s.awards))for(const a of list){if(a.status==='不计分'||!a.event?.trim())continue;const key=a.event.trim();events.set(key,(events.get(key)||0)+1);}
  for(const op of targets.filter(x=>['award_add','award_update'].includes(x.action))){const a=op.action==='award_add'?op:s.awards[op.observation_id]?.find(a=>a.event===(op.event||rows[operations.indexOf(op)]?.after?.event));if(a?.event&&events.get(a.event.trim())>1)throw Error(id+' 同一事项已有记录：'+a.event+'。请核对是否重复或应取最高，不要重复追加。');}
 }
 const scores=[...changed].map(([id,s])=>({student_id:id,name:s.name,before:project.students.some(s=>s.id===id)?summaryScore(byId(id)):null,after:candidate.students.includes(s)?summaryScore(s):null}));
 return {candidate,rows,scores,changed:[...changed.keys()],changing};
}
function propose(args,origin){
 ensureVersion(args.workspace_id,args.expected_serial);if(readOnly||project.editLock?.locked)throw Error('工作区只读或录入已锁定，不能提交草稿');
 for(const [id,p] of proposals)if(p.workspace!==project.workspaceId)proposals.delete(id);
 const duplicate=[...proposals.values()].find(p=>p.status==='pending'&&p.serial===project.serial&&same(p.operations,args.operations));
 if(duplicate)return {proposal_id:duplicate.id,status:'pending',operations:duplicate.operations.length,message:'同一版本的相同草稿已存在，没有重复创建，也未写入。'};
 if([...proposals.values()].filter(p=>p.status==='pending').length>=8)throw Error('待确认草稿已达 8 份，请先处理');
 const preview=materialize(args.operations),id=uid();
 const p={id,label:args.label,workspace:project.workspaceId,serial:project.serial,operations:clone(args.operations),status:'pending',origin,time:stamp(),rows:preview.rows,scores:preview.scores,selection:args.operations.map(()=>true)};
 proposals.set(id,p);while(proposals.size>20){const old=[...proposals].find(([,p])=>p.status!=='pending');if(!old)break;proposals.delete(old[0]);}
 shown=id;draftPage=1;badge();if(box.open&&activeTab==='review')drawReview();toast('收到 AI 草稿：'+args.operations.length+' 项，请在 AI / MCP 中核对。');
 return {proposal_id:id,status:p.status,operations:p.operations.length,affected_students:preview.scores.length,message:'仅生成草稿，尚未写入；需老师在 HTML 页面确认。',preview:preview.rows.slice(0,15)};
}
function invoke(name,args={},origin='local',scope=null){
 ensureReady();C.validateTool(name,args);
 const allow=id=>{if(scope&&!scope.has(id))throw Error('该学生不在本次授权范围中');return byId(id);};
 let out;
 try{
 if(name==='workspace_summary'){
  const ss=scope?project.students.filter(s=>scope.has(s.id)):project.students;
  out={workspace_id:project.workspaceId,serial:project.serial,title:project.title,students:scope?ss.length:project.students.length,capacity:500,read_only:readOnly||!!project.editLock?.locked,config:clone(project.config),save:ScoreStorage.status(),scope:scope?[...scope]:'当前班级'};
 }else if(name==='students_search'){
  const q=(args.query||'').trim().toLowerCase();out=pageSlice(project.students.filter(s=>(!scope||scope.has(s.id))&&(!args.group||s.group===args.group)&&(!q||s.id.toLowerCase().includes(q)||s.name.toLowerCase().includes(q))).map(identity),args);
 }else if(name==='student_get'){
  const s=allow(args.student_id),section=args.section||'identity';out={...identity(s),section};
  if(['identity','all'].includes(section))out.note=s.note||'';
  if(['scores','all'].includes(section))out.scores=summaryScore(s);
  if(['review','all'].includes(section))out.review={qualified:s.qualified,exception:s.exception,confirmation:s.confirmation||null,approval:s.approval||null};
  if(['values','all'].includes(section))out.values=args.observation_id?{[obs(args.observation_id).id]:clone(s.values[args.observation_id]||[])}:clone(s.values);
  if(['awards','all'].includes(section)){const entries=[];for(const [id,list] of Object.entries(s.awards)){if(args.observation_id&&id!==args.observation_id)continue;list.forEach((a,row)=>entries.push({observation_id:id,row,...clone(a)}));}out.awards=pageSlice(entries,args);}
 }else if(name==='rules_search'){
  const q=(args.query||'').trim().toLowerCase();out=pageSlice(RULES.obs.filter(o=>(!q||[o.id,o.name,o.dim].some(x=>x.toLowerCase().includes(q)))&&(!args.module||o.module===args.module)&&(!args.dimension||o.dim===args.dimension)).map(o=>({id:o.id,name:o.name,module:o.module,dimension:o.dim,type:o.type,cap:o.cap})),args);
 }else if(name==='rule_get'){
  const o=obs(args.observation_id);out={...clone(o),fields:o.fields.map((f,index)=>({...f,index})),dimension_cap:RULES.dims.find(d=>d.name===o.dim)?.max,note:'option 必须来自 options。range 为已审批认定分，不由 AI 选择最高分。次数/小时需区分累计值和新增值；必填缺失不能当作 0。'};
 }else if(name==='score_explain'){
  const s=allow(args.student_id),r=E.calculate(s,project.config,RULES);out=args.observation_id?{student:identity(s),rule:clone(obs(args.observation_id)),values:clone(s.values[args.observation_id]||[]),awards:clone(s.awards[args.observation_id]||[]),points:r.points[args.observation_id],details:r.details[args.observation_id]||[],issues:r.issues.filter(i=>i.id===args.observation_id),work:r.work.filter(i=>i.id===args.observation_id)}:{student:identity(s),...r};
 }else if(name==='tasks_list'){
  const ss=args.student_id?[allow(args.student_id)]:project.students.filter(s=>!scope||scope.has(s.id));const tasks=[];
  for(const s of ss){const r=result(s);for(const x of [...r.issues,...r.work])tasks.push({...identity(s),...x});if(r.ready&&!r.approved)tasks.push({...identity(s),id:'review',message:r.status});}out=pageSlice(tasks,args);
 }else if(name==='changes_propose'){
  if(scope)for(const op of args.operations)if(!scope.has(op.student_id)){
   if(op.action!=='student_add')throw Error('变更包含未授权学生：'+op.student_id);
  }
  out=propose(args,origin);
 }else{
  const p=proposals.get(args.proposal_id);if(!p||p.workspace!==project.workspaceId)throw Error('草稿不存在、属于其他班级或页面刷新后已清除');
  if(scope&&p.operations.some(op=>!scope.has(op.student_id)))throw Error('草稿不在本次授权范围');
  if(name==='changes_discard'){if(p.status!=='pending')throw Error('此草稿已经处理，不能再撤回');p.status='discarded';badge();if(box.open&&activeTab==='review')drawReview();out={proposal_id:p.id,status:p.status};}
  else out={proposal_id:p.id,status:p.status,label:p.label,workspace_id:p.workspace,expected_serial:p.serial,current_serial:project.serial,...pageSlice(p.rows,args),scores:p.scores.slice(0,50),selected:p.selection.filter(Boolean).length};
 }
 log(name,true);return clone(out);
 }catch(e){log(name,false);throw e;}
}
function display(v){
 if(v===null||v===undefined||v==='')return '未填';
 if(Array.isArray(v))return v.map(x=>x&&Object.hasOwn(x,'field')?x.field+'：'+display(x.value):display(x)).join('；');
 if(typeof v==='object'){
  const labels={option:'奖次 / 认定',count:'次数',team:'人数',ratio:'认定比例',approval:'审批扣分',event:'事项',note:'备注',status:'状态',id:'学号',name:'姓名',group:'班级',revision:'修订号'};
  return Object.entries(v).filter(([k,x])=>labels[k]&&x!==''&&x!==null&&x!==undefined).map(([k,x])=>labels[k]+'：'+display(x)).join('；');
 }
 return String(v);
}
function open(tabName='review'){
 ensureReady();activeTab=tabName;badge();
 if(!box.isConnected)document.body.append(box);
 draw();if(!box.open)box.showModal();
}
function draw(){
 const savedInput=box.querySelector('#modelInput')?.value||'';
 box.innerHTML=`<div class="automation-head"><div><h2 id="automationTitle">AI 工具中心</h2><p>HTML 管数据 · AI 提交草稿 · 人工确认后自动保存</p></div><button data-automation="close" aria-label="关闭 AI 工具中心">关闭</button></div>
 <nav class="automation-tabs" aria-label="AI 工具中心"><button data-automation-tab="review" ${activeTab==='review'?'class="active"':''}>待确认草稿</button><button data-automation-tab="connect" ${activeTab==='connect'?'class="active"':''}>连接 AI 机器人 / MCP</button><button data-automation-tab="model" ${activeTab==='model'?'class="active"':''}>页面内调用模型</button></nav>
 <div class="automation-body"><div id="automationError" role="alert"></div><div id="automationPane"></div></div>`;
 if(activeTab==='review')drawReview();else if(activeTab==='connect')drawConnect();else drawModel(savedInput);
}
function drawReview(){
 const pane=box.querySelector('#automationPane');if(!pane)return;
 const list=[...proposals.values()].filter(p=>p.workspace===project.workspaceId).reverse();let p=list.find(p=>p.id===shown)||list[0];if(p)shown=p.id;
 pane.innerHTML=`<div class="automation-row"><p>AI 不能直接覆盖原表。这里核对新旧内容后再录入；未确认草稿仅在当前页面暂存。</p><button data-automation="refresh">刷新状态</button></div>
 ${list.length?`<label>选择草稿<select id="proposalChoice">${list.map(x=>`<option value="${esc(x.id)}" ${x.id===p.id?'selected':''}>${esc(x.label)} · ${x.operations.length} 项 · ${esc(x.status==='pending'?'待确认':x.status==='applied'?'已录入':'已撤回')}</option>`).join('')}</select></label>`:`<div class="automation-empty"><h3>还没有 AI 草稿</h3><p>可连接支持 MCP 的 AI 机器人，或直接在页面内配置 DeepSeek 等模型。平时的手动录入不受影响。</p><div class="small-actions"><button data-automation-tab="connect">连接 MCP 工具包</button><button data-automation-tab="model">粘贴资料让 AI 识别</button></div></div>`}`;
 if(!p)return;
 const stale=p.workspace!==project.workspaceId||p.serial!==project.serial,selectedCount=p.selection.filter(Boolean).length,start=(draftPage-1)*30;
 pane.insertAdjacentHTML('beforeend',`<div class="note ${stale?'amber':''}">${stale?'原表已变化：此草稿不能直接应用，请让 AI 重新读取后生成。':'当前草稿与原表版本一致。'} ${esc(p.time)} · 来源 ${esc(p.origin)}<br>新建或修改奖项将标记“待审核”，此时尚不计分；待办里仍需人工审核。必填成绩未齐时不产生正式总分。</div>
 <div class="automation-row"><strong>${p.operations.length} 项变更 / ${p.scores.length} 名学生，选中 ${selectedCount} 项</strong>${p.status==='pending'?'<div><button data-automation="select-all">全选</button> <button data-automation="select-none">全不选</button></div>':''}</div>
 <details class="automation-score-preview"><summary>查看整份草稿的本地试算（未审核奖项暂不加分）</summary><div class="table-wrap"><table><thead><tr><th>学生</th><th>原总分</th><th>录入后试算</th><th>状态</th></tr></thead><tbody>${p.scores.slice(0,50).map(s=>`<tr><td>${esc(s.name)} · ${esc(s.student_id)}</td><td>${fmt(s.before?.total)}</td><td>${fmt(s.after?.total)}</td><td>${esc(s.after?.status||'将删除')}</td></tr>`).join('')}</tbody></table></div>${p.scores.length>50?'<p>此处显示前 50 名，完整变更逐页核对。勾选部分条目时，提交前会重新验证所选内容。</p>':'<p>这是整份草稿试算，取消勾选部分条目后，最终按实际选中项重新计算。</p>'}</details>
 <div class="automation-proposals">${p.rows.slice(start,start+30).map((r,j)=>{const i=j+start;return `<article class="automation-change ${r.destructive?'destructive':''}"><label class="automation-check"><input type="checkbox" data-proposal-index="${i}" ${p.selection[i]?'checked':''} ${p.status!=='pending'?'disabled':''}><b>${esc(r.name)} · ${esc(r.student_id)}</b><span>${esc(r.label)}</span></label><div class="automation-diff"><div><small>原来</small><div>${esc(display(r.before))}</div></div><div><small>${r.destructive?'将删除':'拟录入'}</small><div>${esc(display(r.after))}</div></div></div><p>依据：${esc(r.source)}</p></article>`;}).join('')}</div>
 <div class="automation-row"><span>第 ${draftPage} / ${Math.max(1,Math.ceil(p.rows.length/30))} 页</span><div><button data-automation="prev" ${draftPage<=1?'disabled':''}>上一页</button> <button data-automation="next" ${start+30>=p.rows.length?'disabled':''}>下一页</button></div></div>
 ${p.status==='pending'?`<div class="automation-commit"><label class="automation-check"><input id="proposalConfirmed" type="checkbox">我已核对所选内容、覆盖项和删除项，确认录入。</label><div class="small-actions"><button id="applyAIProposal" class="primary" data-automation="apply" disabled ${stale?'data-stale="true"':''}>确认录入 ${selectedCount} 项</button><button data-automation="discard">撤回草稿</button></div><small>有疑问的条目先取消勾选；请让 AI 补充资料、改正后重新提案。确认后可在原表撤销。</small></div>`:`<div class="note">${p.status==='applied'?'已录入；保存结果以页面顶部状态为准。原表可继续修改或撤销。':'此草稿已撤回，没有写入原表。'}</div>`}`);
}
function drawConnect(){
 box.querySelector('#automationPane').innerHTML=`<div class="automation-intro"><h3>让外部 AI 真正使用这张表</h3><p>工具包采用 MCP stdio 协议。AI 客户端启动工具服务，HTML 授权连接后，机器人即可查询学生、规则和待办，并提出批量变更。</p></div>
 <ol class="automation-steps"><li>下载并解压仓库，在 mcp 文件夹双击“生成客户端配置.cmd”（需要先安装 Node.js）。将生成的配置加入支持 MCP 的 AI 客户端。</li><li>在 AI 客户端中启用 local-score-desk 工具。服务会在本机生成连接文件。</li><li>点击下方按钮，选择 <code>%LOCALAPPDATA%\\LocalScoreDeskMCP\\connection.json</code>，再确认授权。</li></ol>
 <div class="note">连接后，本机 MCP 客户端能读取当前班级资料；资料是否交给远程模型由该客户端决定。请仅连接你信任的客户端。连接文件含本机通行令牌，不要转发。未连接时不启动轮询、不开放数据。</div>
 <label class="automation-check"><input id="mcpConsent" type="checkbox" ${connection?.ready?'checked':''}>允许本机 MCP 读取当前班级，并提交待确认草稿。所有实际写入仍由我在本页面确认。</label>
 <div class="small-actions"><button data-automation="connect-file" ${connection?'disabled':''}>选择 MCP 连接文件并连接</button><button data-automation="disconnect" ${!connection?'disabled':''}>断开连接</button><button data-automation="export-contract">导出工具定义</button></div>
 <p id="mcpStatus" role="status">${esc(connection?'已连接：'+connection.url+' · '+project.title:'未连接。仅监听本机回环地址，不把 HTML 变成公网服务器。')}</p>
 <details><summary>已开放的 ${C.tools.length} 个工具</summary><ul>${C.tools.map(t=>`<li><b>${esc(t.title)}</b> <code>${esc(t.name)}</code><p>${esc(t.description)}</p></li>`).join('')}</ul><p>全部普通观测点和奖项共用统一接口，不需要给每一栏单独写一份工具。计分配置、学生核对、辅导员复核、恢复备份只由人工操作。</p></details><h3>最近工具调用</h3><div id="automationLog"></div>`;
 drawLog();
}
function drawLog(){const el=box.querySelector('#automationLog');if(el)el.innerHTML=logs.length?logs.slice(0,20).map(x=>`<div class="automation-log">${esc(x.time)} · ${esc(x.name)} · ${x.ok?'完成':'未通过'}</div>`).join(''):'<p>暂无。日志只记工具名称与结果，不保存输入资料。</p>';}
function draftArgs(p,ops){return {workspace_id:p.workspace,expected_serial:p.serial,label:p.label,operations:ops};}
async function applyProposal(event){
 if(!event.isTrusted)throw Error('请由老师点击页面确认按钮');
 const p=proposals.get(shown);if(!p||p.status!=='pending')throw Error('草稿不再待确认');
 if(!box.querySelector('#proposalConfirmed')?.checked)throw Error('请先核对并勾选确认');
 ensureVersion(p.workspace,p.serial);if(!guard())return;
 const operations=p.operations.filter((_,i)=>p.selection[i]);if(!operations.length)throw Error('没有选中变更');
 C.validateTool('changes_propose',draftArgs(p,operations));const preview=materialize(operations);
 const beforeSerial=project.serial;
 mutate('AI 草稿人工确认：'+p.label,()=>{project.students=preview.candidate.students;for(const id of preview.changed){const s=project.students.find(s=>s.id===id);if(s)touch(s);}},{all:true,student:null});
 if(project.serial===beforeSerial)throw Error('未能写入，请检查录入锁定和保存状态');
 p.status='applied';p.applied=stamp();p.applied_count=operations.length;badge();drawReview();
 await ScoreStorage.settled();toast('已录入 '+operations.length+' 项。请查看顶部保存状态；奖项仍需审核。');
}
async function bridgeRequest(path,data,signal){
 const c=connection;if(!c)throw Error('连接已断开');
 const r=await fetch(c.url+path,{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json','X-Score-Client':c.client,...(c.epoch?{'X-Score-Session':c.epoch}:{})},body:JSON.stringify(data||{}),signal,credentials:'omit',redirect:'error',cache:'no-store'});
 if(!r.ok)throw Error(r.status===409?'另一个 HTML 页面已连接此 MCP 服务，请先断开另一个页面。':r.status===401?'连接令牌失效，请重新选择连接文件。':'本机 MCP 服务连接失败（'+r.status+'）');
 return r.json();
}
async function connectFile(file){
 if(!box.querySelector('#mcpConsent')?.checked)throw Error('请先勾选本机 MCP 数据访问授权');
 if(file.size>8192)throw Error('不是有效的连接文件');
 const c=JSON.parse(await file.text()),url=new URL(c.url);
 if(c.kind!=='local-score-desk-mcp-connection'||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.search||url.hash||url.username||url.password||typeof c.token!=='string'||!/^[a-f0-9]{64}$/.test(c.token))throw Error('连接文件无效：只允许本机 127.0.0.1 HTTP 地址');
 if(connection)throw Error('请先断开现有连接');
 if(!mcpClientId){
  // Non-secret tab identity survives reload, but a fresh/duplicated navigation gets its own ID.
  try{const key='LocalScoreDeskMCP.tabIdentity.v1';mcpClientId=performance.getEntriesByType('navigation')[0]?.type==='reload'?sessionStorage.getItem(key)||uid():uid();sessionStorage.setItem(key,mcpClientId);}catch{mcpClientId=uid();}
 }
 connection={url:url.origin,token:c.token,client:mcpClientId,workspace:project.workspaceId};bridgeAbort=new AbortController();
 try{const r=await bridgeRequest('/connect',{workspace_id:project.workspaceId,title:project.title},AbortSignal.timeout(8000));if(typeof r.session!=='string'||r.session.length<8)throw Error('本机桥接版本不匹配，请更新工具包');connection.epoch=r.session;connection.ready=true;void pollBridge();drawConnect();}catch(e){connection=null;throw e;}
}
async function pollBridge(){
 const c=connection,abort=bridgeAbort;
 while(connection===c&&!abort.signal.aborted){
  try{
   if(c.workspace!==project.workspaceId)throw Error('班级已切换，请重新授权连接');
   const job=await bridgeRequest('/poll',{},abort.signal);
   if(c.workspace!==project.workspaceId)throw Error('班级已切换，请重新授权连接');
   if(!job.id)continue;
   let payload;try{payload={data:invoke(job.name,job.arguments,'MCP 机器人')}}catch(e){payload={error:e.message};}
   await bridgeRequest('/result',{id:job.id,...payload},abort.signal);
  }catch(e){if(abort.signal.aborted)return;disconnect();toast('MCP 已断开：'+e.message);if(box.open&&activeTab==='connect')drawConnect();return;}
 }
}
function disconnect(keepalive=false){
 if(!connection)return;
 const c=connection;bridgeAbort?.abort();connection=null;
 void fetch(c.url+'/disconnect',{method:'POST',headers:{Authorization:'Bearer '+c.token,'Content-Type':'application/json','X-Score-Client':c.client,'X-Score-Session':c.epoch||''},body:'{}',credentials:'omit',redirect:'error',keepalive,...(keepalive?{}:{signal:AbortSignal.timeout(3000)})}).catch(()=>{});
}
/* Optional direct model adapter. It never gets a separate write capability. */
function drawModel(input=''){
 const s=current();box.querySelector('#automationPane').innerHTML=`<p>不想配置 MCP 客户端时，也可直接接入兼容 Chat Completions / Function Calling 的模型。此处与 MCP 使用同一套工具接口。</p>
 <details ${modelKey?'':'open'}><summary>接口设置（Key 仅本次打开有效）</summary><div class="automation-settings"><label>API Base URL<input id="modelURL" type="url" value="${esc(modelConfig.url)}" placeholder="https://api.deepseek.com"></label><label>模型名称<input id="modelName" value="${esc(modelConfig.model)}"></label><label>API Key<input id="modelKey" type="password" autocomplete="off" spellcheck="false" placeholder="在本机填写，不要发到聊天中" value="${esc(modelKey)}"></label></div><div class="small-actions"><button data-automation="test-model">测试连接（不发学生资料）</button><button data-automation="forget-key">清除 Key</button></div><p>自定义接口需支持 tools。服务端须允许浏览器跨域请求；若 file:// 直连失败，使用 MCP 客户端连接模型更合适。</p></details>
 <label>本次查询范围<select id="modelScope"><option value="text">仅粘贴文字中涉及的学生</option>${s?`<option value="current">仅当前学生：${esc(s.name)} · ${esc(s.id)}</option>`:''}</select></label>
 <label>粘贴材料或说明（最多 10 万字）<textarea id="modelInput" rows="7" maxlength="100000" placeholder="例如：学号 20260101，王同学，一班，专业素质 88 分。或：学号 DEMO001，志愿服务累计 32 小时，请替换原累计值。">${esc(input)}</textarea></label>
 <label class="automation-check"><input id="modelConsent" type="checkbox">同意将本次文字、匹配学生的必要记录及相关规则发送到我配置的模型服务。</label>
 <div class="small-actions"><button data-automation="run-model" class="primary" ${busy?'disabled':''}>${busy?'AI 正在处理…':'识别并生成草稿'}</button><button data-automation="cancel-model" ${busy?'':'disabled'}>停止</button></div><div id="modelProgress" role="status"></div><pre id="modelReply" class="automation-reply"></pre><p>AI 不确定时会要求补充信息；不会自动审核、改规则或确认录入。关闭页面会清除 Key、对话与未确认草稿。</p>`;
}
function readModelConfig(){
 const url=box.querySelector('#modelURL').value.trim(),model=box.querySelector('#modelName').value.trim(),key=box.querySelector('#modelKey').value.trim();
 const u=new URL(url);if((u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))||u.username||u.password||u.search||u.hash)throw Error('接口只允许 HTTPS，或本机 localhost / 127.0.0.1 HTTP；不能带账号、查询参数或锚点');
 if(!model||model.length>120||!key||key.length>1000)throw Error('请填写模型名称与 API Key');
 modelKey=key;modelConfig={url:u.href.replace(/\/$/,''),model};
 return {...modelConfig,key,endpoint:u.href.replace(/\/$/,'').replace(/(?:\/chat\/completions)?$/, '/chat/completions')};
}
async function modelRequest(cfg,messages,tools,signal){
 const body=JSON.stringify({model:cfg.model,messages,...(tools?{tools,tool_choice:'auto'}:{}),stream:false,max_tokens:8192,...(new URL(cfg.url).hostname==='api.deepseek.com'?{thinking:{type:'disabled'}}:{})});
 if(new TextEncoder().encode(body).length>1536*1024)throw Error('本轮上下文已达 1.5 MB，请缩小材料范围后重新处理');
 const r=await fetch(cfg.endpoint,{method:'POST',headers:{Authorization:'Bearer '+cfg.key,'Content-Type':'application/json'},body,signal:AbortSignal.any([signal,AbortSignal.timeout(90000)]),credentials:'omit',redirect:'error',cache:'no-store'});
 if(!r.ok)throw Error(({401:'Key 无效或已失效',402:'模型服务余额不足',403:'模型服务拒绝访问',429:'模型服务限流，请稍后再试'}[r.status]||'模型服务返回 HTTP '+r.status)+'。没有自动重试，也未写入学生数据。');
 const reader=r.body.getReader();let bytes=0,chunks=[];try{for(;;){const {value,done}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2*1024*1024)throw Error('模型响应过大，已停止');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});}
 const all=new Uint8Array(bytes);let pos=0;for(const v of chunks){all.set(v,pos);pos+=v.length;}
 const data=JSON.parse(new TextDecoder().decode(all)),msg=data.choices?.[0]?.message;if(!msg||msg.role!=='assistant')throw Error('模型返回格式不兼容 Chat Completions');return msg;
}
async function runModel(test=false){
 if(busy)throw Error('请等待当前请求完成，或先停止');
 const cfg=readModelConfig(),progress=box.querySelector('#modelProgress'),reply=box.querySelector('#modelReply');
 const text=box.querySelector('#modelInput').value.trim();
 if(!test&&(!box.querySelector('#modelConsent').checked||!text))throw Error('请填写资料，并勾选本次发送授权');
 const s=current(),scope=new Set();
 if(!test){if(box.querySelector('#modelScope').value==='current'&&s)scope.add(s.id);else{
  const exactId=id=>new RegExp('(^|[^A-Za-z0-9_-])'+id.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'($|[^A-Za-z0-9_-])').test(text);
  for(const x of project.students){
   if(exactId(x.id))scope.add(x.id);
   else if(text.includes(x.name)){
    const peers=project.students.filter(y=>y.name===x.name);if(peers.length>1&&!peers.some(y=>exactId(y.id)))throw Error('材料中有重名学生“'+x.name+'”，请补充学号后再发送');
    if(peers.length===1)scope.add(x.id);
   }
  }
 }}
 const baseWorkspace=project.workspaceId,baseSerial=project.serial;
 busy=true;modelAbort=new AbortController();let generated=[];reply.textContent='';
 for(const id of ['modelURL','modelName','modelKey','modelScope','modelInput'])box.querySelector('#'+id).disabled=true;
 for(const b of box.querySelectorAll('[data-automation="run-model"],[data-automation="test-model"]'))b.disabled=true;box.querySelector('[data-automation="cancel-model"]').disabled=false;
 try{
  if(test){progress.textContent='正在测试接口（不发送学生资料）…';await modelRequest(cfg,[{role:'user',content:'Reply OK.'}],null,modelAbort.signal);progress.textContent='接口连接成功。';return;}
  const tools=C.tools.filter(t=>!['changes_discard','changes_get'].includes(t.name)).map(t=>({type:'function',function:{name:t.name,description:t.description,parameters:t.inputSchema}}));
  const context={workspace_id:baseWorkspace,serial:baseSerial,allowed_students:project.students.filter(x=>scope.has(x.id)).map(identity),current_student:scope.has(s?.id)?identity(s):null};
  const messages=[{role:'system',content:C.instructions+'\n本次仅可查询授权学生；新增学生必须在用户材料中有学号、姓名、班级。禁止扩展到无关学生。不要重复提交同一草稿。上下文：'+JSON.stringify(context)},{role:'user',content:text}];
  let calls=0,finished=false;
  for(let round=0;round<12;round++){
   ensureVersion(baseWorkspace,baseSerial);progress.textContent='AI 正在处理 · 第 '+(round+1)+' 轮 / 工具 '+calls+' 次';
   const m=await modelRequest(cfg,messages,tools,modelAbort.signal);if(modelAbort.signal.aborted)throw new DOMException('停止','AbortError');
   ensureVersion(baseWorkspace,baseSerial);
   if(!m.tool_calls?.length){reply.textContent=String(m.content||'已完成，请核对草稿。').slice(0,30000).split(cfg.key).join('[已隐藏 Key]');finished=true;break;}
   if(!Array.isArray(m.tool_calls)||m.tool_calls.length>20||calls+m.tool_calls.length>60)throw Error('工具调用达到上限，请缩小本次资料范围');
   messages.push({role:'assistant',content:m.content||null,tool_calls:m.tool_calls,...(m.reasoning_content?{reasoning_content:m.reasoning_content}:{})});
   for(const call of m.tool_calls){
    calls++;let out;try{
     if(call.type!=='function'||typeof call.id!=='string')throw Error('工具调用格式无效');
     const args=JSON.parse(call.function.arguments);
     if(call.function.name==='changes_propose'){
      const newIds=new Set((args.operations||[]).filter(op=>op.action==='student_add'&&[op.student_id,op.name,op.group].every(x=>typeof x==='string'&&text.includes(x))).map(op=>op.student_id));
      for(const op of args.operations||[]){if(!scope.has(op.student_id)&&!newIds.has(op.student_id))throw Error('新增或修改了材料中未授权的学生');if(['student_remove','award_remove'].includes(op.action))throw Error('页面内识别不支持删除；请在原表人工处理');}
      for(const id of newIds)scope.add(id);
     }
     out=invoke(call.function.name,args,'页面内模型',scope);if(out.proposal_id&&call.function.name==='changes_propose')generated.push(out.proposal_id);
    }catch(e){out={error:e.message};}
    messages.push({role:'tool',tool_call_id:call.id,content:JSON.stringify(out)});
   }
  }
  if(!finished)throw Error('处理达到 12 轮上限，请缩小范围');
  progress.textContent=generated.length?'已生成 '+generated.length+' 份草稿。请切到“待确认草稿”核对。':'未生成变更草稿。请根据回复补充信息。';
 }catch(e){progress.textContent=e.name==='AbortError'?'已停止。':e.name==='TimeoutError'?'请求超时。':'处理未完成：'+(e instanceof TypeError?'浏览器无法连接接口（网络 / 跨域 CORS）。请检查地址；也可改用 MCP 客户端。':e.message);if(generated.length)progress.textContent+=' 已生成的草稿仍未写入，可在待确认草稿中查看。';}
 finally{busy=false;for(const id of ['modelURL','modelName','modelKey','modelScope','modelInput']){const field=box.querySelector('#'+id);if(field)field.disabled=false;}for(const b of box.querySelectorAll('[data-automation="run-model"],[data-automation="test-model"]'))b.disabled=false;const b=box.querySelector('[data-automation="cancel-model"]');if(b)b.disabled=true;}
}
topButton.addEventListener('click',()=>{try{open();}catch(e){toast(e.message);}});
// Observation-specific launchers use the same generic API, keeping all 89 items covered.
const previousObservationHTML=observationHTML;
observationHTML=function(s,o){return previousObservationHTML(s,o).replace('<div class="obs-body">',()=>`<div class="obs-body"><div class="automation-context"><span>需要整理这个项目的材料？</span><button data-ai-observation="${o.id}">AI 辅助录入</button></div>`);};
document.addEventListener('click',e=>{const b=e.target.closest('[data-ai-observation]');if(!b)return;const s=current(),o=obs(b.dataset.aiObservation);if(!s)return;try{open('model');box.querySelector('#modelScope').value='current';box.querySelector('#modelInput').value='请整理学号 '+s.id+'（'+s.name+'）的 '+o.id+' '+o.name+'，只提交待确认草稿。\n材料：\n';box.querySelector('#modelInput').focus();}catch(err){toast(err.message);}});
box.addEventListener('click',async e=>{
 const tabButton=e.target.closest('[data-automation-tab]');if(tabButton){if(busy){warn('请先停止当前模型请求再切换');return;}activeTab=tabButton.dataset.automationTab;draw();return;}
 const b=e.target.closest('[data-automation]');if(!b)return;const a=b.dataset.automation;
 try{
  if(a==='close'){if(busy)modelAbort?.abort();box.close();}
  else if(a==='connect-file'){
   if(!box.querySelector('#mcpConsent').checked)throw Error('请先勾选本机 MCP 数据访问授权');
   const f=document.createElement('input');f.type='file';f.accept='.json,application/json';f.onchange=()=>{if(f.files[0])void connectFile(f.files[0]).catch(e=>warn(e.message));};f.click();
  }else if(a==='disconnect'){disconnect();drawConnect();}
  else if(a==='export-contract')download('综测工具接口_v1.5.json',JSON.stringify({version:C.version,instructions:C.instructions,tools:C.tools},null,2),'application/json');
  else if(a==='apply'){b.disabled=true;try{await applyProposal(e);}catch(err){b.disabled=false;throw err;}}
  else if(a==='discard'){const p=proposals.get(shown);invoke('changes_discard',{proposal_id:p.id});}
  else if(a==='prev'||a==='next'){draftPage+=a==='prev'?-1:1;drawReview();}
  else if(a==='select-all'||a==='select-none'){const p=proposals.get(shown);p.selection.fill(a==='select-all');drawReview();}
  else if(a==='refresh')drawReview();
  else if(a==='test-model')await runModel(true);
  else if(a==='run-model')await runModel();
  else if(a==='cancel-model')modelAbort?.abort();
  else if(a==='forget-key'){modelAbort?.abort();modelKey='';box.querySelector('#modelKey').value='';toast('已清除本次 Key，并停止正在执行的模型请求');}
 }catch(err){warn(err.message);}
});
box.addEventListener('change',e=>{
 if(e.target.id==='mcpConsent'&&!e.target.checked&&connection){disconnect();drawConnect();toast('已撤回 MCP 授权并断开连接');}
 if(e.target.id==='modelConsent'&&!e.target.checked&&busy)modelAbort?.abort();
 if(e.target.id==='proposalChoice'){shown=e.target.value;draftPage=1;drawReview();}
 if(e.target.hasAttribute('data-proposal-index')){const p=proposals.get(shown);p.selection[Number(e.target.dataset.proposalIndex)]=e.target.checked;drawReview();}
 if(e.target.id==='proposalConfirmed'){const b=box.querySelector('#applyAIProposal'),p=proposals.get(shown);b.disabled=!e.target.checked||b.dataset.stale==='true'||!p.selection.some(Boolean);}
});
box.addEventListener('cancel',()=>modelAbort?.abort());
document.addEventListener('visibilitychange',()=>{if(connection&&connection.workspace!==project.workspaceId)disconnect();});
window.addEventListener('pagehide',()=>{modelAbort?.abort();disconnect(true);});
// Public contract is read / stage only. There is intentionally no commit, approve or eval API.
window.ScoreAutomation=Object.freeze({version:C.version,tools:()=>clone(C.tools),invoke:(name,args)=>invoke(name,args,'本机 API'),open:()=>open(),status:()=>({connected:!!connection?.ready,pending:[...proposals.values()].filter(p=>p.status==='pending'&&p.workspace===project.workspaceId).length})});
})();
