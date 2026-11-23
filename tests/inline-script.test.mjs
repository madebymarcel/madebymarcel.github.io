import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractInlineJavaScript } from '../scripts/inline-script.mjs';

test('extracts the unchanged inline JavaScript from the real page', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const script = extractInlineJavaScript(html);

  assert.match(script, /const palette =/);
  assert.match(script, /const parallaxDepth =/);
});

test('supports valid whitespace in script tags and markup-like script contents', () => {
  const html = `<html><body>
    <script
      type="text/javascript">const message = "<tag>";</script >
  </body></html>`;

  assert.equal(extractInlineJavaScript(html), 'const message = "<tag>";');
});

test('rejects missing, duplicate and external scripts', () => {
  assert.throws(() => extractInlineJavaScript('<main>Hello</main>'), /exactly one/);
  assert.throws(
    () => extractInlineJavaScript('<script>a()</script><script>b()</script>'),
    /exactly one/,
  );
  assert.throws(() => extractInlineJavaScript('<script src="/app.js"></script>'), /inline script/);
});
