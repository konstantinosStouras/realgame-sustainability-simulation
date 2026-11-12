import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';
// Only deploy original backend code and dependency manifests, never private/
// research, local accounts/databases, credentials, tests or environment files.
const files = ['server/cloud.mjs', 'server/session-access.mjs', 'server/cloud-http.mjs', 'server/cloud-state.mjs', 'server/firestore-store.mjs', 'src/engine.mjs', 'src/session-id.mjs', 'package-lock.json'];
for (const file of files) {
  const destination = new URL(`../.cloud-functions/${file}`, import.meta.url);
  await mkdir(new URL('.', destination), { recursive: true });
  await copyFile(new URL(`../${file}`, import.meta.url), destination);
}
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
await writeFile(new URL('../.cloud-functions/package.json', import.meta.url), JSON.stringify({ name: pkg.name, version: pkg.version, private: true, type: 'module', main: 'server/cloud.mjs', engines: { node: '22' }, dependencies: pkg.dependencies }, null, 2) + '\n');
console.log('Prepared backend deployment allowlist in .cloud-functions/.');
