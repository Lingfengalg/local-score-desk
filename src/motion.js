/* Small, bounded visual feedback. Never changes data, DOM ownership, scroll or focus. */
(()=>{
'use strict';
const preference=matchMedia('(prefers-reduced-motion: reduce)'),running=new Set(),perNode=new WeakMap(),summaries=new WeakMap();
const counts={navigation:0,record:0,score:0,save:0,details:0};
let saveWasBusy=false,navigationFrame=0,scoreFrame=0;
function visible(el){if(!el?.isConnected||el.closest('[hidden]'))return false;const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.bottom>0&&r.top<innerHeight;}
function play(el,frames,duration=180){
 if(preference.matches||document.hidden||!visible(el)||typeof el.animate!=='function')return false;
 perNode.get(el)?.cancel();
 if(running.size>=8){const oldest=running.values().next().value;oldest.cancel();running.delete(oldest);}
 const animation=el.animate(frames,{duration,easing:'cubic-bezier(.2,0,0,1)',fill:'none'});
 perNode.set(el,animation);running.add(animation);
 const clean=()=>{running.delete(animation);if(perNode.get(el)===animation)perNode.delete(el);};
 animation.finished.then(clean,clean);return true;
}
function stop(){for(const a of [...running])a.cancel();running.clear();}
preference.addEventListener('change',()=>{if(preference.matches)stop();});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
document.addEventListener('click',event=>{
 const summary=event.target.closest('summary');if(summary)summaries.set(summary.parentElement,performance.now());
 const button=event.target.closest('button,[data-student]');if(!button)return;
 const oldMain=$('#app')?.firstElementChild,oldBody=$('#tabBody');
 const add=button.dataset.addAward,oldRows=add?$('#obs-'+add)?.querySelectorAll('.award-row').length:0;
 const navigation=button.hasAttribute('data-page')||button.hasAttribute('data-tab')||button.hasAttribute('data-student')||button.hasAttribute('data-task-student')||button.hasAttribute('data-dimension')||button.hasAttribute('data-grid-section')||button.hasAttribute('data-activity-module')||button.hasAttribute('data-ux-pager')||['nextStudent','toActivities','toReview','prevTable','nextTable'].includes(button.dataset.action)||['student-checks','optional-prev','optional-next'].includes(button.dataset.simple)||['previousStudent','nextProblem'].includes(button.dataset.ux);
 if(!add&&!navigation)return;
 cancelAnimationFrame(navigationFrame);navigationFrame=requestAnimationFrame(()=>{
  if(add){const rows=$('#obs-'+add)?.querySelectorAll('.award-row');if(rows?.length===oldRows+1&&play(rows[rows.length-1],[{opacity:.35},{opacity:1}],200))counts.record++;return;}
  if(!navigation)return;
  const nextMain=$('#app')?.firstElementChild,nextBody=$('#tabBody');
  const target=oldMain!==nextMain?nextMain:oldBody!==nextBody?nextBody:null;
  if(target&&play(target,[{opacity:.65},{opacity:1}],170))counts.navigation++;
 });
},true);
document.addEventListener('toggle',event=>{
 const details=event.target,time=summaries.get(details);
 if(!details.open||time===undefined||performance.now()-time>700)return;
 summaries.delete(details);
 const content=details.querySelector(':scope>.obs-body,:scope>.split,:scope>label,:scope>p');
 if(content&&play(content,[{opacity:.4},{opacity:1}],180))counts.details++;
},true);
function scoreFeedback(event){
 const t=event.target;if(!t.matches?.('[data-professional],[data-value],[data-award],[data-grid-id]'))return;
 const row=t.closest('tr'),old=row?.querySelector('[data-grid-total]')?.textContent||$('#scoreStrip .total b')?.textContent;
 cancelAnimationFrame(scoreFrame);scoreFrame=requestAnimationFrame(()=>{
  const score=row?.isConnected?row.querySelector('[data-grid-total]'):$('#scoreStrip .total b');
  if(!score||score.textContent===old)return;
  if(play(score,[{opacity:.3},{opacity:1}],200))counts.score++;
 });
}
document.addEventListener('input',scoreFeedback,true);document.addEventListener('change',scoreFeedback,true);
const state=$('#saveState');
if(state)new MutationObserver(()=>{
 const value=state.textContent;
 if(state.classList.contains('error')){saveWasBusy=false;return;}
 if(/正在|有改动/.test(value)){saveWasBusy=true;return;}
 if(saveWasBusy&&value.includes('已保存')){saveWasBusy=false;if(play(state,[{opacity:.4},{opacity:1}],260))counts.save++;}
}).observe(state,{childList:true,subtree:true,characterData:true});
// No persisted preference or data fields: animations are purely presentational.
window.ScoreMotion=Object.freeze({version:'1.5.1',status:()=>({reduced:preference.matches,active:running.size,counts:{...counts}})});
})();
