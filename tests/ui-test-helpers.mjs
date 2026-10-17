// Existing feature tests use the simplified v1.5 navigation rather than removed shortcuts.
export async function action(p,name){
 const selector='[data-action="'+name+'"]';
 let button=p.locator(selector+':visible').first();if(await button.count()){await button.click();return;}
 if(await p.locator('#modal').evaluate(d=>d.open))await p.locator('#modal [data-action=closeModal]').first().click();
 if(['bulk','newStudent'].includes(name)){
  const previousPage=await p.evaluate(()=>page);
  await p.locator('.nav [data-page=overview]').click();await p.locator('[data-simple=roster]').first().click();
  if(await p.evaluate(()=>readOnly||ScoreStorage.status().locked)){const nav=p.locator('.nav [data-page="'+previousPage+'"]');if(await nav.count())await nav.click();return;}
 }else if(name==='grades')await p.locator('.nav [data-page=gradegrid]').click();
 else if(name==='batchAwards'){
  await p.locator('.nav [data-page=gradegrid]').click();await p.locator('[data-entry-activities]').click();
 }else if(['settings','newWorkspace','performance'].includes(name))await p.locator('.nav [data-simple=more]').click();
 else if(['backup','restore'].includes(name))await p.locator('#storageCenter').click();
 button=p.locator(selector+':visible').first();await button.click();
 if(name==='backup'&&await p.locator('#modal').evaluate(d=>d.open))await p.locator('#modal [data-action=closeModal]').first().click();
}
export async function ux(p,name){
 let button=p.locator('[data-ux="'+name+'"]:visible').first();
 if(!await button.count()){
  if(await p.locator('#modal').evaluate(d=>d.open))await p.locator('#modal [data-action=closeModal]').first().click();
  if(name==='batchActivity'){await p.locator('.nav [data-page=gradegrid]').click();await p.locator('[data-entry-activities]').click();}
  else if(['qualifyMany','reviewAwards'].includes(name))await p.locator('.nav [data-page=tasks]').click();
  else if(name==='audit')await p.locator('.nav [data-simple=more]').click();
 }
 await p.locator('[data-ux="'+name+'"]:visible').first().click();
}
