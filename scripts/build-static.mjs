import { mkdir, copyFile } from 'node:fs/promises';
// Explicit public allowlist: private research, runtime state and server files cannot enter Hosting.
const files = ['index.html', 'theme.mjs', 'theme.css', 'social-preview-v1.png', 'google-g.png', 'styles.css', 'app.mjs', 'firebase-config.mjs', 'src/engine.mjs', 'src/solo.mjs', 'src/test-client.mjs', 'src/test-worker.mjs', 'src/test-classroom.mjs', 'src/firebase-client.mjs', 'notes/model.md'];
for (const file of files) {
  const target = new URL(`../dist/${file}`, import.meta.url);
  await mkdir(new URL('.', target), { recursive: true });
  await copyFile(new URL(`../${file}`, import.meta.url), target);
}
console.log(`Prepared ${files.length} public files in dist/.`);
