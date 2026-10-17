/* v1.5: one entry workspace, teacher-led review, optional student acknowledgements. */
(()=>{
'use strict';
let optionalQuery='',optionalPage=0;
const beforeRender=render,beforeNav=appNav;
function updateNav(){
 beforeNav();
 const isTeacher=page==='tasks'||page==='students'&&(window.ScoreUX?.area()==='tasks');
 const isEntry=page==='gradegrid'||page==='students'&&!isTeacher;
 document.querySelector('.nav [data-page=gradegrid]')?.classList.toggle('active',isEntry);
 document.querySelector('.nav [data-page=tasks]')?.classList.toggle('active',isTeacher);
 const sub=$('#entrySubnav');sub.hidden=!isEntry&&!(page==='students'&&isTeacher);
 sub.querySelector('[data-page=gradegrid]').classList.toggle('active',page==='gradegrid');
 sub.querySelector('[data-page=students]').classList.toggle('active',page==='students');
 document.querySelector('.nav [data-simple=more]')?.classList.toggle('active',page==='studentchecks');
 shellHeight();
}
function shellHeight(){const n=['.top','.nav','#entrySubnav','#storageBanner'].reduce((n,q)=>n+($(q)?.getBoundingClientRect().height||0),0);document.documentElement.style.setProperty('--simple-shell-height',Math.ceil(n)+'px');}
appNav=updateNav;
render=function(){if(page==='studentchecks'){appNav();renderStudentChecks();}else beforeRender();window.ScoreUX?.decorate();};
const previousEditor=renderEditor;renderEditor=function(){previousEditor();updateNav();window.ScoreUX?.decorate();};
function more(){modal('其他功能 · 按需使用',`<p>日常只需“班级总览 → 数据录入 → 老师核对”。下面这些不需要每次操作。</p><div class="simple-tool-grid"><button data-simple="student-checks"><b>学生核对（可选）</b><span>需要学生确认时才登记，不影响老师核对和导出。</span></button><button data-action="settings"><b>评定规则</b><span>设置学年、年级、操作人和经确认的计分口径。</span></button><button data-ux="audit"><b>操作记录</b><span>查看最近录入和人工核对记录。</span></button><button data-action="newWorkspace"><b>新建班级</b><span>新评定周期从空名单开始，先备份现有数据。</span></button></div><p class="hint">备份、恢复、恢复点和录入锁定统一放在顶部“数据与备份”；AI 工具仍在“AI / MCP”。</p><details><summary>性能检查</summary><p class="hint">这是程序测试，不会改动当前班级。</p><button data-action="performance">检查 500 人性能</button></details>`);}
function roster(){if(!guard())return;modal('名单管理',`<p>学号是唯一标识。导入同一学号只更新姓名和班级，不会清空已录入的成绩与活动。</p><div class="simple-tool-grid"><button data-action="bulk"><b>从 Excel 导入 / 更新</b><span>复制学号、姓名、班级三列，预检后再确认。</span></button><button data-action="newStudent"><b>添加一名学生</b><span>只补一两个人时使用。</span></button></div><p class="hint">修改或删除已有学生：在班级总览点姓名，再点姓名下面的“编辑”。</p>`);}
function renderStudentChecks(){
 const q=optionalQuery.trim().toLowerCase(),students=project.students.filter(s=>!q||[s.id,s.name,s.group].some(x=>x.toLowerCase().includes(q)));
 const max=50;optionalPage=Math.min(optionalPage,Math.max(0,Math.ceil(students.length/max)-1));
 $('#app').innerHTML=`<main><div class="heading"><div><div class="eyebrow">其他功能 / 可选登记</div><h1>学生核对（可选）</h1><div class="subtle">一般由老师核对即可。只有确实需要学生确认时，才使用这个模块。</div></div><button data-page="overview">回班级总览</button></div><div class="note">不登记学生核对，也能由老师直接核对、导出结果。这里的记录仅表示录入人据实登记，不是学生在线实名签署。已有记录仍保留；修改相关数据或规则后会失效。</div><section class="panel"><div class="toolbar"><input id="optionalCheckSearch" aria-label="搜索可选学生核对" value="${esc(optionalQuery)}" placeholder="姓名 / 学号 / 班级"><button data-action="printAll">打印个人核对单（可选）</button></div><div class="table-wrap"><table><thead><tr><th>学生</th><th>班级</th><th>老师核对</th><th>学生核对（可选）</th><th>操作</th></tr></thead><tbody>${students.slice(optionalPage*max,(optionalPage+1)*max).map(s=>{const r=result(s);return `<tr><td><b>${esc(s.name)}</b><div class="hint">${esc(s.id)}</div></td><td>${esc(s.group)}</td><td>${badge(r.status)}</td><td>${r.confirmed?'已登记 · '+esc(s.confirmation.actor)+'<div class="hint">'+esc(s.confirmation.time)+'</div>':s.confirmation?'原记录已失效':'未登记（不影响老师核对）'}</td><td><button data-simple-check="${esc(s.id)}" ${!r.ready||r.confirmed||readOnly||project.editLock?.locked?'disabled':''}>登记学生已核对</button>${!r.ready?` <button data-task-student="${esc(s.id)}" data-task-locate="${esc(r.issues[0]?.id||r.work[0]?.id||'qualification')}">查看未完成事项</button>`:''}</td></tr>`;}).join('')||'<tr><td colspan="5">没有符合条件的学生。</td></tr>'}</tbody></table></div><div class="pagination"><span>共 ${students.length} 人，每页 ${max} 人</span><div><button data-simple="optional-prev" ${optionalPage===0?'disabled':''}>上一页</button><span>${optionalPage+1} / ${Math.max(1,Math.ceil(students.length/max))}</span><button data-simple="optional-next" ${(optionalPage+1)*max>=students.length?'disabled':''}>下一页</button></div></div></section></main>`;
}
const previousActivities=activitiesHTML;
activitiesHTML=function(s){return `<div class="simple-activity-tools"><div><b>活动与奖项</b><p class="hint">单人记录在下方选项目填写；多人参加同一事项，用右侧统一登记。</p></div><div class="small-actions"><button data-ux="batchActivity">多人活动登记</button><button data-action="batchAwards">多人奖项登记</button></div></div>`+previousActivities(s);};
document.addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b)return;
 try{
  if(b.hasAttribute('data-entry-activities'))tab='activities';
  if(b.dataset.simpleCheck){if(!guard())return;selected=b.dataset.simpleCheck;confirmAction(false);return;}
  switch(b.dataset.simple){
   case 'more':more();break;
   case 'roster':roster();break;
   case 'student-checks':$('#modal').close();page='studentchecks';optionalQuery='';optionalPage=0;render();break;
   case 'optional-prev':optionalPage--;renderStudentChecks();break;
   case 'optional-next':optionalPage++;renderStudentChecks();break;
  }
 }catch(err){toast(err.message);}
},true);
document.addEventListener('input',e=>{if(e.target.id!=='optionalCheckSearch')return;optionalQuery=e.target.value;optionalPage=0;const pos=e.target.selectionStart;renderStudentChecks();const input=$('#optionalCheckSearch');input.focus();input.setSelectionRange(pos,pos);});
const sizeObserver=new ResizeObserver(shellHeight);for(const q of ['.top','.nav','#entrySubnav','#storageBanner'])if($(q))sizeObserver.observe($(q));
window.ScoreSimple=Object.freeze({version:'1.5',openStudentChecks:()=>{page='studentchecks';render();}});
})();
