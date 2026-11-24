import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const tokenFile = 'src/design-system/_tokens.scss';
const colorLiteral = /#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\s*\(/i;
const violations = [];

function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name).replaceAll('\\', '/');
    if (entry.isDirectory()) {
      inspect(path);
    } else if (path.endsWith('.scss') && path !== tokenFile) {
      const source = readFileSync(path, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      source.split('\n').forEach((line, index) => {
        if (colorLiteral.test(line.split('//')[0])) {
          violations.push(`${path}:${index + 1}: use a design token instead of a color literal`);
        }
      });
    }
  }
}

inspect('src');
if (violations.length > 0) {
  console.error(violations.join('\n'));
  process.exitCode = 1;
}
