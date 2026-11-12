import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const files = ['index.html', 'theme.css', 'theme.mjs', 'styles.css', 'app.mjs', 'firebase-config.mjs', 'src/engine.mjs', 'src/solo.mjs', 'src/test-client.mjs', 'src/test-worker.mjs', 'src/test-classroom.mjs', 'src/firebase-client.mjs'];
const normalize = text => text.replace(/\?v=[a-z0-9-]+/g, '').replace(/\r\n/g, '\n');
const sources = await Promise.all(files.map(file => readFile(new URL(`../${file}`, import.meta.url), 'utf8')));
const hash = createHash('sha256');
files.forEach((file, i) => hash.update(file + '\n' + normalize(sources[i])));
const version = hash.digest('hex').slice(0, 12);
let changed = false;
for (let i = 0; i < files.length; i++) {
  let output = sources[i];
  if (files[i].endsWith('.mjs')) output = output.replace(/(['"])((?:\.\/|\.\.\/)[^'"?]+\.mjs)(?:\?v=[a-z0-9-]+)?\1/g, (_, quote, path) => `${quote}${path}?v=${version}${quote}`);
  if (files[i] === 'index.html') output = output.replace(/(href="(?:styles|theme)\.css|src="(?:app|theme)\.mjs)(?:\?v=[a-z0-9-]+)?"/g, `$1?v=${version}"`);
  if (output !== sources[i]) { changed = true; if (!process.argv.includes('--check')) await writeFile(new URL(`../${files[i]}`, import.meta.url), output); }
}
if (changed && process.argv.includes('--check')) throw new Error('Browser asset version is stale. Run node scripts/version-browser.mjs before publishing.');
console.log(`Browser release ${version}${changed ? ' updated' : ' verified'}.`);
