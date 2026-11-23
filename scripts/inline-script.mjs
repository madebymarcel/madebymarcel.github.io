import { parse } from 'parse5';

// Parse actual HTML rather than approximating HTML tags with a regular expression.
export function extractInlineJavaScript(html) {
  const scripts = [];

  function visit(node) {
    if (node.nodeName === 'script') scripts.push(node);
    for (const child of node.childNodes ?? []) visit(child);
  }

  visit(parse(html));

  if (scripts.length !== 1) {
    throw new Error('Expected exactly one inline script in index.html.');
  }

  const [script] = scripts;
  if (script.attrs?.some((attribute) => attribute.name === 'src')) {
    throw new Error('Expected an inline script, not an external script.');
  }

  const source = (script.childNodes ?? [])
    .filter((child) => child.nodeName === '#text')
    .map((child) => child.value)
    .join('');

  if (!source.trim()) {
    throw new Error('Expected a nonempty inline script in index.html.');
  }

  return source;
}
