import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractInlineJavaScript } from '../scripts/inline-script.mjs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('portfolio remains a self-contained static page', () => {
  assert.match(html, /^<!doctype html>/i);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<svg\b/);
  assert.match(extractInlineJavaScript(html), /const palette =/);
});

test('page exposes semantic content and a keyboard-accessible theme switch', () => {
  assert.match(html, /<main\b/);
  assert.match(html, /id="theme-toggle"/);
  assert.match(html, /role="switch"/);
  assert.match(html, /aria-checked="false"/);
});

test('parallax behavior and color palettes stay in the original page', () => {
  assert.match(html, /const palette\s*=/);
  assert.match(html, /const parallaxDepth\s*=/);
  assert.match(html, /prefers-reduced-motion/);
});
