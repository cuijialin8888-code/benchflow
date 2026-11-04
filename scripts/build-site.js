import { mkdir, copyFile, readdir } from 'node:fs/promises';

// Copy an explicit public allowlist; no tests, backups or repository metadata.
await mkdir('dist', { recursive: true });
for (const name of ['index.html', 'styles.css', 'sw.js', 'manifest.webmanifest']) await copyFile(name, `dist/${name}`);
for (const directory of ['src', 'assets', 'examples']) {
  await mkdir(`dist/${directory}`, { recursive: true });
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isFile() && /\.(js|svg|csv)$/.test(entry.name)) await copyFile(`${directory}/${entry.name}`, `dist/${directory}/${entry.name}`);
  }
}
console.log('Static app prepared in dist/. No user data is included.');
