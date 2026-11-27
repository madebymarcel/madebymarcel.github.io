import { expect, test } from '@playwright/test';

test('T. rex keeps the physical artwork and exposes only start/pause', async ({ page }) => {
  await page.goto('/projects/');
  const project = page.locator('main article').nth(2);
  await expect(project.getByRole('heading')).toHaveText('T. rex');
  await project.getByRole('link', { name: 'Explore T. rex' }).click();
  await expect(page).toHaveURL(/\/projects\/t-rex\/?$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('T. rex');
  const viewer = page.getByRole('group', { name: 'Physical replay' });
  const top = viewer.getByRole('img', { name: 'Tyrannosaurus rex seen from above' });
  const side = viewer.getByRole('img', { name: 'Side view of the physical skeleton' });
  await expect(top.getByTestId('rex-tail-skin')).toBeVisible();
  await expect(side.getByTestId('rex-side-skin')).toBeVisible();
  const start = page.getByRole('button', { name: 'Start training' });
  await expect(start).toBeEnabled();
  await expect(page.locator('main').getByRole('button')).toHaveCount(1);
  await expect(page.locator('main select')).toHaveCount(0);
  const initial = await top.getByTestId('rex-tail-skin').getAttribute('d');
  await expect(top.getByTestId('rex-tail-skin')).not.toHaveAttribute('d', initial);
  for (const artwork of [top, side]) {
    const bounds = await artwork.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
  }
});

test('training and replay are independent and progress survives reload', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop-chromium', 'Worker integration uses one browser in CI');
  await page.goto('/projects/t-rex/');
  const start = page.getByRole('button', { name: 'Start training' });
  const pause = page.getByRole('button', { name: 'Pause training' });
  const viewer = page.getByRole('group', { name: 'Physical replay' });
  await expect(viewer).toHaveAttribute('data-replay-cycle', '1');
  await start.click();
  await expect(pause).toBeVisible();
  const savedIteration = () =>
    page.evaluate(() => {
      const raw = localStorage.getItem('made-by-marcel-trex-continuous-v4');
      return raw ? JSON.parse(raw).iteration : 0;
    });
  await expect.poll(savedIteration, { timeout: 30_000 }).toBeGreaterThan(0);
  await pause.click();
  await expect(start).toBeEnabled();
  const iteration = await savedIteration();
  const cycle = await viewer.getAttribute('data-replay-cycle');
  await expect(viewer).not.toHaveAttribute('data-replay-cycle', cycle, { timeout: 12_000 });
  expect(await savedIteration()).toBe(iteration);
  await page.reload();
  await expect(start).toBeEnabled();
  expect(await savedIteration()).toBe(iteration);
});
