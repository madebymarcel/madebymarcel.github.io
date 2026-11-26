import { expect, test } from '@playwright/test';

test('canoe polo match and portable generation library', async ({ page }) => {
  await page.goto('/projects/canoe-polo/');
  await expect(page.getByRole('heading', { name: 'Canoe polo AI' })).toBeVisible();
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByLabel('Blue team')).toHaveValue('genesis-v1');
  await expect(page.getByLabel('Red team')).toHaveValue('genesis-v1');
  await page.getByRole('button', { name: 'Start new match' }).click();
  await expect(page.getByRole('button', { name: 'Pause match' })).toBeVisible();
  await page.getByRole('button', { name: 'Pause match' }).click();
  await expect(page.getByRole('button', { name: 'Resume match' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Referee decisions' })).toBeVisible();

  await page.getByRole('button', { name: 'Generations', exact: true }).click();
  await page.getByRole('button', { name: 'Export Generation 0' }).click();
  const transfer = page.getByLabel('Generation data (JSON)');
  const data = JSON.parse(await transfer.inputValue());
  expect(data.generations[0].weights.length).toBeGreaterThan(1000);
  await page.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(page.getByText(/Import complete/)).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unlocked generations (1)' })).toBeVisible();

  await page.getByRole('button', { name: 'About', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Rules and limitations' })).toBeVisible();
});
