import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { changedPaths, comparisonBase, isolationProblem, selectImpact } from './test-impact.mjs';

const specs = [
  'accessibility',
  'biped',
  'browser-baseline',
  'canoe-polo-manual',
  'canoe-polo-picker',
  'canoe-polo-scroll',
  'canoe-polo-vision',
  'canoe-polo',
  'design-system',
  'home-water',
  'layout-catalogue',
  'navigation',
  'route-smoke',
  'site',
  't-rex',
  'theme-preferences',
  'usability-regression',
].map((name) => 'tests/' + name + '.spec.js');
const smoke = ['tests/route-smoke.spec.js', 'tests/site.spec.js'];
const select = (...paths) => selectImpact(paths, specs);

test('isolated dinosaur changes retain cross-page accessibility and all smoke checks', () => {
  const plan = select('src/app/features/t-rex/spatial-rig.mjs', 'scripts/rex-locomotion.mjs');
  assert.equal(plan.mode, 'affected');
  assert.deepEqual(plan.files, ['tests/accessibility.spec.js', ...smoke, 'tests/t-rex.spec.js']);
  assert.equal(plan.lighthouse, false);
});

test('canoe polo runs all five of its own suites, not dinosaur or biped suites', () => {
  const plan = select('src/app/features/canoe-polo/training.ts');
  assert.equal(plan.mode, 'affected');
  assert.equal(plan.files.filter((path) => path.includes('canoe-polo')).length, 5);
  assert.equal(plan.files.length, 7);
  assert.equal(plan.lighthouse, false);
});

test('multi-feature changes combine scopes without duplicate suites', () => {
  const plan = select('src/app/features/t-rex/t-rex-page.ts', 'src/app/features/home/water-shader.ts');
  assert.equal(plan.mode, 'affected');
  assert.equal(plan.lighthouse, true);
  assert.ok(plan.files.includes('tests/home-water.spec.js'));
  assert.ok(plan.files.includes('tests/t-rex.spec.js'));
  assert.equal(new Set(plan.files).size, plan.files.length);
});

test('project catalogue changes retain both tests which inspect its project order', () => {
  const plan = select('src/app/features/projects/projects-page.ts');
  assert.ok(plan.files.includes('tests/biped.spec.js'));
  assert.ok(plan.files.includes('tests/t-rex.spec.js'));
  assert.ok(plan.files.includes('tests/accessibility.spec.js'));
});

test('docs-only changes run smoke, known test changes run smoke and the changed suite', () => {
  assert.deepEqual(select('README.md', 'docs/t-rex-spatial.md').files, smoke);
  assert.equal(select('docs/t-rex-spatial.md').mode, 'smoke');
  assert.deepEqual(select('tests/biped.spec.js').files, ['tests/biped.spec.js', ...smoke]);
});

test('shared, unknown, mixed and unreliable changes fail open to the full suite', () => {
  for (const path of [
    'src/app/core/ui/stable-select.ts',
    'src/app/app.routes.ts',
    'src/styles.scss',
    'src/design-system/_tokens.scss',
    'package-lock.json',
    '.github/workflows/ci.yml',
    'tests/generation-picker.js',
    'src/app/features/new-project/page.ts',
    'public/trex.svg',
  ]) {
    assert.equal(select('src/app/features/t-rex/t-rex-page.ts', path).mode, 'full', path);
  }
  assert.equal(select().mode, 'full');
  assert.equal(selectImpact(undefined, specs).mode, 'full');
  assert.equal(selectImpact(['README.md'], [...specs, 'tests/new.spec.js']).mode, 'full');
  assert.equal(selectImpact(['README.md'], specs.slice(1)).mode, 'full');
  assert.equal(selectImpact(['README.md'], specs, 'cross-feature import').mode, 'full');
});

test('PR uses the base SHA, pushes use before, nightly/manual/initial events are full', () => {
  const base = 'a'.repeat(40);
  assert.equal(comparisonBase('pull_request', { pull_request: { base: { sha: base } } }), base);
  assert.equal(comparisonBase('push', { before: base }), base);
  for (const event of ['schedule', 'workflow_dispatch', 'unknown']) {
    assert.equal(comparisonBase(event, { before: base }), undefined);
  }
  assert.equal(comparisonBase('push', { before: '0'.repeat(40) }), undefined);
  assert.equal(comparisonBase('push', {}), undefined);
});

test('git comparison includes both sides of a rename and rejects missing baselines', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'impact-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'user.name', 'Test');
  writeFileSync(join(root, 'old.ts'), 'export const x = 1;\n');
  git('add', '.');
  git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD').trim();
  git('mv', 'old.ts', 'new.ts');
  git('commit', '-qm', 'rename');
  assert.deepEqual(changedPaths(root, base).sort(), ['new.ts', 'old.ts']);
  assert.throws(() => changedPaths(root, 'b'.repeat(40)));
});

test('a shared import of a feature invalidates isolation, while the route manifest is allowed', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'impact-import-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src/app/features/t-rex'), { recursive: true });
  writeFileSync(join(root, 'tsconfig.json'), JSON.stringify({ include: ['src/**/*.ts'] }));
  writeFileSync(join(root, 'src/app/features/t-rex/policy.ts'), 'export const policy = 1;\n');
  const route = 'src/app/app.routes.ts';
  const policy = 'src/app/features/t-rex/policy.ts';
  const shared = 'src/app/shared.ts';
  const source = "import { policy } from './features/t-rex/policy';\nexport { policy };\n";
  writeFileSync(join(root, route), source);
  assert.equal(isolationProblem(root, [route, policy]), undefined);
  writeFileSync(join(root, shared), source);
  assert.match(isolationProblem(root, [route, policy, shared]), /Cross-feature dependency/);
});
