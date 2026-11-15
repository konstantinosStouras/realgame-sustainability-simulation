import test from 'node:test';
import assert from 'node:assert/strict';
import { createMessageSounds } from '../src/message-sounds.mjs';

function fixture(saved = null) {
  let time = 1000, context;
  const values = new Map(saved ? [['studio-message-sounds',saved]] : []);
  const storage = {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const parameter = () => ({setValueAtTime(){},exponentialRampToValueAtTime(){}});
  class AudioContext {
    constructor() { context=this;this.state='suspended';this.currentTime=0;this.tones=[]; }
    resume(){this.state='running';return Promise.resolve();}
    suspend(){this.state='suspended';return Promise.resolve();}
    createGain(){return {gain:parameter(),connect(){},disconnect(){}};}
    createOscillator(){const tone={frequency:parameter(),connect(){},disconnect(){},start(at){this.started=at;},stop(at){this.stopped=at;}};this.tones.push(tone);return tone;}
  }
  const sounds=createMessageSounds({storage,AudioContext,now:()=>time});
  return {sounds,values,context:()=>context,advance:()=>{time+=1000;}};
}
const message=(id,senderId='other')=>({id,senderId});
test('initial history, own messages and repeated polls stay silent; a new received batch chimes once', () => {
  const f=fixture(); f.sounds.arm();
  f.sounds.observe('class-a',[message('old')],'me');assert.equal(f.context().tones.length,0);
  f.sounds.observe('class-a',[message('old'),message('own','me')],'me');assert.equal(f.context().tones.length,0);
  const incoming=[message('old'),message('own','me'),message('new'),message('another')];
  f.sounds.observe('class-a',incoming,'me');assert.equal(f.context().tones.length,2);
  f.advance();f.sounds.observe('class-a',incoming,'me');assert.equal(f.context().tones.length,2);
  f.sounds.observe('class-b',[message('different')],'me');assert.equal(f.context().tones.length,2);
  f.sounds.reset();f.sounds.observe('class-b',[message('different'),message('history')],'me');assert.equal(f.context().tones.length,2);
});
test('audio waits for interaction and never replays a queued history after unlocking', () => {
  const f=fixture();assert.equal(f.sounds.play('sent'),false);assert.equal(f.context(),undefined);
  f.sounds.observe('class-a',[],'me');f.sounds.observe('class-a',[message('before-click')],'me');
  f.sounds.arm();assert.equal(f.context().tones.length,0);
  f.sounds.observe('class-a',[message('before-click')],'me');assert.equal(f.context().tones.length,0);
  f.sounds.observe('class-a',[message('before-click'),message('after-click')],'me');assert.equal(f.context().tones.length,2);
});
test('muting persists, stops playback and does not create a backlog', () => {
  const f=fixture('off');assert.equal(f.sounds.enabled,false);f.sounds.arm();assert.equal(f.context(),undefined);
  f.sounds.observe('class-a',[],'me');f.sounds.observe('class-a',[message('muted')],'me');
  f.sounds.setEnabled(true);assert.equal(f.values.get('studio-message-sounds'),'on');
  f.sounds.observe('class-a',[message('muted')],'me');assert.equal(f.context().tones.length,0);
  assert.equal(f.sounds.play('sent'),true);assert.equal(f.context().tones.length,1);
  f.sounds.setEnabled(false);assert.equal(f.context().state,'suspended');assert.equal(f.values.get('studio-message-sounds'),'off');
  assert.equal(f.sounds.play('received'),false);
});
test('incoming bursts are bounded and unavailable audio does not affect messaging', () => {
  const f=fixture();f.sounds.arm();assert.equal(f.sounds.play('received'),true);assert.equal(f.sounds.play('received'),false);
  f.advance();assert.equal(f.sounds.play('received'),true);
  const unavailable=createMessageSounds({storage:{getItem(){throw Error();},setItem(){throw Error();}},AudioContext:class {constructor(){throw Error();}}});
  assert.doesNotThrow(()=>{unavailable.arm();unavailable.setEnabled(false);unavailable.setEnabled(true);unavailable.play('sent');});
});
