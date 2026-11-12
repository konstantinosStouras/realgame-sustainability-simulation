import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../theme.mjs',import.meta.url),'utf8');
function setup(saved, blocked=false, dialog=null) {
  const events={},win={},buttons=[];
  const system={matches:true,addEventListener:(k,f)=>win.system=f};
  const document={documentElement:{dataset:{}},querySelector:s=>s==='#dialog'?dialog:null,addEventListener:(k,f)=>events[k]=f,
    body:{prepend(){}},createElement:()=>{const b={isConnected:true,setAttribute(k,v){this[k]=v},addEventListener(k,f){this[k]=f},append(){}};buttons.push(b);return b;}};
  const storage={getItem(){if(blocked)throw Error();return saved},setItem(k,v){if(blocked)throw Error();saved=v}};
  vm.runInNewContext(source,{document,window:{matchMedia:()=>system,addEventListener:(k,f)=>win[k]=f},localStorage:storage,MutationObserver:class {constructor(f){win.mutation=f} observe(){}}});
  events.DOMContentLoaded();
  return {document,win,button:buttons[1],saved:()=>saved};
}
test('theme follows system initially, toggles repeatedly and persists explicit choice',()=>{
  const h=setup(null);
  assert.equal(h.document.documentElement.dataset.theme,'dark');
  h.button.click();assert.equal(h.saved(),'light');assert.equal(h.button['aria-label'],'Switch to dark theme');
  h.win.system({matches:true});assert.equal(h.document.documentElement.dataset.theme,'light');
  h.button.click();assert.equal(h.saved(),'dark');assert.equal(h.button['aria-pressed'],'true');
  assert.equal(setup(h.saved()).document.documentElement.dataset.theme,'dark');
});

test('dialog controls are inserted before long content, synchronize and survive dialog replacement',()=>{
  const draft={value:'321.45'}, dialog={open:true,children:[draft],querySelector(){return this.children.find(x=>x.className==='theme-toggle')},prepend(b){this.children.unshift(b)}};
  const h=setup('dark',false,dialog);
  h.win.mutation();
  const first=dialog.children[0];
  assert.equal(first.className,'theme-toggle');
  first.click();
  assert.equal(h.document.documentElement.dataset.theme,'light');
  assert.equal(h.button['aria-label'],'Switch to dark theme');
  assert.equal(dialog.children[1],draft);
  assert.equal(draft.value,'321.45');
  h.win.mutation();
  assert.equal(dialog.children.length,2);
  first.isConnected=false;dialog.children=[draft];h.win.mutation();
  assert.notEqual(dialog.children[0],first);
  assert.equal(dialog.children[0]['aria-label'],'Switch to dark theme');
  dialog.children[0].click();
  assert.equal(h.button['aria-label'],'Switch to light theme');
});
test('storage failure does not prevent toggling; other tabs synchronize',()=>{
  const h=setup(null,true);h.button.click();assert.equal(h.document.documentElement.dataset.theme,'light');
  h.win.storage({key:'studio-theme',newValue:'dark'});assert.equal(h.document.documentElement.dataset.theme,'dark');
});
