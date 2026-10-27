/* Teacher workbench. Navigation and presentation only; never changes project data. */
(()=>{
'use strict';
let gridOrigin=null;
const workspace=()=>project.workspaceId||'legacy:'+project.title;
const workflow=()=>window.ScoreWorkflow;
const kindLabels={grades:'成绩待补齐',invalid:'输入需更正',awards:'奖项待审核',materials:'事项待补充',qualification:'资格待核对',exception:'个案待认定',approval:'待老师核对'};
function scopeLabel(){const v=workflow().view(),parts=[v.group||'全部班级'];if(query.trim())parts.push('搜索“'+query.trim()+'”');return parts.join(' · ');}
function summary(){
 const students=workflow().scoped(),results=students.map(result),counts=Object.fromEntries(Object.keys(kindLabels).map(k=>[k,0]));
 for(const s of students)for(const k of new Set(workflow().taskFor(s).map(t=>t.kind)))if(k in counts)counts[k]++;
 const total=students.length,approved=results.filter(r=>r.approved).length,complete=results.filter(r=>r.total!==null),ready=results.filter(r=>r.ready&&!r.approved).length;
 let state='review',kind='all',title='继续处理未完成事项',label='查看老师核对',action='tasks',message='核对当前范围的材料、资格与计分结果。';
 if(!project.students.length){state='roster';title='先导入学生名单';label='导入学生名单';action='roster';message='从 Excel 复制学号、姓名、班级，检查后导入。';}
 else if(!total){state='empty';title='当前范围没有学生';label='调整筛选';action='scope';message='换一个班级或搜索条件后继续。';}
 else if(!project.config.confirmed){state='rules';title='先确认本班适用规则';label='确认规则';action='settings';message='确认学年、年级和计分口径后再正式核对。';}
 else if(counts.grades){state='grades';kind='grades';title=counts.grades+' 人成绩待补齐';label='补齐成绩';action='grades';message='在全班成绩表补齐原始成绩和班级评议。';}
 else{
  const next=['invalid','awards','materials','qualification','exception'].find(k=>counts[k]);
  if(next){state=next;kind=next;title=counts[next]+' 人'+kindLabels[next];label='处理'+kindLabels[next];message=next==='awards'?'核对材料后，再登记奖项审核结果。':next==='qualification'?'核对资格、同作品最高奖与跨项去重。':'逐人处理当前类别，完成后继续下一位。';}
  else if(ready){state='approval';kind='approval';title=ready+' 人可以登记老师核对';label='批量老师核对';action='approve';message='仅对已就绪学生登记，仍须老师逐人核对并确认。';}
  else if(approved===total){state='complete';title='当前范围已全部核对';label='导出已核对结果';action='export';message=approved+' 人已由老师核对，可导出或留存备份。';}
 }
 return {total,approved,complete:complete.length,ready,average:complete.length?complete.reduce((n,r)=>n+r.total,0)/complete.length:null,counts,state,kind,title,label,action,message,scope:scopeLabel()};
}
function cardMarkup(s){return `<div class="workbench-next-copy"><div class="workbench-kicker">下一步 <span>${esc(s.scope)} · ${s.total} 人</span></div><h2 id="workbenchNextTitle">${esc(s.title)}</h2><p>${esc(s.message)}</p></div><button class="primary" data-workbench="${s.action}" data-workbench-kind="${s.kind}">${esc(s.label)} →</button>`;}
function decorateOverview(){
 const main=$('#app main');if(!main)return;
 const s=summary();let card=$('#workbenchNext');
 if(!card){card=document.createElement('section');card.id='workbenchNext';card.className='workbench-next';card.setAttribute('aria-labelledby','workbenchNextTitle');const heading=main.querySelector('.heading');if(heading)heading.after(card);else main.prepend(card);}
 card.dataset.workbenchState=s.state;card.innerHTML=cardMarkup(s);
 main.querySelector('.heading [data-action=export]')?.classList.remove('primary');
 if(s.state==='roster')main.querySelector('[data-action=bulk]')?.classList.remove('primary');
 const stats=[...main.querySelectorAll('.stats .stat')];
 const values=[['当前范围',query||workflow().view().group?`${s.total} / ${project.students.length}<small>人</small>`:`${s.total}<small>人</small>`],['可生成试算',`${s.complete}<small>/ ${s.total}</small>`],['老师已核对',`${s.approved}<small>人</small>`],['试算均分',fmt(s.average)]];
 stats.slice(0,4).forEach((node,i)=>{node.dataset.workbenchStat=String(i);node.querySelector('span').textContent=values[i][0];node.querySelector('b').innerHTML=values[i][1];node.title='按班级和搜索范围统计';});
}
function queue(kind){
 const rows=workflow().pendingQueue?workflow().pendingQueue(kind):workflow().scoped();
 return rows.map(row=>{const s=row.s||row.student||row,items=row.items||workflow().taskFor(s);return {s,items:items.filter(i=>kind==='all'||i.kind===kind)};}).filter(row=>row.items.length);
}
function decorateTasks(){
 const heading=$('#app main > .heading'),actions=heading?.querySelector('.actions');if(!actions)return;
 const s=summary(),kind=workflow().view().taskKind||'all';
 actions.querySelector('[data-workbench-task-action]')?.remove();
 const buttons=[...actions.querySelectorAll('button')];buttons.forEach(b=>{b.classList.remove('primary');if(b.dataset.workbench==='export')delete b.dataset.workbench;});
 let primary=null,custom='';
 if(s.total){
  if(!project.config.confirmed)custom='settings';
  else{
   const active=kind==='all'?s.state:kind,count=kind==='all'?s.total:s.counts[kind]||0;
   if(count){
    if(active==='grades')primary=actions.querySelector('[data-page=gradegrid]');
    else if(active==='awards')primary=actions.querySelector('[data-ux=reviewAwards]');
    else if(active==='qualification')primary=actions.querySelector('[data-ux=qualifyMany]');
    else if(active==='approval')primary=actions.querySelector('[data-ux16=approve-ready]');
    else if(active==='complete'){primary=actions.querySelector('[data-action=export]');if(primary)primary.dataset.workbench='export';}
    else if(queue(kind).length)custom='process-first';
   }
  }
 }
 if(custom){const b=document.createElement('button');b.className='primary';b.dataset.workbench=custom;b.dataset.workbenchTaskAction='1';b.textContent=custom==='settings'?'先确认规则':'处理当前待办 →';actions.prepend(b);primary=b;}
 primary?.classList.add('primary');
 let note=$('#workbenchTaskScope');if(!note){note=document.createElement('p');note.id='workbenchTaskScope';note.className='workbench-task-scope';heading.after(note);}
 note.textContent=s.scope+' · '+s.total+' 人'+(s.total?' · 老师已核对 '+s.approved+' 人':' · 请调整筛选范围');
}
function validOrigin(){if(gridOrigin?.workspace!==workspace()){gridOrigin=null;return null;}return gridOrigin;}
function captureGridOrigin(studentId){
 if(page!=='gradegrid')return false;
 const view=window.ScoreUX?.captureGrid();if(!view)return false;
 if(!view.id)view.id=studentId;if(view.col===undefined)view.col='0';
 gridOrigin={workspace:workspace(),student:String(studentId),query,view:clone(view)};return true;
}
function returnToOrigin(){
 const source=validOrigin();if(!source)return false;
 query=source.query;workflow().restoreTasks?.(source.view);page='gradegrid';window.ScoreUX.restoreGrid(clone(source.view));return true;
}
function decorateRosterScope(){
 const status=$('.roster #statusFilter');if(!status)return;
 const reviewing=page==='students'&&window.ScoreUX?.reviewOrigin();
 status.hidden=!!reviewing;status.disabled=!!reviewing;
 let note=$('#workbenchQueueScope');
 if(!reviewing){note?.remove();return;}
 if(!note){note=document.createElement('p');note.id='workbenchQueueScope';note.className='hint workbench-roster-scope';status.after(note);}
 const kind=workflow().view().taskKind||'all',label=kind==='all'?'全部个人待办':kindLabels[kind]||'当前待办';
 note.dataset.workbenchQueueKind=kind;
 note.textContent='当前类别：'+label+' · '+workflow().pendingQueue(kind).length+' 人待办';
 note.title='此处按老师核对类别显示；返回总览后保留原状态筛选。';
}
function decorateTeacherActions(){
 const reviewing=page==='students'&&window.ScoreUX?.reviewOrigin();
 for(const button of document.querySelectorAll('#editor [data-ux=nextProblem]'))button.hidden=!!reviewing;
 for(const button of document.querySelectorAll('#editor [data-action=nextStudent]')){
  if(reviewing){if(!button.hasAttribute('data-workbench-next-label'))button.dataset.workbenchNextLabel=button.textContent;button.textContent='下一位待办 →';}
  else if(button.hasAttribute('data-workbench-next-label')){button.textContent=button.dataset.workbenchNextLabel;delete button.dataset.workbenchNextLabel;}
 }
}
function decorateSource(){
 const editor=$('#editor');if(page!=='students'||!editor){$('#workbenchSource')?.remove();return;}
 const review=$('#reviewReturn');if(review){review.classList.add('workbench-source');const hint=review.querySelector('.hint');if(hint)hint.textContent='保留当前类别与筛选范围';}
 const source=validOrigin(),reviewing=window.ScoreUX?.reviewOrigin();
 let bar=$('#workbenchSource');if(!source||reviewing){bar?.remove();return;}
 if(!bar){bar=document.createElement('div');bar.id='workbenchSource';bar.className='workbench-source';editor.prepend(bar);}
 const section=source.view.gridSection==='allBase'?'全部评议':source.view.gridSection==='main'?'专业 / 体测 / 耐力跑':ruleMap.get(source.view.gridSection)?.dim+'评议';
 bar.innerHTML=`<button data-workbench="return-origin">← 返回成绩表</button><span>${esc(section)} · 第 ${(source.view.gridPage||0)+1} 页</span>`;
}
function nextPending(direction=1){
 if(page!=='students'||!(window.ScoreUX?.reviewOrigin()||window.ScoreUX?.area()==='tasks'))return false;
 const kind=workflow().view().taskKind||'all',rows=queue(kind),byId=new Map(rows.map(row=>[row.s.id,row])),all=workflow().scoped(),i=all.findIndex(s=>s.id===selected);
 const ordered=i<0?(direction<0?[...all].reverse():all):direction<0?[...all.slice(0,i).reverse(),...all.slice(i+1).reverse()]:[...all.slice(i+1),...all.slice(0,i)];
 const next=ordered.map(s=>byId.get(s.id)).find(Boolean);
 if(next)workflow().openStudent(next.s.id,next.items[0].id);else toast(kind==='all'?'当前范围没有其他待办学生。':'当前类别没有其他待办学生。');
 return true;
}
function openTasks(kind='all'){
 if(workflow().selectTaskKind)workflow().selectTaskKind(kind);else{page='tasks';render();}
}
function openApprovedExport(){
 window.ScoreUX.exportDialog();const scope=$('#exportRange');if(scope){scope.value='scope';scope.dispatchEvent(new Event('change',{bubbles:true}));}
 $('#modal [data-action=exportAll]')?.classList.remove('primary');const approved=$('#modal [data-action=exportApproved]');approved?.classList.add('primary');approved?.focus();
}
function action(name,kind){
 switch(name){
  case 'roster':bulk('roster');break;
  case 'scope':($('#app [data-ux-group]')||$('#search')||$('#uxSearch'))?.focus();break;
  case 'settings':settings();break;
  case 'grades':gridOrigin=null;page='gradegrid';render();break;
  case 'tasks':gridOrigin=null;openTasks(kind);break;
  case 'approve':gridOrigin=null;openTasks('approval');$('#app [data-ux16=approve-ready]')?.click();break;
  case 'export':openApprovedExport();break;
  case 'return-origin':returnToOrigin();break;
  case 'process-first':$('#app [data-task-student]')?.click();break;
 }
}
function decorate(){validOrigin();if(page==='overview')decorateOverview();if(page==='tasks')decorateTasks();decorateRosterScope();decorateTeacherActions();decorateSource();}
document.addEventListener('click',e=>{const b=e.target.closest('[data-workbench]');if(!b)return;e.preventDefault();e.stopImmediatePropagation();if(!initialized)return;try{action(b.dataset.workbench,b.dataset.workbenchKind||'all');}catch(error){reportError(error);}},true);
window.ScoreViews.provide('workbench',Object.freeze({decorate,summary,captureGridOrigin,returnToOrigin,clearOrigin:()=>{gridOrigin=null;$('#workbenchSource')?.remove();},nextPending,openTasks,origin:()=>{const source=validOrigin();return source?clone(source):null;},version:'2.0'}));
})();
