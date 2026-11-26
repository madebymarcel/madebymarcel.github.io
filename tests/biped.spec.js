/* global document, window */
import { expect, test } from '@playwright/test';

test('portfolio opens biped, trains off the replay thread, and plays a checkpoint', async ({
  page,
}) => {
  await page.goto('/projects/');
  await page.getByRole('link', { name: 'Explore biped robot' }).click();
  await expect(page.getByRole('heading', { name: 'Biped robot' })).toBeVisible();
  await expect(
    page.getByRole('img', { name: 'Side view of the biped robot and terrain' }),
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
  await expect(page.getByTestId('biped-replay-summary')).toContainText(/Iteration\s*[1-9]\d*/);
  const restart = page.getByRole('button', { name: 'Restart selected skill' });
  await page.getByRole('spinbutton', { name: 'Restart seed' }).fill('0');
  await expect(restart).toBeDisabled();
  await page.getByRole('spinbutton', { name: 'Restart seed' }).fill('2');
  await restart.click();
  await expect(page.getByText('Iteration 0 (seed 2)', { exact: false })).toBeVisible();
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

test('keeps five skill checkpoints separate and reports a course result', async ({ page }) => {
  await page.goto('/projects/biped/');
  const course = page.getByRole('button', { name: 'Run parkour' });
  await expect(course).toBeDisabled();
  const train = page.getByRole('button', { name: 'Start training' });
  const pause = page.getByRole('button', { name: 'Pause training' });
  const best = page.getByRole('button', { name: 'Watch best' });
  await page.getByRole('button', { name: 'Train all skills' }).click();
  await expect(page.getByText('Training Walk', { exact: true })).toBeVisible();
  await expect(best).toBeEnabled({ timeout: 20000 });
  await pause.click();
  await expect(train).toBeEnabled();
  for (const name of ['Run', 'Jump', 'Climb stairs', 'Get up']) {
    const skill = page.getByRole('button', { name, exact: true });
    await skill.click();
    await expect(best).toBeDisabled();
    await train.click();
    await expect(best).toBeEnabled({ timeout: 20000 });
    await pause.click();
    await expect(train).toBeEnabled();
  }
  await expect(course).toBeEnabled();
  await course.click();
  await expect(page.getByTestId('biped-replay-summary')).toContainText('Parkour');
  await expect(page.getByTestId('biped-result')).not.toBeEmpty({ timeout: 17000 });
  await page.getByRole('button', { name: 'Restart selected skill' }).click();
  await expect(course).toBeDisabled();
  await page.getByRole('button', { name: 'Walk', exact: true }).click();
  await expect(best).toBeEnabled();
});
