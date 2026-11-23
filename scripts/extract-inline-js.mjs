import { mkdir, readFile, writeFile } from 'node:fs/promises';

const html = await readFile('index.html', 'utf8');
const tags = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)];

if (tags.length !== 1 || /\bsrc\s*=/.test(tags[0][0].split('>')[0])) {
  throw new Error('Expected exactly one inline script in index.html.');
}

await mkdir('.generated', { recursive: true });
await writeFile('.generated/inline-script.js', tags[0][1]);
console.log('Extracted inline JavaScript for ESLint without modifying index.html.');
