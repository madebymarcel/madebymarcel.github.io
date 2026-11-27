import { expect, test } from '@playwright/test';

test('T. rex is third and its physical SVG fits the viewport', async ({ page }) => {
  await page.goto('/projects/');
  const projects = page.locator('main article');
  await expect(projects.nth(2).getByRole('heading')).toHaveText('T. rex');
  await projects.nth(2).getByRole('link', { name: 'Explore T. rex' }).click();
  await expect(page).toHaveURL(/\/projects\/t-rex\/?$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('T. rex');
  const artwork = page.getByRole('img', { name: 'Tyrannosaurus rex seen from above' });
  await expect(artwork).toBeVisible();
  await expect(artwork.getByTestId('rex-tail-skin')).toBeVisible();
  const bounds = await artwork.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
});

test('T. rex opens directly as a prerendered page', async ({ page }) => {
  const response = await page.goto('/projects/t-rex/');
  expect(response.status()).toBe(200);
  await expect(page).toHaveTitle('T. rex | Made by Marcel');
  await expect(page.getByRole('img', { name: 'Tyrannosaurus rex seen from above' })).toBeVisible();
});

test('one physical rig drives both the continuous skin and debug skeleton', async ({ page }) => {
  await page.goto('/projects/t-rex/');
  const view = page.getByRole('img', { name: 'Tyrannosaurus rex seen from above' });
  const skin = view.getByTestId('rex-tail-skin');
  const initial = await skin.getAttribute('d');
  await page.getByRole('button', { name: 'Watch learned demo' }).click();
  await expect(skin).not.toHaveAttribute('d', initial);
  await page.getByRole('button', { name: 'Show physics skeleton' }).click();
  await expect(view.locator('[data-bone^="tail-"]')).toHaveCount(6);
  const order = await view.locator('path').evaluateAll((nodes) => nodes.map((n) => n.dataset.bone));
  expect(order.indexOf('toes1')).toBeLessThan(order.indexOf('thigh1'));
  const side = page.getByRole('img', { name: 'Side view of the physical skeleton' });
  await expect(side.locator('[data-bone^="tail-"]')).toHaveCount(6);
});

test('training persists across reloads and restores an exported checkpoint', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/projects/t-rex/');
  const best = page.getByRole('button', { name: 'Watch your best' });
  const count = page.getByTestId('rex-iterations');
  await expect(best).toBeDisabled();
  await page.getByRole('button', { name: 'Start training' }).click();
  await expect(best).toBeEnabled({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Pause training' }).click();
  await expect(page.getByRole('button', { name: 'Start training' })).toBeEnabled({
    timeout: 30_000,
  });
  const iterations = await count.textContent();
  const raw = await page.evaluate(() => localStorage.getItem('made-by-marcel-trex-locomotion-v2'));
  expect(raw).toBeTruthy();
  await page.reload();
  await expect(count).toHaveText(iterations);
  await expect(best).toBeEnabled();
  await best.click();
  await expect(page.getByRole('img', { name: 'Tyrannosaurus rex seen from above' })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export checkpoint' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^trex-training-\d+\.json$/);
  const path = await download.path();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reset training' }).click();
  await expect(count).toHaveText('0');
  await page.getByLabel('Import checkpoint').setInputFiles(path);
  await expect(count).toHaveText(iterations);
  await page.reload();
  await expect(count).toHaveText(iterations);
  await page.getByRole('button', { name: 'Start training' }).click();
  await expect(count).not.toHaveText(iterations, { timeout: 30_000 });
  await page.getByRole('button', { name: 'Pause training' }).click();
  await expect(page.getByRole('button', { name: 'Start training' })).toBeEnabled({
    timeout: 30_000,
  });
});
