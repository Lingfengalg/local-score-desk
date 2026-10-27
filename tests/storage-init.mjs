import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {testHtml,browserOptions} from './qa-paths.mjs';

const require=createRequire(import.meta.url),{chromium}=require('playwright');
const browser=await chromium.launch(browserOptions);
const context=await browser.newContext({acceptDownloads:true});
const url=pathToFileURL(testHtml()).href;
let page=await context.newPage(),baseline;
async function test(name,fn){await fn();console.log('PASS '+name);}
const faults=[];
try{
 await page.goto(url);await page.waitForFunction(()=>ScoreApp.ready());
 await page.locator('[data-action=demo]').click();await page.evaluate(()=>ScoreApp.settled());
 baseline=await page.evaluate(()=>ScoreApp.getProject());await page.close();
 page=await context.newPage();page.on('pageerror',e=>faults.push(e.message));
 await page.addInitScript(()=>{
  const get=IDBObjectStore.prototype.get,put=IDBObjectStore.prototype.put;
  window.__metadataWrites=0;
  IDBObjectStore.prototype.get=function(key){if(key==='saveInfo')throw new DOMException('Simulated metadata read failure','SecurityError');return get.call(this,key);};
  IDBObjectStore.prototype.put=function(...args){window.__metadataWrites++;return put.apply(this,args);};
 });
 await page.goto(url);await page.waitForFunction(()=>window.ScoreStorage?.status().initError);
 await page.evaluate(()=>ScoreApp.start());
 await test('保存元数据读取失败时保留已读取班级并阻止编辑',async()=>{
  const state=await page.evaluate(()=>({access:ScoreAccess.state(),storage:ScoreStorage.status(),data:ScoreApp.getProject()}));
  assert.ok(state.storage.initError.includes('metadata read failure'));assert.equal(state.access.editable,false);
  assert.equal(state.data.students.length,baseline.students.length);assert.equal(state.data.serial,baseline.serial);
  await page.locator('.nav [data-page=gradegrid]').click();assert.equal(await page.locator('[data-grid-id]').first().isDisabled(),true);
 });
 await test('初始化失败不能借保存或新建入口覆盖现有数据',async()=>{
  assert.equal(await page.evaluate(()=>ScoreStorage.save()),false);
  await page.locator('.nav [data-simple=more]').click();await page.locator('[data-action=newWorkspace]').click();
  assert.equal(await page.locator('#newTitle').count(),0);
  assert.equal(await page.evaluate(()=>window.__metadataWrites),0);
  assert.equal(await page.evaluate(async()=>JSON.stringify(await readStore('workspace','current'))),JSON.stringify(baseline));
 });
 await test('初始化失败仍可下载已读取内容的完整备份',async()=>{
  if(await page.locator('#modal').evaluate(el=>el.open))await page.locator('#modal [data-action=closeModal]').first().click();
  await page.locator('#storageCenter').click();const pending=page.waitForEvent('download');
  await page.locator('#modal [data-action=backup]').click();const download=await pending;
  const data=JSON.parse(await fs.readFile(await download.path(),'utf8'));
  assert.equal(data.serial,baseline.serial);assert.deepEqual(data.students,baseline.students);
 });
 await page.close();page=await context.newPage();page.on('pageerror',e=>faults.push(e.message));
 await test('重新打开正常窗口恢复编辑且原始数据未变',async()=>{
  await page.goto(url);await page.waitForFunction(()=>ScoreApp.ready());
  assert.equal(await page.evaluate(()=>ScoreAccess.state().editable),true);
  assert.deepEqual(await page.evaluate(()=>ScoreApp.getProject()),baseline);
  assert.deepEqual(faults,[]);
 });
}finally{await context.close();await browser.close();}
