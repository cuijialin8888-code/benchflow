import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
const files = ['server.js', 'sw.js', ...(await readdir('src')).filter(n => n.endsWith('.js')).map(n => `src/${n}`)];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log(`Syntax checked: ${files.length} modules.`);
