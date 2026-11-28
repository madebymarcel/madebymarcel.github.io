import { expect, test } from '@playwright/test';

test('V3 is the only dinosaur project and exposes the physical rig', async ({ page }) => {
  await page.goto('/projects/');
  await expect(page.getByRole('link', { name: 'Explore T. rex V3', exact: true })).toBeVisible();
  await expect(page.locator('a[href="/projects/t-rex"]')).toHaveCount(0);
  await expect(page.locator('a[href="/projects/t-rex-v2"]')).toHaveCount(0);
  await page.getByRole('link', { name: 'Explore T. rex V3', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'T. rex V3', exact: true })).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'side view of the articulated T. rex skeleton' }),
  ).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'top view of the articulated T. rex skeleton' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Balanced start' }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('Mass: 8000 kg (estimated)')).toBeVisible();
  await page.getByRole('button', { name: 'Return to rig' }).click();
  await expect(page.getByRole('button', { name: 'Return to rig' })).toBeDisabled();
});

test('starts the distance learning worker and exposes separate training metrics', async ({
  page,
}) => {
  await page.goto('/projects/t-rex-v3/');
  await page.getByLabel('Brain').selectOption('ppo');
  await page.getByLabel('Simulation workers').selectOption('2');
  await page.getByRole('button', { name: 'Start training', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Training progress' })).toBeVisible();
  await expect(page.getByText('PPO updates: 0')).toBeVisible();
  await expect(page.getByRole('img', { name: 'Live training dinosaur side view' })).toBeVisible();
  await expect(page.getByText('Invalid training episodes:', { exact: false })).toBeVisible();
  await expect(page.getByText('Uncommitted decisions this round: 0')).not.toBeVisible({
    timeout: 20000,
  });
  const pause = page.getByRole('button', { name: 'Pause training or replay' });
  if (await pause.isEnabled()) await pause.click();
  await expect(page.getByRole('button', { name: 'Save learning checkpoint' })).toBeEnabled();
  await expect(page.getByText('Uncommitted decisions this round: 0')).toBeVisible();
});

test('starts pure DEP and preserves collected memory when enabling experimental MPO', async ({
  page,
}) => {
  await page.goto('/projects/t-rex-v3/');
  await expect(page.getByLabel('Brain')).toHaveValue('dep');
  await page.getByLabel('Simulation workers').selectOption('1');
  await page.getByRole('button', { name: 'Start training', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pure DEP capability audit' })).toBeVisible();
  await expect(page.getByText(/^Action decisions: [1-9]\d*$/)).toBeVisible({ timeout: 40000 });
  const pause = page.getByRole('button', { name: 'Pause training or replay' });
  if (await pause.isEnabled()) await pause.click();
  await expect(page.getByRole('button', { name: 'Save learning checkpoint' })).toBeEnabled();
  const memory = await page.getByText(/^Replay memory:/).textContent();
  await page.getByRole('button', { name: 'Enable experimental MPO (keep DEP memory)' }).click();
  await expect(page.getByText('Brain: dep-mpo', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Replay memory:/)).toHaveText(memory ?? '');
});
