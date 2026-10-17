/* v1.6 interaction services. View preferences never change scoring configuration. */
(()=>{
'use strict';
let area='entry',reviewOrigin=false,lastGrid=null,continuous='',activeObservation='',lastReviewer='',lastWorkspace='',decorating=false;
const composing=new WeakSet();
const modalDrafts=new Map();let modalKey='',autoCheckTimer;
try{lastReviewer=localStorage.getItem('ScoreDesk.reviewer.v1')||'';}catch{}
const actor=()=>lastReviewer||project.config.operator||'';
function rememberActor(value){if(!value?.trim())return;lastReviewer=value.trim();try{localStorage.setItem('ScoreDesk.reviewer.v1',lastReviewer);}catch{}}
function captureGrid(){if(page!=='gradegrid')return null;const t=document.activeElement,v=ScoreWorkflow.view();return {...v,id:t?.dataset?.gridId||(lastGrid?.gridSection===v.gridSection&&lastGrid?.gridPage===v.gridPage?lastGrid.id:undefined),col:t?.dataset?.gridCol??lastGrid?.col,x:scrollX,y:scrollY};}
function restoreGrid(v){if(!v)return;ScoreWorkflow.restoreView(v);const el=v.id?$(`[data-grid-id="${CSS.escape(v.id)}"][data-grid-col="${v.col}"]`):null;el?.focus({preventScroll:true});window.scrollTo(v.x||0,v.y||0);}
function awardHints(s,o,index){
 if(!s||!o||index<0)return '';const a=s.awards[o.id]?.[index];if(!a||a.status==='不计分')return '';
 let text='';if(!E.blank(a.option)&&(E.blank(a.count)?1:a.count)>0&&!a.event?.trim())text+='<div class="hint award-incomplete">待补充：请填写事项名称 / 凭据编号。当前是试算，补齐后才能完成核对。</div>';
 if(a.event?.trim()){
  const event=a.event.trim(),detail=result(s).details[o.id]?.[index];
  if(detail?.errors?.some(e=>e.includes('重复')))for(const [id,list]of Object.entries(s.awards))for(const [i,other]of list.entries())if((id!==o.id||i!==index)&&(other.status||'有效')==='有效'&&other.event?.trim()===event)text+=`<button class="notice-link" data-conflict="${id}" data-conflict-row="${i}">与 ${esc(id+' '+ruleMap.get(id)?.name)} 第 ${i+1} 条重复，定位 →</button>`;
  if(/^(无|略|证书|见附件|已交|-|\d{1,4})$/.test(event))text+='<div class="hint">事项名称过于笼统，请填写具体活动、作品或凭据名称，便于去重；不要用项目名替代同一事项的统一名称。</div>';
 }
 if(o.collective&&!E.blank(a.ratio)&&a.ratio>0&&a.ratio<=.01)text+=`<div class="hint">此处单位是 %；当前填写 ${fmtRatio(a.ratio)}%，不是 ${fmtRatio(a.ratio)*100}%。请按认定比例核实。</div>`;
 return text;
}
function intervalFields(){for(const row of document.querySelectorAll('.award-row')){
 const option=row.querySelector('[data-key=option]'),approval=row.querySelector('[data-key=approval]');if(!option||!approval)continue;
 const o=ruleMap.get(option.dataset.award);if(o?.type!=='discipline')continue;
 const ranges={'警告':[30,40],'严重警告':[40,50],'记过':[50,60],'留校察看':[60,100],'治安管理处罚':[100,100]};
 for(const op of option.options){if(!ranges[op.value])continue;const [lo,hi]=ranges[op.value];op.textContent=op.value+'（'+lo+(lo===hi?'':'–'+hi)+'分）';}
 const range=ranges[option.value];approval.min=range?.[0]??0;approval.max=range?.[1]??100;approval.placeholder=range?range.join('–')+' 分':'先选处分级别';
}}
function memberPicker(textarea){
 if(textarea.dataset.picker)return;textarea.dataset.picker='1';
 const box=document.createElement('details');box.className='member-picker';box.innerHTML='<summary>按姓名 / 学号 / 班级勾选学生</summary><input type="search" placeholder="搜索姓名、学号或班级" aria-label="搜索批量登记学生"><div class="member-options"></div><p class="hint" data-member-count></p>';textarea.parentElement.before(box);
 const input=box.querySelector('input'),options=box.querySelector('.member-options');
 const selectedIds=()=>new Set(E.parseCSV(textarea.value).map(r=>r[0]));
 function draw(){const selected=selectedIds(),q=input.value.trim().toLowerCase(),rows=project.students.filter(s=>!q||[s.id,s.name,s.group].some(v=>v.toLowerCase().includes(q)));options.innerHTML=rows.slice(0,60).map(s=>`<label class="check"><input type="checkbox" value="${esc(s.id)}" ${selected.has(s.id)?'checked':''}>${esc(s.name+' / '+s.id+' / '+s.group)}</label>`).join('')||'<p>没有匹配学生</p>';box.querySelector('[data-member-count]').textContent='已选 '+selected.size+' 人；搜索匹配 '+rows.length+' 人（最多展示前 60 人，可继续搜索）。';}
 options.onchange=e=>{const ids=selectedIds();if(e.target.checked)ids.add(e.target.value);else ids.delete(e.target.value);textarea.value=[...ids].map(id=>id+'\t'+(project.students.find(s=>s.id===id)?.name||'')).join('\n');textarea.dispatchEvent(new Event('input',{bubbles:true}));draw();};input.oninput=e=>{e.stopPropagation();draw();};textarea.addEventListener('input',draw);draw();
}
function modalSnapshot(){const node=$('#modalContent');if(!modalKey||!node)return;const fields=[...node.querySelectorAll('input,select,textarea')].filter(el=>!el.closest('.member-picker')&&el.type!=='password').map((el,index)=>({id:el.id,index,value:el.value,checked:el.checked}));if(fields.length&&fields.some(f=>f.value))modalDrafts.set(modalKey,fields);while(modalDrafts.size>8)modalDrafts.delete(modalDrafts.keys().next().value);}
function restoreModalDraft(){const fields=modalDrafts.get(modalKey);if(!fields)return;for(const f of fields.filter(f=>f.id)){const el=document.getElementById(f.id);if(el?.tagName==='SELECT'){el.value=f.value;el.dispatchEvent(new Event('change',{bubbles:true}));}}
 const controls=[...$('#modalContent').querySelectorAll('input,select,textarea')].filter(el=>!el.closest('.member-picker')&&el.type!=='password');for(const f of fields){const el=f.id?document.getElementById(f.id):controls[f.index];if(!el||el.type==='file'||el.type==='checkbox')continue;el.value=f.value;el.dispatchEvent(new Event('input',{bubbles:true}));}toast('已恢复本页未提交内容；请重新检查预览后确认。');}
function modalOpened(title){
 clearTimeout(autoCheckTimer);modalKey=(project.workspaceId||project.title)+':'+title;
 if(modalDrafts.has(modalKey)&&/批量|多人/.test(title))$('#modal .modal-body').insertAdjacentHTML('afterbegin','<div class="note">本次会话有未提交的填写内容。<button data-modal-draft="restore">恢复未提交内容</button><button data-modal-draft="clear">清除草稿</button></div>');
 if($('#activityObs'))$('#activityFields').insertAdjacentHTML('afterend','<label class="check"><input id="correctBatch" type="checkbox">更正已登记的同名批次（仅允许替换原值，保留原登记历史）</label>');
 const select=$('#batchObservation')||$('#activityObs');if(select){const search=document.createElement('input');search.type='search';search.placeholder='搜索项目名称 / 维度 / 编号';search.setAttribute('aria-label','搜索批量登记项目');select.before(search);search.oninput=e=>{e.stopPropagation();const q=search.value.trim().toLowerCase();for(const op of select.options)op.hidden=!!op.value&&op.value!==select.value&&!op.textContent.toLowerCase().includes(q);};}
 for(const input of document.querySelectorAll('#actor,#awardReviewer,#qualificationActor,#lockActor'))if(!input.value)input.value=actor();
}
document.addEventListener('input',e=>{if(!e.target.closest('#modalContent')||e.target.closest('.member-picker'))return;modalSnapshot();clearTimeout(autoCheckTimer);if(!$('#bulkText')&&!$('#batchIds')&&!$('#activityIds'))return;const serial=project.serial,key=modalKey;autoCheckTimer=setTimeout(()=>{if(!$('#modal').open||key!==modalKey||serial!==project.serial)return;const text=$('#bulkText')||$('#batchIds')||$('#activityIds');if(!text?.value.trim())return;if($('#bulkText'))previewBulk();else if($('#batchOption')?.value&&$('#batchEvent')?.value.trim())$('#previewBatchAward')?.click();else if($('#activityObs')?.value&&$('#activityEvent')?.value.trim())$('#checkActivity')?.click();},250);});
document.addEventListener('click',e=>{const b=e.target.closest('[data-modal-draft]');if(!b)return;if(b.dataset.modalDraft==='restore')restoreModalDraft();else{modalDrafts.delete(modalKey);b.parentElement.remove();}});
function filledEmpty(){const list=$('.observations');const observations=[...document.querySelectorAll('.observation')];let placeholder=$('#filledEmpty');if(!observations.length){placeholder?.remove();return;}
 const empty=$('#onlyFilled')?.checked&&observations.every(o=>o.hidden);if(!empty){placeholder?.remove();return;}
 if(!placeholder){placeholder=document.createElement('div');placeholder.id='filledEmpty';placeholder.className='note';observations[0].before(placeholder);}
 placeholder.innerHTML=`本维度暂无已填写项目，已隐藏 ${observations.length} 个未填项目。<button data-ux16="show-all">显示全部项目</button>`;
}
function clearSearch(){clearTimeout(renderTimer);query='';overviewPage=rosterPage=0;ScoreWorkflow.resetSearchPages();render();}
function afterEdit(target){
 intervalFields();if(tab==='review'&&$('#reviewLive'))$('#reviewLive').innerHTML=issuesHTML([...result(current()).issues,...result(current()).work]);
 const s=current();if(s)for(const b of document.querySelectorAll('[data-dimension]')){const ids=new Set(RULES.dims.find(d=>d.name===b.dataset.dimension)?.items.map(o=>o.id)||[]),n=[...result(s).issues,...result(s).work].filter(i=>ids.has(i.id)).length;b.classList.toggle('has-work',n>0);b.title=n?'此维度有 '+n+' 项待处理':'此维度暂无待办';}
 if(target?.dataset?.award||target?.dataset?.value)filledEmpty();updateToolbar();
}
function updateToolbar(){const undo=$('#globalUndo');if(undo){undo.disabled=!undoStack.length||readOnly||!!project.editLock?.locked;undo.title=undoStack.length?'撤销：'+undoStack.at(-1).label+'（输入框内使用原生文字撤销）':'没有可撤销的操作';}}
function recentChanges(s){const rows=(project.audit||[]).filter(a=>a.student===s.id).slice(-3).reverse();return rows.length?'<div class="note"><b>近期操作（仅供辅助，不代表全部核对后变更）</b>'+rows.map(a=>'<div>'+esc(a.time+' · '+a.action)+'</div>').join('')+'</div>':'';}
function dimensionSummary(d,r){
 if(r.dimensions[d.name]===null)return '<p class="hint">此维度有缺失或异常，尚不能给出完整结果。</p>';
 let pos=d.items.filter(o=>o.sign>0).reduce((n,o)=>n+r.points[o.id],0),neg=d.items.filter(o=>o.sign<0).reduce((n,o)=>n+r.points[o.id],0),special='';
 if(d.name==='体质健康'){const ext=d.items.filter(o=>o.type==='external').reduce((n,o)=>n+r.points[o.id],0),sports=d.items.filter(o=>o.type!=='external').reduce((n,o)=>n+r.points[o.id],0);special='体育其他项目 '+fmt(sports)+' 最多计 10；';pos=ext+Math.min(10,sports);}
 if(d.name==='科学创新'&&r.overflow){pos+=r.overflow;special+='含职业转入 '+fmt(r.overflow)+'；';}
 const order=project.config.capFirst?'先按上限 '+d.max+' 封顶，再扣 '+fmt(neg):'先扣 '+fmt(neg)+'，再按上限 '+d.max+' 封顶';
 return '<p class="hint dimension-formula">'+esc(special)+(d.name==='整体扣分'?'整体扣分 '+fmt(neg)+'，在基本素质汇总后扣减。':'正向项目计分合计 '+fmt(pos)+'（含项目内部上限）；'+order+'；'+(project.config.floor?'最低 0 分；':'允许负分；')+'结果 '+fmt(r.dimensions[d.name]))+'</p>';
}
function exportSource(){let rows=$('#exportRange')?.value==='scope'?ScoreWorkflow.scoped():project.students;const order=$('#exportOrder')?.value||'default';return sortView(rows,order);}
function rangeOptions(id){const scoped=ScoreWorkflow.scoped();return `<label>范围<select id="${id}"><option value="all">全部学生（${project.students.length} 人）</option><option value="scope">当前班级 / 搜索范围（${scoped.length} 人）</option></select></label>`;}
function exportDialog(){const rs=project.students.map(result),invalid=rs.filter(r=>r.total===null).length,approved=rs.filter(r=>r.approved).length;modal('导出结果',`<div class="note"><b>导出前检查</b><br>规则：${project.config.confirmed?'已确认':'尚未确认，仅供试算'} · 可生成总分 ${rs.length-invalid}/${rs.length} 人 · 老师已核对 ${approved}/${rs.length} 人</div><div class="fields">${rangeOptions('exportRange')}<label>导出顺序<select id="exportOrder"><option value="default">原名单顺序</option><option value="id">按学号升序</option><option value="score">按总分降序（无总分排后）</option><option value="name">按姓名</option></select></label></div><div class="small-actions"><button class="primary" data-action="exportAll">全部学生 · 试算与状态</button><button data-action="exportApproved">仅老师已复核</button><button data-action="exportDetails">全部奖项明细</button><button data-action="exportLedger">全部已填项目台账</button></div><p class="hint">范围中的缺失和异常会如实保留，试算表不代表正式通过。台账包括普通项目与奖项，含内部材料信息，不作为默认公示表。</p><div class="note">CSV 只供查看和交表，不能恢复完整工作区。换电脑或继续编辑请下载 JSON 备份。CSV 不保存单元格类型，导入 Excel / WPS 时请将学号列设为文本。</div><div class="small-actions"><button data-action="backup" class="primary">下载完整 JSON 备份（换电脑 / 存档）</button><button data-action="printAll">按范围打印核对单</button></div>`);}
function exportLedger(){const rows=[['学号','姓名','班级','维度','观测点','项目','原始填报 / 奖次','次数','团队人数','比例（%）','审批认定扣分','审核状态','事项 / 登记历史','凭据说明','原始项目试算贡献（非最终增量）']];for(const s of exportSource()){const r=result(s);for(const o of RULES.obs){if(['award','range','discipline'].includes(o.type)){for(const [i,a]of(s.awards[o.id]||[]).entries())rows.push([s.id,s.name,s.group,o.dim,o.id,o.name,a.option,E.blank(a.count)?1:a.count,a.team,fmtRatio(a.ratio),a.approval,awardStateLabel(a,r.details[o.id]?.[i]),a.event,a.note,r.details[o.id]?.[i]?.value]);}else if((s.values[o.id]||[]).some(v=>!E.blank(v))){rows.push([s.id,s.name,s.group,o.dim,o.id,o.name,o.fields.map((f,i)=>f.label+'：'+(s.values[o.id]?.[i]??'未填')).join('；'),'','','','','原始输入',(s.activityLog||[]).filter(a=>a.id===o.id).map(a=>a.event+' / '+a.mode+' / '+a.values.join('/')).join('；'),'',r.points[o.id]]);}}}if(rows.length===1)return toast('当前范围没有可导出的已填项目。');download('综测_完整项目台账_'+fileTime()+'.csv',csv(rows),'text/csv;charset=utf-8');toast('已发起台账下载，项目贡献仍受维度与模块规则约束。');}
function printRange(){modal('按范围打印核对单',`${rangeOptions('printRange')}<label class="check"><input id="printApproved" type="checkbox">仅包含老师已核对学生</label><label class="check"><input id="printCheck" type="checkbox">确认为有权限的老师生成所选学生的个人核对单。</label><p>每人另起一页，可打印或另存为 PDF。</p>`,`<button data-action="closeModal">取消</button><button id="confirmPrint" class="primary">继续打印</button>`);$('#confirmPrint').onclick=()=>{if(!$('#printCheck').checked)return modalError('请先确认。');let rows=$('#printRange').value==='scope'?ScoreWorkflow.scoped():project.students;if($('#printApproved').checked)rows=rows.filter(s=>result(s).approved);if(!rows.length)return modalError('当前范围没有可打印的学生。');printSheets(rows);};}
function approveReady(){if(!guard())return;const students=ScoreWorkflow.scoped().filter(s=>result(s).ready&&!result(s).approved),serial=project.serial;if(!students.length)return toast('当前范围没有已就绪且待老师核对的学生；请先处理材料、规则和资格待办。');modal('批量老师核对 · 仅已就绪学生',`<p>当前班级 / 搜索范围共 ${students.length} 人已具备核对条件；不会自动补资格或审核奖项。</p><label>复核老师姓名<input id="readyActor" type="text" maxlength="60" value="${esc(actor())}"></label><div class="table-wrap preview"><table><thead><tr><th>选择</th><th>学生</th><th>当前总分</th></tr></thead><tbody>${students.map(s=>`<tr><td><input type="checkbox" data-ready-student="${esc(s.id)}" checked aria-label="核对 ${esc(s.name)}"></td><td>${esc(s.name+' / '+s.id+' / '+s.group)}</td><td>${fmt(result(s).total)}</td></tr>`).join('')}</tbody></table></div><label class="check"><input id="readyAttest" type="checkbox">我已逐人核对所选学生的材料、计分结果和适用规则，同意登记当前版本。</label>`,`<button data-action="closeModal">取消</button><button id="applyReady" class="primary">确认登记所选学生</button>`);$('#applyReady').onclick=()=>{if(!guard())return;const name=$('#readyActor').value.trim(),ids=[...document.querySelectorAll('[data-ready-student]:checked')].map(el=>el.dataset.readyStudent);if(!name||!ids.length||!$('#readyAttest').checked)return modalError('请填写复核老师、选择学生并确认人工核对。');if(project.serial!==serial)return modalError('数据已变化，请重新打开核对预览。');const selected=students.filter(s=>ids.includes(s.id));if(selected.some(s=>!result(s).ready||result(s).approved))return modalError('学生状态变化，请重新检查。');rememberActor(name);mutate('批量老师核对 / '+name+' / '+selected.length+'人',()=>{for(const s of selected)s.approval={revision:s.revision,rules:JSON.stringify(project.config),actor:name,time:stamp()};},{all:true,student:null});$('#modal').close();};}
function decorate(){
 if(decorating)return;decorating=true;try{
  if(lastWorkspace!==project.workspaceId){lastWorkspace=project.workspaceId;continuous='';reviewOrigin=false;}
  updateToolbar();intervalFields();filledEmpty();
  for(const input of document.querySelectorAll('#search,#uxSearch')){input.classList.toggle('filtered',!!query);if(!input.nextElementSibling?.matches('[data-ux16=clear-search]'))input.insertAdjacentHTML('afterend','<button class="plain compact" data-ux16="clear-search" title="清除搜索，保留当前学生">清除搜索</button>');}
  const sub=$('#entrySubnav');if(sub){let back=$('#reviewReturn');if(!back){sub.insertAdjacentHTML('beforeend','<div id="reviewReturn" hidden><button data-ux16="back-tasks">← 返回老师核对列表</button><span class="hint">处理完成后返回原分类和页码；筛选范围保持不变。</span></div>');back=$('#reviewReturn');}const reviewing=page==='students'&&reviewOrigin;back.hidden=!reviewing;for(const el of [...sub.children].filter(e=>e.id!=='reviewReturn'))el.hidden=reviewing;}
  if(page==='students'&&current()){
   const s=current(),r=result(s);
   for(const o of RULES.obs){const el=$('#obs-'+o.id);if(el){updateObsFeedback(s,o,el,false);const logs=(s.activityLog||[]).filter(a=>a.id===o.id);if(logs.length&&!el.querySelector('.batch-history'))el.querySelector('.obs-body')?.insertAdjacentHTML('beforeend',`<details class="batch-history"><summary>批次登记历史 ${logs.length} 条（不等于当前值之和）</summary>${logs.slice(-8).reverse().map(a=>`<p class="hint">${esc(a.event+' · '+(a.mode==='add'?'当时追加':'当时替换')+' · '+a.values.join(' / ')+' · '+a.time)}</p>`).join('')}<button data-correct-activity="${o.id}">更正此项目登记（保留历史）</button></details>`);}}
   for(const context of document.querySelectorAll('.automation-context')){const tools=context.closest('.observation')?.querySelector('.ux-obs-tools'),button=context.querySelector('[data-ai-observation]');if(tools&&button){button.textContent='AI 辅助';tools.append(button);context.remove();}}
   for(const b of document.querySelectorAll('[data-dimension]')){const d=RULES.dims.find(d=>d.name===b.dataset.dimension);if(!d)continue;const ids=new Set(d.items.map(o=>o.id)),n=[...r.issues,...r.work].filter(i=>ids.has(i.id)).length;b.classList.toggle('has-work',n>0);b.title=n?'此维度有 '+n+' 项待处理':'此维度暂无待办';}
   const selector=$('.dimension-nav');if(selector&&!$('[data-ux16=filled-summary]'))selector.insertAdjacentHTML('beforebegin','<div class="small-actions"><button data-ux16="filled-summary">本人已填项目汇总</button><button data-ux16="continuous">'+(continuous?'停止连续录入':'连续录入当前项目')+'</button></div>');
   if(continuous&&tab==='activities'){const el=$('#obs-'+continuous);if(el){el.hidden=false;el.open=true;}}
   for(const row of document.querySelectorAll('.award-row')){const input=row.querySelector('[data-award]');if(input&&ruleMap.get(input.dataset.award)?.type!=='discipline'&&!row.querySelector('[data-ux16=move-award]'))row.querySelector('[data-delete-award]')?.insertAdjacentHTML('beforebegin',`<button class="plain" data-ux16="move-award" data-obs="${input.dataset.award}" data-row="${input.dataset.row}">移至其他项目</button>`);}
  }
 }finally{decorating=false;}
}
function filledSummary(){const s=current(),r=result(s),rows=RULES.obs.filter(o=>(s.values[o.id]||[]).some(v=>!E.blank(v))||(s.awards[o.id]||[]).length);modal(esc(s.name)+' · 已填项目汇总',`<p>共 ${rows.length} 个项目；这是原始项目试算贡献，维度封顶与转入请查看计算过程。</p><div class="table-wrap"><table><thead><tr><th>维度 / 项目</th><th>输入 / 状态</th><th>项目试算</th><th>操作</th></tr></thead><tbody>${rows.map(o=>`<tr><td>${esc(o.dim+' / '+o.id+' '+o.name)}</td><td>${esc(['award','range','discipline'].includes(o.type)?(s.awards[o.id]||[]).map(a=>(a.option||'待选')+' / '+a.status+' / '+(a.event||'事项待填')).join('；'):o.fields.map((f,i)=>f.label+'：'+(s.values[o.id]?.[i]??'未填')).join('；'))}</td><td>${fmt(r.points[o.id])}</td><td><button data-summary-locate="${o.id}">定位</button></td></tr>`).join('')}</tbody></table></div>`);}
function moveAward(oId,index){
 if(!guard())return;const s=current(),original=s.awards[oId]?.[index];if(!original)return;
 const source=ruleMap.get(oId);if(source.type==='discipline')return;const serial=project.serial;modal('移动奖项 · 先核对目标规则',`<p>保留事项、凭据和次数；目标不支持的团队、比例及审批值将清空。不同项目分值可能不同，移动后为“待审核”。</p><label>目标项目<select id="moveTarget">${chooseOptions(RULES.obs.filter(o=>o.id!==oId&&['award','range'].includes(o.type)&&o.sign===source.sign).map(o=>[o.id,o.id+' '+o.dim+' / '+o.name]),'')}</select></label><div id="movePreview"></div><label class="check"><input id="moveConfirmed" type="checkbox">我已核对目标项目、奖次及团队限制，确认移动。</label>`,`<button data-action="closeModal">取消</button><button id="moveApply" class="primary" disabled>确认移动</button>`);
 $('#moveTarget').onchange=()=>{const o=ruleMap.get($('#moveTarget').value);$('#moveConfirmed').checked=false;$('#moveApply').disabled=!o;$('#movePreview').textContent=o?'目标：'+ruleHint(o)+'；奖次 '+(o.options.some(([v])=>String(v)===String(original.option))?'可以保留':'不兼容，移动后需重新选择'):'';};
 $('#moveApply').onclick=()=>{if(!guard())return;if(serial!==project.serial)return modalError('数据已变化，请重新打开移动预览。');if(!$('#moveConfirmed').checked)return modalError('请先核对并勾选确认。');const o=ruleMap.get($('#moveTarget').value);if(!o)return;const a=clone(original);if(!o.options.some(([v])=>String(v)===String(a.option)))a.option='';if(!o.team){delete a.team;delete a.ratio;}else if((a.team||1)>o.team)return modalError('原团队人数超过目标上限，请先核实人数。');if(!o.collective)delete a.ratio;delete a.approval;a.status='待审核';if((s.awards[o.id]?.length||0)>=1000)return modalError('目标项目记录已达上限。');mutate('移动奖项 '+oId+' → '+o.id,()=>{s.awards[oId].splice(index,1);(s.awards[o.id]??=[]).push(a);},{refresh:false});$('#modal').close();locate(o.id);renderRoster();};
}
document.addEventListener('compositionstart',e=>composing.add(e.target),true);
document.addEventListener('focusin',e=>{if(e.target.dataset?.gridId)lastGrid={...ScoreWorkflow.view(),id:e.target.dataset.gridId,col:e.target.dataset.gridCol};const o=e.target.closest('.observation');if(o)activeObservation=o.id.slice(4);});
document.addEventListener('click',e=>{const o=e.target.closest('.observation');if(o)activeObservation=o.id.slice(4);},true);
document.addEventListener('compositionend',e=>{composing.delete(e.target);e.target.dispatchEvent(new Event('input',{bubbles:true}));},true);
for(const name of ['input','change'])document.addEventListener(name,e=>{if(e.isComposing||composing.has(e.target))e.stopImmediatePropagation();},true);
document.addEventListener('wheel',e=>{const t=e.target;if(t!==document.activeElement||!t.matches('input[type=number]'))return;e.preventDefault();let parent=t.parentElement;while(parent&&!(getComputedStyle(parent).overflowY==='auto'&&parent.scrollHeight>parent.clientHeight))parent=parent.parentElement;if(parent)parent.scrollBy(e.deltaX,e.deltaY);else window.scrollBy(e.deltaX,e.deltaY);},{passive:false});
document.addEventListener('keydown',e=>{if(e.isComposing)return;if(e.key==='Escape'&&e.target.matches('#search,#uxSearch')){e.preventDefault();clearSearch();return;}if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='z'&&!e.target.closest('input,textarea,[contenteditable=true]')&&!$('#modal').open&&!$('#automationDialog')?.open){e.preventDefault();undoLastChange();}},true);
document.addEventListener('click',e=>{const b=e.target.closest('button,[data-student],.brand');if(!b)return;
 if(b.dataset.page){area=b.dataset.page==='tasks'?'tasks':'entry';reviewOrigin=false;}
 if(b.dataset.student){area='entry';reviewOrigin=false;}
 if(b.dataset.taskStudent&&page==='tasks'){area='tasks';reviewOrigin=true;}
 if(b.dataset.conflict){e.preventDefault();e.stopImmediatePropagation();locate(b.dataset.conflict);const el=$(`[data-award="${b.dataset.conflict}"][data-row="${b.dataset.conflictRow}"][data-key=event]`);el?.focus();return;}
 if(b.dataset.summaryLocate){$('#modal').close();locate(b.dataset.summaryLocate);return;}
 if(b.dataset.reviewLocate){$('#modal').close();if(page==='tasks'){area='tasks';reviewOrigin=true;}ScoreWorkflow.openStudent(b.dataset.reviewLocate,b.dataset.reviewObs);return;}
 if(b.dataset.correctActivity){const s=current(),o=ruleMap.get(b.dataset.correctActivity),log=(s.activityLog||[]).filter(a=>a.id===o.id).at(-1);ScoreWorkflow.batchActivity();$('#activityObs').value=o.id;$('#activityObs').dispatchEvent(new Event('change',{bubbles:true}));$('#activityEvent').value=log?.event||'';$('#activityIds').value=s.id+'\t'+s.name;if($('#activityMode'))$('#activityMode').value='replace';$('#correctBatch').checked=true;for(const el of document.querySelectorAll('[data-activity-field]'))el.value=s.values[o.id]?.[Number(el.dataset.activityField)]??'';return;}
 if(!b.dataset.ux16)return;e.preventDefault();e.stopImmediatePropagation();
 try{switch(b.dataset.ux16){
 case 'global-undo':undoLastChange();break;
 case 'approve-ready':approveReady();break;
 case 'review-ai-awards':$('#automationDialog')?.close();area='tasks';reviewOrigin=false;page='tasks';render();break;
 case 'clear-search':clearSearch();break;
 case 'back-tasks':reviewOrigin=false;page='tasks';render();break;
 case 'show-all':$('#onlyFilled').checked=false;$('#onlyFilled').dispatchEvent(new Event('change',{bubbles:true}));filledEmpty();break;
 case 'filled-summary':filledSummary();break;
 case 'continuous':if(continuous){continuous='';b.textContent='连续录入当前项目';toast('已停止连续录入。');break;}continuous=ruleMap.get(activeObservation)?.dim===dimension?activeObservation:ScoreEntry.capture()?.anchor?.slice(4)||'';if(!continuous)return toast('请先展开并点击需要连续录入的项目。');b.textContent='停止连续录入';toast('已开启连续录入：'+continuous+'。切换学生时保持此项目展开，不改变筛选范围。');break;
 case 'move-award':moveAward(b.dataset.obs,Number(b.dataset.row));break;
 }}catch(err){reportError(err);}
},true);
document.addEventListener('change',e=>{if(e.target.id==='onlyFilled')filledEmpty();});
window.ScoreUX={version:'1.6',decorate,afterEdit,awardHints,updateToolbar,captureGrid,restoreGrid,actor,rememberActor,memberPicker,modalOpened,exportDialog,exportSource,exportLedger,printRange,recentChanges,dimensionSummary,area:()=>area,reviewOrigin:()=>reviewOrigin,scopeRows:()=>sortView(ScoreWorkflow.scoped())};
})();
