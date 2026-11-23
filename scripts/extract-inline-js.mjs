import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extractInlineJavaScript } from './inline-script.mjs';

const html = await readFile('index.html', 'utf8');
const source = extractInlineJavaScript(html);

await mkdir('.generated', { recursive: true });
await writeFile('.generated/inline-script.js', source);
console.log('Extracted inline JavaScript for ESLint without modifying index.html.');
