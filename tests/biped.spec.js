/* global document, window */
import { expect, test } from '@playwright/test';

test('portfolio opens biped, trains off the replay thread, and plays a checkpoint', async ({
  page,
}) => {
  await page.goto('/projects/');
  await page.getByRole('link', { name: 'Explore biped robot' }).click();
  await expect(page.getByRole('heading', { name: 'Biped robot' })).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Side view of the biped robot on a level track' }),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: 'Show sensors' }).check();
  await expect(page.getByText(/Far leg:/)).toBeVisible();
  await page.getByRole('button', { name: 'Watch baseline' }).click();
  const start = page.getByRole('button', { name: 'Start training' });
  await expect(start).toBeEnabled();
  await start.click();
  await expect(page.getByRole('button', { name: 'Watch best' })).toBeEnabled({ timeout: 20000 });
  await page.getByRole('button', { name: 'Pause training' }).click();
  await page.getByLabel('Test start').selectOption('1');
  await page.getByRole('button', { name: 'Watch best' }).click();
  await expect(page.getByText(/Iteration [1-9]\d* ·/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause replay' })).toBeEnabled();
  const restart = page.getByRole('button', { name: 'Restart learning' });
  await page.getByRole('spinbutton', { name: 'Restart seed' }).fill('0');
  await expect(restart).toBeDisabled();
  await page.getByRole('spinbutton', { name: 'Restart seed' }).fill('2');
  await restart.click();
  await expect(page.getByText('Iteration (seed 2)', { exact: true })).toBeVisible();
  await expect(start).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Watch best' })).toBeDisabled();
});

test('direct biped URL works with no horizontal page overflow', async ({ page }) => {
  await page.goto('/projects/biped/');
  await expect(page.getByRole('heading', { name: 'Biped robot' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start training' })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
});
