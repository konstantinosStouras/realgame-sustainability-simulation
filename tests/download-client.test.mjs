import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../app.mjs', import.meta.url), 'utf8');
function harness(failClick = false) {
  const blobs = [], revoked = [], links = [], handlers = {};
  const context = vm.createContext({ Blob, addEventListener: (event, fn) => handlers[event] = fn,
    URL: { createObjectURL(blob) { blobs.push(blob); return 'blob:mock-' + blobs.length; }, revokeObjectURL: url => revoked.push(url) },
    document: { body: { append(link) { link.connected = true; } }, createElement(tag) {
      assert.equal(tag, 'a');
      const link = { click() { assert.equal(this.connected, true); if (failClick) throw new Error('blocked'); this.clicked = true; }, remove() { this.connected = false; } };
      links.push(link); return link;
    } }, setTimeout() { throw new Error('Downloads must not be revoked on a timer'); } });
  vm.runInContext(source.slice(source.indexOf('const downloadSources'), source.indexOf('function csv(')), context);
  return { context, blobs, revoked, links, handlers, run: code => vm.runInContext(code, context) };
}
test('JSON export uses a connected named link and retains complete bytes until page exit', async () => {
  const h = harness();
  h.run(`download('session-example.json', {complete:true, label:'Unicode €'});`);
  assert.equal(h.links[0].download, 'session-example.json'); assert.equal(h.links[0].clicked, true);
  assert.equal(h.blobs[0].type, 'application/json');
  assert.deepEqual(JSON.parse(await h.blobs[0].text()), {complete:true,label:'Unicode €'});
  assert.deepEqual(h.revoked, []);
  h.handlers.pagehide({persisted:true}); assert.deepEqual(h.revoked, []);
  h.handlers.pagehide({persisted:false}); assert.deepEqual(h.revoked, ['blob:mock-1']);
});
test('failed download initiation releases resources and propagates the error', () => {
  const h = harness(true);
  assert.throws(() => h.run(`download('example.json', {});`), /blocked/);
  assert.deepEqual(h.revoked, ['blob:mock-1']); assert.equal(h.links[0].connected, false);
});
test('session export waits for one authenticated response and never downloads on API failure', async () => {
  const h = harness(); let resolve;
  h.context.api = () => new Promise(r => resolve = r); h.context.toast = () => {};
  const start = source.indexOf("  if (name === 'session-export') {");
  const end = source.indexOf("  if (name === 'open-session'", start);
  h.run('async function exportAction(name,id) {' + source.slice(start,end) + '}');
  const pending = h.run("exportAction('session-export','example')");
  assert.equal(h.links.length,0); resolve({complete:true}); await pending;
  assert.equal(h.links.length,1); assert.equal(h.links[0].download,'session-example.json');
  h.context.api = async () => { throw new Error('Unauthorized'); };
  await assert.rejects(h.run("exportAction('session-export','example')"), /Unauthorized/);
  assert.equal(h.links.length,1);
});
