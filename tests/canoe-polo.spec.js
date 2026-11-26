import { expect, test } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

async function downloadGeneration(page, name) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name }).click();
  const download = await pending;
  const path = await download.path();
  return {
    data: JSON.parse(await readFile(path, 'utf8')),
    path,
    name: download.suggestedFilename(),
  };
}

test('switches either team policy without restarting the match', async ({ page }) => {
  await page.goto('/projects/canoe-polo/');
  const { data } = await downloadGeneration(page, 'Download Generation 0');
  const [genesis] = data.generations;
  const fixture = (id, number, stroke) => {
    const weights = genesis.weights.map(() => 0);
    // Each v3 action row has 72 weights. Bias the requested stroke (0 = coast, 1 = forward).
    weights[stroke * 72] = 20;
    return { ...genesis, id, number, weights, parentId: genesis.id };
  };
  const coast = fixture('coast-fixture', 1, 0);
  const paddle = fixture('paddle-fixture', 2, 1);
  const input = page.getByLabel('Generation file (JSON)');
  await expect(input).toBeEnabled();
  await input.setInputFiles({
    name: 'team-policies.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...data, generations: [coast, paddle] })),
  });
  await expect(page.getByText(/Imported 2 generations\. Saved on this device/)).toBeVisible();

  const blue = page.getByLabel('Blue team');
  const red = page.getByLabel('Red team');
  const blueBoat = page.locator('.pitch g.blue').first();
  const redBoat = page.locator('.pitch g.red').first();
  const clock = page.locator('.match-clock strong');
  await blue.selectOption(coast.id);
  await red.selectOption(coast.id);
  await page.getByLabel('Speed', { exact: true }).selectOption('16');
  await page.getByRole('button', { name: 'Start new match' }).click();
  await expect(clock).not.toHaveText('10:00');
  const blueBefore = await blueBoat.getAttribute('transform');
  const redBefore = await redBoat.getAttribute('transform');

  await blue.selectOption(paddle.id);
  await expect(page.locator('.team-score').first()).toContainText('Blue · Generation 2');
  await expect(blueBoat).not.toHaveAttribute('transform', blueBefore);
  await expect(redBoat).toHaveAttribute('transform', redBefore);

  await page.getByRole('button', { name: 'Pause match' }).click();
  const clockBeforeSwap = await clock.textContent();
  const pitchBeforeSwap = await page.locator('.pitch').innerHTML();
  const scoresBeforeSwap = await page.locator('.team-score strong').allTextContents();
  await red.selectOption(paddle.id);
  await expect(page.locator('.team-score').last()).toContainText('Red · Generation 2');
  await expect(page.getByRole('button', { name: 'Resume match' })).toBeVisible();
  await expect(clock).toHaveText(clockBeforeSwap);
  expect(await page.locator('.pitch').innerHTML()).toBe(pitchBeforeSwap);
  expect(await page.locator('.team-score strong').allTextContents()).toEqual(scoresBeforeSwap);

  await page.getByRole('button', { name: 'Resume match' }).click();
  await expect(redBoat).not.toHaveAttribute('transform', redBefore);
});

test('canoe polo match and portable generation library', async ({ page }) => {
  await page.goto('/projects/canoe-polo/');
  await expect(page.getByRole('heading', { name: 'Canoe polo AI' })).toBeVisible();
  const training = page.getByRole('region', { name: 'Background training' });
  const match = page.getByRole('region', { name: 'Match setup' });
  expect((await training.boundingBox()).y).toBeLessThan((await match.boundingBox()).y);
  await expect(page.getByLabel('Blue team')).toHaveValue('genesis-v1');
  await expect(page.getByLabel('Red team')).toHaveValue('genesis-v1');
  await page.getByRole('button', { name: 'Start new match' }).click();
  await expect(page.getByRole('button', { name: 'Pause match' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause match' }).click();
  await expect(page.getByRole('button', { name: 'Resume match' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Referee decisions' })).toBeVisible();

  const download = await downloadGeneration(page, 'Download Generation 0');
  expect(download.name).toBe('canoe-polo-generation-0-genesis-v1.json');
  expect(download.data.format).toBe('canoe-polo-generations-v1');
  expect(download.data.generations).toHaveLength(1);
  expect(download.data.generations[0].id).toBe('genesis-v1');
  expect(download.data.generations[0].weights.length).toBeGreaterThan(1000);
  const input = page.getByLabel('Generation file (JSON)');
  await expect(input).toBeEnabled();
  await input.setInputFiles({
    name: download.name,
    mimeType: 'application/json',
    buffer: await readFile(download.path),
  });
  await expect(page.getByText(/Imported 1 generation\. Saved on this device/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Generations (1)' })).toBeVisible();

  await page.getByText('Training rewards', { exact: true }).click();
  const passBonus = page.getByLabel('Make a useful pass');
  await expect(passBonus).toHaveValue('0.18');
  await passBonus.fill('0');
  await passBonus.blur();
  await expect(passBonus).toHaveValue('0');
  await page.getByRole('button', { name: 'Reset reward defaults' }).click();
  await expect(passBonus).toHaveValue('0.18');
  const goal = page.getByLabel('Score a goal', { exact: true });
  await expect(goal).toHaveValue('5');
  await goal.fill('7.5');
  await goal.blur();
  await expect(goal).toHaveValue('7.5');
  await page.getByRole('button', { name: 'Reset reward defaults' }).click();
  await expect(goal).toHaveValue('5');

  await expect(page.getByRole('heading', { name: 'Skills drills' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export all' })).toHaveCount(0);

  await expect(page.getByText('About and rules', { exact: true })).toBeVisible();
});

test('imports a legacy collection and downloads only the selected generation', async ({
  page,
}, testInfo) => {
  await page.goto('/projects/canoe-polo/');
  const { data } = await downloadGeneration(page, 'Download Generation 0');
  const [genesis] = data.generations;
  data.generations = Array.from({ length: 360 }, (_, index) => ({
    ...genesis,
    id: 'test-generation-' + (index + 1),
    number: index + 1,
    parentId: 'genesis-v1',
  }));
  const backup = Buffer.from(JSON.stringify(data));
  expect(backup.byteLength).toBeGreaterThan(20_000_000);
  const path = testInfo.outputPath('v3-collection.json');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, backup);
  const input = page.getByLabel('Generation file (JSON)');
  await expect(input).toBeEnabled();
  await input.setInputFiles(path);
  await expect(page.getByText(/Imported 360 generations\. Saved on this device/)).toBeVisible({
    timeout: 15_000,
  });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Generations (361)' })).toBeVisible({
    timeout: 15_000,
  });

  const list = page.getByRole('region', { name: 'Generation list' });
  const geometry = await list.evaluate((node) => ({
    height: node.clientHeight,
    scroll: node.scrollHeight,
    viewport: globalThis.innerHeight,
  }));
  expect(geometry.height).toBeLessThan(geometry.viewport);
  expect(geometry.scroll).toBeGreaterThan(geometry.height);
  await expect(list.getByLabel('Generation file (JSON)')).toHaveCount(0);

  await page.getByLabel('Find a generation').fill('test-generation-360');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  const download = await downloadGeneration(page, /Download Generation 360/);
  expect(download.data.generations).toEqual([data.generations.at(-1)]);
});

test('explains malformed and incompatible imports without changing generations', async ({
  page,
}) => {
  await page.goto('/projects/canoe-polo/');
  const input = page.getByLabel('Generation file (JSON)');
  await expect(input).toBeEnabled();
  await input.setInputFiles({
    name: 'invalid.json',
    mimeType: 'application/json',
    buffer: Buffer.from('not JSON'),
  });
  await expect(page.getByText('The generation file is not valid JSON.')).toBeVisible();

  const { data } = await downloadGeneration(page, 'Download Generation 0');
  await expect(input).toBeEnabled();
  await input.setInputFiles({
    name: 'old.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...data, policy: 'linear-actor-critic-v2' })),
  });
  await expect(page.getByText('This simulator imports v3 generation exports only.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Generations (1)' })).toBeVisible();
});

test('starts from scratch only after confirmation and leaves unrelated browser data alone', async ({
  page,
}) => {
  await page.goto('/projects/canoe-polo/');
  const { data } = await downloadGeneration(page, 'Download Generation 0');
  const snapshot = {
    ...data.generations[0],
    id: 'saved-generation',
    number: 1,
    parentId: 'genesis-v1',
  };
  const input = page.getByLabel('Generation file (JSON)');
  await expect(input).toBeEnabled();
  await input.setInputFiles({
    name: 'generation.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...data, generations: [snapshot] })),
  });
  await expect(page.getByText(/Imported 1 generation\. Saved on this device/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Generations (2)', exact: true })).toBeVisible();
  await page.evaluate(() => globalThis.localStorage.setItem('unrelated-setting', 'keep'));

  await page.getByLabel('Red team').selectOption(snapshot.id);
  await page.getByLabel('Find a generation').fill(snapshot.id);
  const reset = page.getByRole('button', { name: 'Start from scratch' });
  page.once('dialog', (dialog) => dialog.dismiss());
  await reset.click();
  await expect(page.getByRole('heading', { name: 'Generations (2)', exact: true })).toBeVisible();
  await expect(page.getByLabel('Red team')).toHaveValue(snapshot.id);

  await page.getByRole('button', { name: 'Start or resume training' }).click();
  await expect(page.getByRole('button', { name: 'Pause training' })).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await reset.click();
  await expect(page.getByText('Saved generations deleted. Back to Generation 0.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start or resume training' })).toBeEnabled();
  await expect(page.getByLabel('Find a generation')).toHaveValue('');
  await expect(page.getByLabel('Train from')).toHaveValue('genesis-v1');
  await expect(page.getByLabel('Blue team')).toHaveValue('genesis-v1');
  await expect(page.getByLabel('Red team')).toHaveValue('genesis-v1');

  await page.reload();
  await expect(page.getByLabel('Train from')).toBeEnabled();
  await expect(page.getByRole('heading', { name: 'Generations (1)', exact: true })).toBeVisible();
  await expect(page.getByLabel('Red team').locator('option')).toHaveCount(1);
  expect(await page.evaluate(() => globalThis.localStorage.getItem('unrelated-setting'))).toBe(
    'keep',
  );
});

test('watching a match keeps playback and training alive across drawer changes', async ({
  page,
}) => {
  await page.goto('/projects/canoe-polo/');
  await page.getByRole('button', { name: 'Start new match' }).click();
  await page.getByRole('button', { name: 'Watch match' }).click();
  const viewer = page.getByRole('dialog', { name: 'Immersive match view' });
  await viewer.getByRole('button', { name: 'Options' }).click();
  const options = page.getByRole('dialog', { name: 'Match options and training' });
  await options.getByLabel('Resource usage').selectOption({ label: 'Auto' });
  await options.getByRole('button', { name: 'Start or resume training' }).click();
  const progress = options.getByRole('progressbar');
  await expect(progress).toBeVisible();
  const before = await progress.getAttribute('value');
  await options.getByRole('button', { name: 'Close options' }).click();
  const clock = viewer.locator('.viewer-bar span');
  await expect(clock).not.toHaveText(await clock.innerText());
  await viewer.getByRole('button', { name: 'Options' }).click();
  await expect(progress).not.toHaveAttribute('value', before);
  await expect(options.getByRole('button', { name: 'Pause training' })).toBeVisible();
  await options.getByRole('button', { name: 'Close options' }).click();
  await viewer.getByRole('button', { name: 'Pause', exact: true }).click();
  await viewer.getByRole('button', { name: 'Exit match view' }).click();
  await expect(page.getByRole('button', { name: 'Resume match' })).toBeVisible();
  await expect(page.getByLabel('Resource usage')).toHaveValue('-1');
});
