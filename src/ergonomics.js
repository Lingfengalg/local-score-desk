/* Entry ergonomics v1.3. View state is separate from student data and never enters backups. */
(()=>{
'use strict';
const SESSION_KEY='BUPTStandaloneScores.entryView.v1',views=new Map();
let lastView=null,rememberTimer,restoring=false,lastTarget='',targetStudent='',targetCache=null;
try{const saved=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');if(saved?.version===1&&Array.isArray(saved.views)){for(const v of saved.views.slice(-20))if(validView(v))views.set(v.key,v);if(validView(saved.last))lastView=saved.last;}}catch{/* A blocked view-preference store must never block data entry or saving. */}
const scope=()=>project.workspaceId||'legacy:'+project.title+':'+project.students.length;
const keyFor=(id,t,d)=>JSON.stringify([scope(),id,t,t==='activities'?d:'']);
const nested=el=>getComputedStyle(el).overflowY==='auto';
function validView(v){return v&&typeof v.key==='string'&&v.key.length<700&&typeof v.scope==='string'&&typeof v.student==='string'&&['required','activities','review'].includes(v.tab)&&typeof v.dimension==='string'&&Number.isFinite(v.scroll)&&v.scroll>=0&&Number.isFinite(v.window)&&v.window>=0&&Array.isArray(v.opens)&&v.opens.length<=89&&v.opens.every(x=>typeof x==='string'&&/^obs-[BD]\d{3}$/.test(x));}
function descriptor(el){if(!el)return null;if(el.dataset.award)return {award:el.dataset.award,row:el.dataset.row,key:el.dataset.key};if(el.dataset.value)return {value:el.dataset.value,index:el.dataset.index};if(el.hasAttribute('data-professional'))return {professional:true};if(el.hasAttribute('data-student-note'))return {note:true};return null;}
function fieldFor(f){if(!f)return null;const q=v=>CSS.escape(String(v));if(f.award)return $(`[data-award="${q(f.award)}"][data-row="${q(f.row)}"][data-key="${q(f.key)}"]`);if(f.value)return $(`[data-value="${q(f.value)}"][data-index="${q(f.index)}"]`);return f.professional?$('[data-professional]'):f.note?$('[data-student-note]'):null;}
function capture(){
 const editor=$('#editor');if(!editor?.dataset.entryKey)return null;
 const top=Math.max(0,editor.getBoundingClientRect().top,$('.entry-sticky')?.getBoundingClientRect().bottom||0);
 const active=document.activeElement,inside=editor.contains(active),focusedObs=inside?active.closest('.observation'):null,focusBox=focusedObs?active.getBoundingClientRect():null;
 const anchor=tab!=='activities'?null:focusedObs&&!focusedObs.hidden&&focusBox.bottom>top&&focusBox.top<innerHeight?focusedObs:[...editor.querySelectorAll('.observation')].find(e=>!e.hidden&&e.getBoundingClientRect().bottom>top);
 return {key:editor.dataset.entryKey,scope:editor.dataset.entryScope,student:editor.dataset.entryStudent,tab:editor.dataset.entryTab,dimension:editor.dataset.entryDimension,scroll:editor.scrollTop,window:scrollY,roster:$('#rosterList')?.scrollTop||0,nested:nested(editor),opens:[...editor.querySelectorAll('.observation[open]')].map(e=>e.id),onlyFilled:$('#onlyFilled')?.checked||false,search:$('#observationSearch')?.value.slice(0,120)||'',anchor:anchor?.id||'',field:inside?descriptor(active):null,selection:inside&&typeof active.selectionStart==='number'?[active.selectionStart,active.selectionEnd]:null};
}
function persist(){try{sessionStorage.setItem(SESSION_KEY,JSON.stringify({version:1,last:lastView,views:[...views.values()].slice(-20)}));}catch{}}
function remember(){if(restoring)return;const v=capture();if(!v)return;views.delete(v.key);views.set(v.key,v);while(views.size>80)views.delete(views.keys().next().value);lastView=v;persist();updateLocation(v);}
function restore(v,{focus=false}={}){
 const editor=$('#editor');if(!validView(v)||v.scope!==scope()||editor?.dataset.entryKey!==v.key)return;
 restoring=true;
 try{
  const opens=new Set(v.opens);editor.querySelectorAll('.observation').forEach(e=>e.open=opens.has(e.id));
  const filled=$('#onlyFilled');if(filled){filled.checked=!!v.onlyFilled;editor.querySelectorAll('.observation').forEach(e=>e.hidden=filled.checked&&e.dataset.filled!=='true');}
  const search=$('#observationSearch');if(search&&v.search){search.value=v.search;search.dispatchEvent(new Event('input',{bubbles:true}));}
  if(v.nested===nested(editor)){editor.scrollTop=v.scroll;window.scrollTo(0,v.window);}else if(v.anchor){const el=document.getElementById(v.anchor);if(el&&!el.hidden)reveal(el.querySelector('summary'));}
  const roster=$('#rosterList');if(roster)roster.scrollTop=v.roster||0;
  if(focus){const field=fieldFor(v.field);if(field&&!field.disabled&&field.closest('.observation')?.hidden!==true){field.focus({preventScroll:true});if(v.selection&&typeof field.setSelectionRange==='function')try{field.setSelectionRange(...v.selection);}catch{}}}
 }finally{restoring=false;}
}
function targets(s){
 if(targetCache?.student===s&&targetCache.revision===s.revision&&targetCache.config===project.config)return targetCache.rows;
 const r=result(s),rows=[];
 for(const o of RULES.obs){
  if(['base','external'].includes(o.type))continue;
  if(['award','range','discipline'].includes(o.type)){
   for(const [i,a]of(s.awards[o.id]||[]).entries()){
    if(a.status==='不计分')continue;const d=r.details[o.id]?.[i];let key='';
    const errs=(d?.errors||[]).join('；');
    if(errs.includes('重复'))key='event';else if(errs.includes('次数'))key='count';else if(errs.includes('人数'))key='team';else if(errs.includes('比例'))key='ratio';else if(errs.includes('认定扣分'))key='approval';else if(errs.includes('审核状态'))key='status';else if(errs)key='option';
    else if(d?.missing?.length)key=E.blank(a.option)?'option':'approval';
    else if((E.blank(a.count)?1:a.count)>0&&!a.event?.trim())key='event';
    else if(a.status==='待审核')key='status';
    if(key)rows.push({id:o.id,row:i,key,token:o.id+':'+i+':'+key});
   }
  }else if(r.issues.some(i=>i.id===o.id))rows.push({id:o.id,token:o.id});
 }
 targetCache={student:s,revision:s.revision,config:project.config,rows};return rows;
}
function reveal(el){
 const editor=$('#editor');if(!el||!editor)return;
 const rect=el.getBoundingClientRect(),box=editor.getBoundingClientRect(),isNested=nested(editor),tabs=$('.entry-sticky')||$('.tabs'),visibleTop=Math.max(Math.max(0,isNested?box.top:0)+(tabs?.offsetHeight||0),tabs?.getBoundingClientRect().bottom||0)+14,visibleBottom=(isNested?Math.min(innerHeight,box.bottom):innerHeight)-14;
 if(rect.top<visibleTop||rect.bottom>visibleBottom){const delta=rect.top-visibleTop;if(isNested)editor.scrollTop+=delta;else window.scrollBy(0,delta);}
}
function goToTarget(){
 const s=current();if(!s)return;const list=targets(s);if(!list.length)return toast('活动记录已补齐，接下来可到“老师核对”查看其余事项。');
 const studentKey=scope()+':'+s.id;if(studentKey!==targetStudent){targetStudent=studentKey;lastTarget='';}
 const i=list.findIndex(t=>t.token===lastTarget),target=list[(i+1)%list.length],o=ruleMap.get(target.id);lastTarget=target.token;
 if(tab!=='activities'||dimension!==o.dim||!$('#obs-'+o.id)){remember();tab='activities';dimension=o.dim;renderEditor();}
 const obs=$('#obs-'+o.id);obs.open=true;obs.hidden=false;
 const input=target.key?fieldFor({award:o.id,row:target.row,key:target.key}):obs.querySelector('input:invalid,select:invalid')||obs.querySelector('[data-value]');
 reveal(input?.closest('label')||input||obs.querySelector('summary'));input?.focus({preventScroll:true});remember();
}
function decorate(){
 const editor=$('#editor'),s=current(),tabs=editor?.querySelector('.tabs');if(!s||!tabs)return;
 editor.dataset.entryKey=keyFor(s.id,tab,dimension);editor.dataset.entryScope=scope();editor.dataset.entryStudent=s.id;editor.dataset.entryTab=tab;editor.dataset.entryDimension=dimension;
 if(!tabs.closest('.entry-sticky')){tabs.insertAdjacentHTML('beforebegin',`<div class="entry-sticky"><div class="entry-context"><div class="entry-identity"><strong>${esc(s.name)}</strong><span title="${esc(s.id+' · '+s.group)}">${esc(s.id+' · '+s.group)}</span><small data-entry-location></small></div><div class="entry-context-actions"><span data-entry-save role="status"></span>${tab==='activities'?'<button data-entry="nextIssue" title="定位下一条待填写、需更正或待审核的活动记录"></button>':''}<button data-action="undo" title="撤销最近一次数据修改">撤销</button><button data-entry="top" title="返回当前学生页首">页首 ↑</button></div></div></div>`);tabs.previousElementSibling.append(tabs);}
 updateContext();
}
function updateContext(){
 const s=current(),bar=$('.entry-context');if(!s||!bar)return;
 const issue=bar.querySelector('[data-entry=nextIssue]');if(issue){const count=targets(s).length;issue.textContent='待处理 '+count;issue.disabled=count===0;}
 const undo=bar.querySelector('[data-action=undo]');if(undo)undo.disabled=!undoStack.length||readOnly||!!project.editLock?.locked;
 syncSave();updateLocation();
}
function updateLocation(v=capture()){const label=$('[data-entry-location]');if(!label||!v)return;const o=v.anchor?ruleMap.get(v.anchor.slice(4)):null;const text=v.tab==='activities'?v.dimension+(o&&o.dim===v.dimension?' · '+o.id+' '+o.name:''):v.tab==='required'?'填写原始成绩与班级评议':'核对材料、登记老师已核对';label.textContent=text;label.title=text;}
function syncSave(){const status=$('[data-entry-save]'),source=$('#saveState');if(status&&source){status.textContent=source.textContent;status.classList.toggle('error',source.classList.contains('error'));status.title=source.textContent;}}
function resumeBanner(){
 if(page!=='overview'||!lastView||lastView.scope!==scope()||$('.entry-resume'))return;
 const s=project.students.find(s=>s.id===lastView.student);if(!s)return;
 const o=ruleMap.get(lastView.anchor?.slice(4)),place=lastView.tab==='activities'?lastView.dimension+(o&&o.dim===lastView.dimension?' / '+o.name:''):lastView.tab==='required'?'必填成绩':'老师核对';
 $('.stats')?.insertAdjacentHTML('beforebegin',`<div class="entry-resume"><div><strong>上次录入：${esc(s.name)}</strong><span class="hint">${esc(s.id)} · ${esc(place)}　已记住展开项目和位置</span></div><button data-entry="resume">继续录入 →</button></div>`);
}
const previousRender=render;render=function(){remember();previousRender();resumeBanner();};
const previousWorkspace=renderWorkspace;renderWorkspace=function(){const roster=$('#rosterList'),top=roster?.scrollTop;remember();previousWorkspace();const next=$('#rosterList');if(next&&top!==undefined&&!views.has($('#editor')?.dataset.entryKey))next.scrollTop=top;};
const previousEditor=renderEditor;renderEditor=function(){remember();previousEditor();window.ScoreUX?.decorate();decorate();const saved=views.get($('#editor')?.dataset.entryKey);if(saved)restore(saved);};
const previousRoster=renderRoster;renderRoster=function(){const el=$('#rosterList'),top=el?.scrollTop||0;previousRoster();if(el&&el===$('#rosterList'))el.scrollTop=top;};
const previousSummary=refreshActivitySummary;refreshActivitySummary=function(s,o,el){
 previousSummary(s,o,el);
 // Cross-observation duplicate validation can change both records; keep all visible feedback in sync.
 document.querySelectorAll('.observation').forEach(obs=>{const rule=ruleMap.get(obs.id.slice(4));if(rule&&rule.id!==o.id)updateObsFeedback(s,rule,obs,false);});updateContext();
};
const previousRows=changeAwardRows;changeAwardRows=function(id,index=null){previousRows(id,index);const field=document.activeElement;if(field?.dataset.award===id||field?.dataset.addAward===id)reveal(field.closest('label')||field);remember();};
const previousCheckpoint=checkpoint;checkpoint=function(label,s=null){const prev=undoStack.at(-1);previousCheckpoint(label,s);const added=undoStack.at(-1);if(added&&added!==prev){added.entryView=capture();added.gridView=window.ScoreUX?.captureGrid();}};
const previousUndo=undoLastChange;undoLastChange=function(){
 if(!guard()||!undoStack.length)return;const prev=undoStack.at(-1),view=capture(),gridView=window.ScoreUX?.captureGrid();let restoreView=view;
 if(page==='students'&&prev.studentId&&prev.studentId!==selected){selected=prev.studentId;tab=prev.entryView?.tab||'required';dimension=prev.entryView?.dimension||dimension;restoreView=prev.entryView;}
 previousUndo();if(gridView)window.ScoreUX?.restoreGrid(gridView);ScoreWorkflow.resetEditGrouping();if(restoreView)restore(restoreView,{focus:true});updateContext();remember();
};
const previousRedo=redoLastChange;redoLastChange=function(){
 if(!guard()||!redoStack.length)return;const next=redoStack.at(-1),view=capture(),gridView=window.ScoreUX?.captureGrid();let restoreView=view;
 if(page==='students'&&next.studentId&&next.studentId!==selected){selected=next.studentId;tab=next.entryView?.tab||'required';dimension=next.entryView?.dimension||dimension;restoreView=next.entryView;}
 previousRedo();if(gridView)window.ScoreUX?.restoreGrid(gridView);ScoreWorkflow.resetEditGrouping();if(restoreView)restore(restoreView,{focus:true});updateContext();remember();
};
function scheduleRemember(){clearTimeout(rememberTimer);rememberTimer=setTimeout(remember,220);}
document.addEventListener('scroll',e=>{if(e.target===$('#editor')||e.target===document){updateLocation();scheduleRemember();}else if(e.target===$('#rosterList'))scheduleRemember();},true);
document.addEventListener('toggle',e=>{if(e.target.matches?.('.observation'))scheduleRemember();},true);
document.addEventListener('focusin',e=>{if(e.target.closest?.('.observation'))updateLocation();});
document.addEventListener('change',e=>{if(e.target.id==='onlyFilled'||e.target.id==='observationSearch')scheduleRemember();});
document.addEventListener('input',e=>{if(e.target.dataset?.award||e.target.dataset?.value||e.target.hasAttribute?.('data-professional')){updateContext();scheduleRemember();}});
document.addEventListener('click',e=>{const b=e.target.closest('[data-entry]');if(!b)return;try{
 if(b.dataset.entry==='nextIssue')goToTarget();
 if(b.dataset.entry==='top'){const editor=$('#editor');if(editor)editor.scrollTop=0;if(editor&&!nested(editor))editor.scrollIntoView({block:'start',behavior:'instant'});}
 if(b.dataset.entry==='resume'&&lastView?.scope===scope()&&project.students.some(s=>s.id===lastView.student)){const view=clone(lastView);selected=view.student;page='students';tab=view.tab;dimension=view.dimension;render();restore(view,{focus:true});}
 }catch(error){reportError(error);}});
window.addEventListener('pagehide',remember);
new MutationObserver(syncSave).observe($('#saveState'),{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
window.ScoreEntry={version:'1.3',capture,restore,remember,targets:s=>clone(targets(s)),key:SESSION_KEY};
})();
