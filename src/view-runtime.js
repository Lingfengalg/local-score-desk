/* Fixed view pipeline. Rendering never changes scores or schedules persistence. */
(()=>{
'use strict';
const regionNames=new Set(['app','overview','overviewTable','workspace','editor','roster','grid','tasks','studentchecks']);
const pageNames=new Set(['overview','students','tasks','gradegrid','studentchecks']);
const serviceNames=new Set(['workflow','entry','simple','workbench','storage']);
const renderers=new Map(),pages=new Map(),services=new Map(),calls=Object.create(null);
let context=null,total=0,outer=0,uxDecorations=0,beforeViews=0,afterViews=0;
function define(region,fn){
 if(!regionNames.has(region)||typeof fn!=='function')throw Error('Unknown view region: '+region);
 if(renderers.has(region))throw Error('View region already defined: '+region);
 renderers.set(region,fn);
}
function page(name,fn){
 if(!pageNames.has(name)||typeof fn!=='function')throw Error('Unknown view page: '+name);
 if(pages.has(name))throw Error('View page already defined: '+name);
 pages.set(name,fn);
}
function provide(name,value){
 if(!serviceNames.has(name)||!value||typeof value!=='object')throw Error('Unknown view service: '+name);
 if(services.has(name))throw Error('View service already provided: '+name);
 services.set(name,Object.freeze(value));
}
const service=name=>services.get(name);
function route(name){const fn=pages.get(name);if(!fn)return false;fn();return true;}
function decorateRegion(region,args){
 const workflow=service('workflow');
 switch(region){
  case 'overview':workflow?.decorateOverview?.(...args);break;
  case 'overviewTable':workflow?.decorateOverviewTable?.(...args);break;
  case 'workspace':workflow?.decorateWorkspace?.(...args);break;
  case 'editor':workflow?.decorateEditor?.(...args);break;
 }
}
function finish(frame){
 const simple=service('simple'),entry=service('entry');
 if(frame.regions.has('editor'))simple?.decorateEditor?.();
 simple?.nav?.();
 if(window.ScoreUX?.decorate){window.ScoreUX.decorate();uxDecorations++;}
 service('workbench')?.decorate?.(frame.region);
 if(frame.regions.has('editor'))entry?.decorate?.();
 service('storage')?.updateUI?.({protect:false});
 window.ScoreAccess?.protect?.();
 if(entry?.afterView){entry.afterView(frame.token,frame.region);afterViews++;}
}
function render(region,...args){
 const fn=renderers.get(region);if(!fn)throw Error('View region not defined: '+region);
 const isOuter=!context;
 if(isOuter){
  const entry=service('entry');
  context={region,regions:new Set(),token:entry?.beforeView?.(region)};
  if(entry?.beforeView)beforeViews++;
  outer++;
 }
 const frame=context;frame.regions.add(region);calls[region]=(calls[region]||0)+1;total++;
 try{
  if(region==='app')service('workflow')?.prepare?.();
  const value=fn(...args);decorateRegion(region,args);
  if(isOuter)finish(frame);
  return value;
 }finally{if(isOuter)context=null;}
}
function inspect(){return Object.freeze({regions:renderers.size,pages:pages.size,services:services.size,renders:total,outerRenders:outer,uxDecorations,beforeViews,afterViews,rendering:!!context,regionRenders:Object.freeze({...calls})});}
window.ScoreViews=Object.freeze({define,render,page,route,provide,service,inspect});
})();
