/* Standalone scoring engine. No DOM, network, workbook, or runtime dependencies. */
(function(root){
'use strict';
const VERSION='bupt-local-1';
const blank=v=>v===null||v===undefined||v==='';
const number=v=>typeof v==='number'&&Number.isFinite(v);
const inRange=(v,lo,hi)=>number(v)&&v>=lo&&v<=hi;
const count=v=>blank(v)||(number(v)&&v>=0&&Number.isInteger(v));
function defaults(){return {year:'',cohort:'',confirmed:false,operator:'',weights:[.1,.7,.2],peer:.7,counselor:.3,capFirst:true,floor:true,discipline:'fixed'};}
function configErrors(c){
 const e=[];if(!Array.isArray(c.weights)||c.weights.length!==3||c.weights.some(v=>!inRange(v,0,1))||Math.abs(c.weights.reduce((a,b)=>a+b,0)-1)>1e-7)e.push('三个模块权重合计须为 100%');
 if(!inRange(c.peer,0,1)||!inRange(c.counselor,0,1)||Math.abs(c.peer+c.counselor-1)>1e-7)e.push('两项评议权重合计须为 100%');
 if(!['fixed','interval'].includes(c.discipline)||typeof c.capFirst!=='boolean'||typeof c.floor!=='boolean')e.push('计分口径无效');return e;
}
function calculate(s,c,R){
 const issues=[],points={},dimensions={},details={},work=[];
 const problem=(id,message,blocking=true)=>issues.push({id,message,blocking});
 const events=new Map();
 for(const o of R.obs){for(const a of s.awards[o.id]||[]){if((a.status||'有效')==='有效'&&!blank(a.option)&&!(o.type==='discipline'&&c.discipline==='interval'&&blank(a.approval))&&(blank(a.count)?1:a.count)>0&&a.event){const k=a.event.trim();if(k)events.set(k,(events.get(k)||0)+1);}}}
 for(const o of R.obs){
  const v=s.values[o.id]||[],errs=[];let p=0;
  const fail=m=>errs.push(m);
  const nv=(x,lo,hi,label,required=false)=>{if(blank(x)){if(required)fail(label+'未填写');return 0;}if(!inRange(x,lo,hi))fail(label+`须为 ${lo}–${hi} 的数值`);return number(x)?x:0;};
  const q=(x,label)=>{if(!count(x))fail(label+'须为非负整数');return blank(x)?0:(number(x)?x:0);};
  if(o.type==='base'){const a=nv(v[0],0,o.max,'同学互评',true),b=nv(v[1],0,o.max,'辅导员评议',true);p=a*c.peer+b*c.counselor;}
  if(o.type==='external')p=nv(v[0],0,100,'原始成绩',true)*o.rate;
  if(o.type==='qty')p=q(v[0],'次数')*o.rate;
  if(o.type==='bool'){if(!blank(v[0])&&!['是','否'].includes(v[0]))fail('请选择是或否');p=v[0]==='是'?o.rate:0;}
  if(o.type==='hours')p=Math.min(Math.floor(nv(v[0],0,10000,'小时')/10)*.5,o.cap);
  if(o.type==='activity'){
   const tiers=o.cap===null?2:3;const t=Array.from({length:tiers},(_,i)=>q(v[i],o.fields?.[i]?.label||'参与次数')+(o.audience?q(v[tiers+i],o.fields?.[tiers+i]?.label||'观众次数')*.3:0));
   p=t[0]*2+t[1]+(tiers===3?Math.min(t[2]*.5,o.cap):0);
  }
  if(o.type==='job'){
   const match=(o.options||[]).find(([k])=>String(k)===String(v[0]));
   if(blank(v[0])){if(!blank(v[1]))fail('先选择任职认定级别');}else if(!match||!['不足半年','半年','超过半年'].includes(v[1]))fail('认定级别或任期未选完整');
   p=(match?match[1]*({'不足半年':0,'半年':.5,'超过半年':1}[v[1]]||0):0)+nv(v[2],0,8,'其他序列认定分');
  }
  if(['award','range','discipline'].includes(o.type)){
   for(const [i,a] of (s.awards[o.id]||[]).entries()){
    const ae=[],missing=[],status=a.status||'有效',n=blank(a.count)?1:a.count;
    const match=(o.options||[]).find(([k])=>String(k)===String(a.option));
    if(!['有效','待审核','不计分'].includes(status))ae.push('审核状态无效');
    if(!count(a.count))ae.push('次数须为非负整数');
    if(blank(a.option))missing.push('请选择奖次或认定分');else if(!match)ae.push('奖次或认定分无效，请重新选择');
    let raw=match?match[1]:0,coeff=1;
    if(o.team){const team=blank(a.team)?1:a.team;if(!inRange(team,1,o.team)||!Number.isInteger(team))ae.push(`人数须为 1–${o.team} 的整数`);else coeff=(1+(team-1)*.6)/team;
     if(o.collective&&!blank(a.ratio)){if(!inRange(a.ratio,0,1))ae.push('认定比例须为 0–100%');else coeff=Math.min(1,(1+(team-1)*.6)*a.ratio);}}
    if(o.type==='discipline'&&c.discipline==='interval'&&n>0){const ranges={'警告':[30,40],'严重警告':[40,50],'记过':[50,60],'留校察看':[60,100],'治安管理处罚':[100,100]},range=ranges[a.option];if(blank(a.approval))missing.push('请填写审批认定扣分');else if(match&&(!range||!inRange(a.approval,...range)))ae.push('请填写处分级别对应区间内的认定扣分');raw=number(a.approval)?a.approval:0;}
    const value=raw*coeff*(number(n)?n:0);
    if(status==='有效'&&n>0&&a.event&&events.get(a.event.trim())>1)ae.push('同一事项重复计分：'+a.event.trim());
    if(status==='有效'){
     if(ae.length)fail(`第 ${i+1} 项：${ae.join('；')}`);else if(!missing.length)p+=value;
     if(missing.length)work.push({id:o.id,message:o.name+`：第 ${i+1} 条记录待填写（${missing.join('；')}）`});
     else if(n>0&&(!a.event||!a.event.trim()))work.push({id:o.id,message:o.name+'：补充事项名称 / 凭据编号'});
    }else if(status==='待审核')work.push({id:o.id,message:o.name+'：有待审核记录'+(ae.length||missing.length?'（'+[...ae,...missing].join('；')+'）':'')});
    (details[o.id]??=[]).push({value:ae.length||missing.length?null:value,status,errors:ae,missing});
   }
   if(o.cap!==null)p=Math.min(p,o.cap);
  }
  points[o.id]=errs.length?null:p;for(const m of errs)problem(o.id,(o.type==='base'?o.dim+'评议':o.name)+'：'+m);
 }
 const career=R.dims.find(d=>d.name==='职业素质');
 const careerComplete=career.items.every(o=>points[o.id]!==null);
 const overflow=careerComplete?Math.max(0,career.items.filter(o=>o.transfer).reduce((a,o)=>a+points[o.id],0)-career.max):0;
 for(const d of R.dims){
  if(d.items.some(o=>points[o.id]===null)){dimensions[d.name]=null;continue;}
  let pos=d.items.filter(o=>o.sign>0).reduce((a,o)=>a+points[o.id],0),neg=d.items.filter(o=>o.sign<0).reduce((a,o)=>a+points[o.id],0);
  if(d.name==='体质健康')pos=d.items.filter(o=>o.type==='external').reduce((a,o)=>a+points[o.id],0)+Math.min(10,d.items.filter(o=>o.type!=='external').reduce((a,o)=>a+points[o.id],0));
  if(d.name==='科学创新')pos+=overflow;
  const raw=c.capFirst?Math.min(pos,d.max)-neg:Math.min(pos-neg,d.max);
  dimensions[d.name]=d.name==='整体扣分'?neg:(c.floor?Math.max(0,raw):raw);
 }
 const aggregate=module=>{const ds=R.dims.filter(d=>d.module===module);if(ds.some(d=>dimensions[d.name]===null))return null;const sum=ds.filter(d=>d.name!=='整体扣分').reduce((a,d)=>a+dimensions[d.name],0);return module==='基本'?Math.max(0,Math.min(100,sum)-dimensions['整体扣分']):Math.min(100,sum);};
 const basic=aggregate('基本'),development=aggregate('发展');let professional=s.professional;
 if(blank(professional)){professional=null;problem('professional','专业素质成绩未填写');}else if(!inRange(professional,0,100)){professional=null;problem('professional','专业素质成绩须为 0–100 的数值');}
 if(!s.id.trim()||!s.name.trim()||!s.group.trim())problem('identity','学号、姓名、班级须填写完整');
 for(const m of configErrors(c))problem('config',m);
 const total=issues.length||[basic,development,professional].some(v=>v===null)?null:basic*c.weights[0]+professional*c.weights[1]+development*c.weights[2];
 if(!c.confirmed||!c.year.trim()||!c.cohort.trim())work.push({id:'config',message:'先确认评定学年、适用年级和计分规则'});
 if(!s.qualified)work.push({id:'qualification',message:'资格、同一事项取最高及跨项去重尚未核对'});
 if(s.exception)work.push({id:'exception',message:'有特殊贡献 / 取消加分等个案，须另行认定，本工具不自动作正式结论'});
 const ready=total!==null&&work.length===0;
 const confirmed=ready&&s.confirmation?.revision===s.revision&&s.confirmation?.rules===JSON.stringify(c);
 // Student acknowledgements are optional records, never prerequisites for teacher review.
 const approved=ready&&s.approval?.revision===s.revision&&s.approval?.rules===JSON.stringify(c);
 return {points,dimensions,details,basic,professional,development,total,overflow,issues,work,ready,confirmed,approved,status:total===null?(issues.some(i=>i.message.includes('未填写'))?'待补齐':'输入异常'):!ready?'待处理':approved?'已复核':'待老师核对'};
}
function validateProject(p,R){
 if(!p||p.format!==VERSION||!Array.isArray(p.students)||p.students.length>500)throw Error('不是本应用的备份，或人数超过 500。');
 if(typeof p.title!=='string'||p.title.length>120||!Number.isSafeInteger(p.serial)||p.serial<0||typeof p.modified!=='string')throw Error('备份的工作区信息无效。');
 if(p.workspaceId!==undefined&&(typeof p.workspaceId!=='string'||!p.workspaceId||p.workspaceId.length>120))throw Error('工作区标识无效。');
 if(p.editLock!==undefined&&(!p.editLock||typeof p.editLock.locked!=='boolean'||!['actor','note','time'].every(k=>typeof p.editLock[k]==='string'&&p.editLock[k].length<=300)))throw Error('录入锁定记录无效。');
 if(!p.config||configErrors(p.config).length||!['year','cohort','operator'].every(k=>typeof p.config[k]==='string')||typeof p.config.confirmed!=='boolean')throw Error('备份中的规则配置无效。');
 if(p.audit!==undefined&&(!Array.isArray(p.audit)||p.audit.length>300||p.audit.some(a=>!a||typeof a!=='object'||!['time','action','actor'].every(k=>typeof a[k]==='string'&&a[k].length<=1000))))throw Error('备份的操作记录无效。');
 const ids=new Set(),known=new Map(R.obs.map(o=>[o.id,o]));
 for(const s of p.students){
  if(!s||!['id','name','group'].every(k=>typeof s[k]==='string'&&s[k].trim()&&s[k].length<=120)||ids.has(s.id))throw Error('名单中存在缺失、过长或重复的学号 / 姓名 / 班级。');ids.add(s.id);
  if(!s.values||!s.awards||typeof s.values!=='object'||Array.isArray(s.values)||typeof s.awards!=='object'||Array.isArray(s.awards)||!Number.isInteger(s.revision)||s.revision<0)throw Error('学生记录结构无效。');
  for(const [k,v] of Object.entries(s.values))if(!known.has(k)||!Array.isArray(v)||v.length>10||v.some(x=>!['string','number'].includes(typeof x)&&x!==null))throw Error('观测点字段无效。');
  for(const [k,v] of Object.entries(s.awards))if(!known.has(k)||!['award','range','discipline'].includes(known.get(k).type)||!Array.isArray(v)||v.length>1000||v.some(a=>!a||typeof a!=='object'||!['string','number'].includes(typeof a.option)||!['有效','待审核','不计分'].includes(a.status||'有效')||['event','note'].some(f=>a[f]!==undefined&&typeof a[f]!=='string')))throw Error('奖项记录结构无效。');
  if(Object.values(s.awards).reduce((a,v)=>a+v.length,0)>5000)throw Error('单人记录过多。');
  if(s.activityLog!==undefined&&(!Array.isArray(s.activityLog)||s.activityLog.length>100||s.activityLog.some(a=>!a||!known.has(a.id)||!['activity','qty','bool','hours'].includes(known.get(a.id).type)||typeof a.event!=='string'||a.event.length>200||!['add','replace'].includes(a.mode)||!Array.isArray(a.values)||a.values.length>6||a.values.some(v=>typeof v!=='number'&&typeof v!=='string'))))throw Error('活动登记记录无效。');
 }
 return p;
}
function parseCSV(text){
 const rows=[];let row=[],v='',quoted=false;const delim=text.split(/\r?\n/,1)[0].includes('\t')?'\t':',';
 text=text.replace(/^\uFEFF/,'');for(let i=0;i<text.length;i++){const ch=text[i];if(quoted){if(ch==='"'&&text[i+1]==='"'){v+='"';i++;}else if(ch==='"')quoted=false;else v+=ch;}else if(ch==='"'&&v==='')quoted=true;else if(ch===delim){row.push(v.trim());v='';}else if(ch==='\n'||ch==='\r'){if(ch==='\r'&&text[i+1]==='\n')i++;row.push(v.trim());if(row.some(x=>x!==''))rows.push(row);row=[];v='';}else v+=ch;}
 if(quoted)throw Error('有未闭合的引号，请检查粘贴内容。');row.push(v.trim());if(row.some(x=>x!==''))rows.push(row);return rows;
}
const api={VERSION,defaults,configErrors,calculate,validateProject,parseCSV,blank};root.ScoreEngine=api;if(typeof module!=='undefined')module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
