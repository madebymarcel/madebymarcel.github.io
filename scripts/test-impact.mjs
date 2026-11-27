import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const smoke = ['route-smoke.spec.js', 'site.spec.js'];
const featureTests = {
  home: [
    'home-water.spec.js',
    'accessibility.spec.js',
    'browser-baseline.spec.js',
    'navigation.spec.js',
    'theme-preferences.spec.js',
    'usability-regression.spec.js',
  ],
  about: ['navigation.spec.js', 'usability-regression.spec.js'],
  experience: [],
  contact: [],
  'not-found': ['navigation.spec.js'],
  projects: [
    'biped.spec.js',
    't-rex.spec.js',
    'accessibility.spec.js',
    'usability-regression.spec.js',
  ],
  'canoe-polo': [
    'canoe-polo.spec.js',
    'canoe-polo-manual.spec.js',
    'canoe-polo-picker.spec.js',
    'canoe-polo-scroll.spec.js',
    'canoe-polo-vision.spec.js',
  ],
  biped: ['biped.spec.js'],
  't-rex': ['t-rex.spec.js', 'accessibility.spec.js'],
  lab: ['design-system.spec.js', 'layout-catalogue.spec.js', 'accessibility.spec.js'],
};
const featureScripts = {
  'scripts/biped-experiment.mjs': 'biped',
  'scripts/canoe-polo-experiment.mjs': 'canoe-polo',
  'scripts/rex-locomotion.mjs': 't-rex',
  'scripts/rex-spatial-experiment.mjs': 't-rex',
  'scripts/rex-spatial-refine.mjs': 't-rex',
  'scripts/rex-spatial-stand.mjs': 't-rex',
  'scripts/rex-spatial.test.mjs': 't-rex',
};
const prefix = 'src/app/features/';
const testPath = (name) => 'tests/' + name;
const knownSpecs = new Set([...smoke, ...Object.values(featureTests).flat()].map(testPath));
const full = (reason) => ({ mode: 'full', files: [], lighthouse: true, reason });

function featureOf(path) {
  return path.startsWith(prefix) ? path.slice(prefix.length).split('/')[0] : undefined;
}

function isDocs(path) {
  return path === 'README.md' || (path.startsWith('docs/') && path.endsWith('.md'));
}

// A deliberate allowlist: new paths or new browser suites must be reviewed before they can be skipped.
export function selectImpact(changes, specs, isolationIssue) {
  if (!changes?.length) return full('No reliable nonempty change set');
  if (isolationIssue) return full(isolationIssue);
  if (specs.some((path) => !knownSpecs.has(path)) || specs.length !== knownSpecs.size) {
    return full('Browser test inventory changed; update the impact map');
  }
  const files = new Set(smoke.map(testPath));
  let lighthouse = false;
  let docsOnly = true;
  for (const path of changes) {
    if (isDocs(path)) continue;
    docsOnly = false;
    const feature = featureOf(path) ?? featureScripts[path];
    if (feature && Object.hasOwn(featureTests, feature)) {
      for (const spec of featureTests[feature]) files.add(testPath(spec));
      if (feature === 'home') lighthouse = true;
    } else if (knownSpecs.has(path)) {
      files.add(path);
    } else {
      return full('Shared or unmapped change: ' + path);
    }
  }
  return {
    mode: docsOnly ? 'smoke' : 'affected',
    files: [...files].sort(),
    lighthouse,
    reason: docsOnly ? 'Documentation only' : 'Known isolated feature/test changes',
  };
}

function git(root, ...args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function comparisonBase(eventName, event) {
  const base = eventName === 'pull_request' ? event.pull_request?.base?.sha : event.before;
  if (
    !['pull_request', 'push'].includes(eventName) ||
    !/^[a-f0-9]{40}$/i.test(base ?? '') ||
    /^0+$/.test(base)
  ) {
    return undefined;
  }
  return base;
}

export function changedPaths(root, base) {
  if (!base) return undefined;
  // HEAD is the actual checkout: a PR merge result or the pushed main commit.
  // Never select from an unrelated, shallow, missing or rewritten baseline.
  git(root, 'merge-base', '--is-ancestor', base, 'HEAD');
  return git(root, 'diff', '--no-renames', '--name-only', '-z', base, 'HEAD')
    .split('\0')
    .filter(Boolean);
}

function repoPath(root, path) {
  return relative(root, path).split(sep).join('/');
}

function referencedPaths(source, file, root, options) {
  const imports = ts.preProcessFile(source, true, true).importedFiles.map((item) => item.fileName);
  // Workers and Angular component resources can also cross a feature boundary.
  for (const match of source.matchAll(
    /(?:new\s+URL\(\s*|(?:templateUrl|styleUrl)\s*:\s*|@(?:use|forward|import)\s+)(['"])([^'"]+)\1/g,
  )) {
    imports.push(match[2]);
  }
  const result = [];
  for (const specifier of imports) {
    const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule;
    if (resolved) result.push(repoPath(root, resolved.resolvedFileName));
    if (specifier.startsWith('.')) {
      result.push(repoPath(root, resolve(dirname(file), specifier)));
    }
  }
  return result;
}

// If a shared module or another feature imports a feature, the directory allowlist is no
// longer sufficient. Conservatively run everything until its consumers are mapped.
// The lazy route manifest is the one intentional cross-feature entry point.
export function isolationProblem(root, tracked) {
  const config = ts.readConfigFile(resolve(root, 'tsconfig.json'), ts.sys.readFile);
  if (config.error) return 'Unable to read TypeScript configuration';
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  if (parsed.errors.length) return 'Unable to resolve TypeScript configuration';
  for (const path of tracked) {
    if (!path.startsWith('src/') || !/\.(?:[cm]?[jt]s|s?css)$/.test(path)) continue;
    if (path === 'src/app/app.routes.ts' || path.endsWith('.spec.ts')) continue;
    const file = resolve(root, path);
    const source = readFileSync(file, 'utf8');
    const owner = featureOf(path);
    for (const target of referencedPaths(source, file, root, parsed.options)) {
      const dependency = featureOf(target);
      if (dependency && dependency !== owner) {
        return 'Cross-feature dependency: ' + path + ' -> ' + target;
      }
    }
  }
  return undefined;
}

export function planFromCheckout(root, eventName, event) {
  const base = comparisonBase(eventName, event);
  if (!base) return full('Scheduled/manual run or missing comparison base');
  try {
    const changes = changedPaths(root, base);
    const tracked = git(root, 'ls-files', '-z').split('\0').filter(Boolean);
    const specs = tracked.filter((path) => path.startsWith('tests/') && path.endsWith('.spec.js'));
    return selectImpact(changes, specs, isolationProblem(root, tracked));
  } catch (error) {
    return full('Could not safely determine impact: ' + error.message.split('\n')[0]);
  }
}

function main() {
  let plan;
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    plan = planFromCheckout(process.cwd(), process.env.GITHUB_EVENT_NAME, event);
  } catch {
    plan = full('Missing GitHub event context');
  }
  const summary = [
    '## Test impact',
    '',
    '- Mode: ' + plan.mode,
    '- Reason: ' + plan.reason,
    '- Browser suites: ' + (plan.mode === 'full' ? 'all' : plan.files.join(', ')),
    '- Lighthouse: ' + (plan.lighthouse ? 'desktop and mobile' : 'deferred to full regression'),
    '',
  ].join('\n');
  console.log(summary);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      'mode=' +
        plan.mode +
        '\nfiles=' +
        plan.files.join(' ') +
        '\nlighthouse=' +
        plan.lighthouse +
        '\n',
    );
  }
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
