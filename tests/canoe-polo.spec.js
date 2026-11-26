import { expect, test } from '@playwright/test';

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

  await page.getByRole('button', { name: 'Export Generation 0' }).click();
  const transfer = page.getByLabel('Generation data (JSON)');
  await expect(transfer).toHaveValue(/^\{"format":"canoe-polo-generations-v1",/);
  const data = JSON.parse(await transfer.inputValue());
  expect(data.generations).toHaveLength(1);
  expect(data.generations[0].id).toBe('genesis-v1');
  expect(data.generations[0].weights.length).toBeGreaterThan(1000);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText(/Import complete/)).toBeVisible();
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

  await page.getByRole('button', { name: 'Run skills drills' }).click();
  await expect(page.getByText('Generation 0 results')).toBeVisible();
  await expect(page.getByText(/Turn and collect under control:.+8/)).toBeVisible();
  await expect(page.getByText(/Aim and score:.+8/)).toBeVisible();
  await expect(page.getByText(/Save a goal-bound shot:.+8/)).toBeVisible();

  await expect(page.getByText('About and rules', { exact: true })).toBeVisible();
});

test('keeps import and export outside a long searchable generation list', async ({ page }) => {
  await page.goto('/projects/canoe-polo/');
  await page.getByRole('button', { name: 'Export Generation 0' }).click();
  const transfer = page.getByLabel('Generation data (JSON)');
  await expect(transfer).toHaveValue(/canoe-polo-generations-v1/);
  const data = JSON.parse(await transfer.inputValue());
  const zeroWeights = data.generations[0].weights.map(() => 0);
  data.generations = Array.from({ length: 120 }, (_, index) => ({
    ...data.generations[0],
    id: 'test-generation-' + (index + 1),
    number: index + 1,
    parentId: 'genesis-v1',
    weights: zeroWeights,
  }));
  await transfer.fill(JSON.stringify(data));
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Generations (121)' })).toBeVisible();

  const list = page.getByRole('region', { name: 'Generation list' });
  const geometry = await list.evaluate((node) => ({
    height: node.clientHeight,
    scroll: node.scrollHeight,
    viewport: globalThis.innerHeight,
  }));
  expect(geometry.height).toBeLessThan(geometry.viewport);
  expect(geometry.scroll).toBeGreaterThan(geometry.height);
  await expect(list.getByRole('button', { name: 'Export all' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Export all' })).toBeVisible();

  await page.getByLabel('Find a generation').fill('test-generation-120');
  await expect(list.getByRole('listitem')).toHaveCount(1);
  await list.getByRole('button', { name: /Export Generation 120/ }).click();
  await expect(transfer).toHaveValue(/test-generation-120/);
});
