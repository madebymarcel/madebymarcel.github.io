import { expect, test } from '@playwright/test';

test('V3 is the only dinosaur project and exposes the physical rig', async ({ page }) => {
  await page.goto('/projects/');
  await expect(page.getByRole('link', { name: 'Explore T. rex V3', exact: true })).toBeVisible();
  await expect(page.locator('a[href="/projects/t-rex"]')).toHaveCount(0);
  await expect(page.locator('a[href="/projects/t-rex-v2"]')).toHaveCount(0);
  await page.getByRole('link', { name: 'Explore T. rex V3', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'T. rex V3', exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: 'side view of the articulated T. rex skeleton' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'top view of the articulated T. rex skeleton' })).toBeVisible();
  await page.getByRole('button', { name: 'Balanced start' }).click();
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await expect(page.getByText('Mass: 8000 kg (estimated)')).toBeVisible();
  await page.getByRole('button', { name: 'Return to rig' }).click();
  await expect(page.getByRole('button', { name: 'Return to rig' })).toBeDisabled();
});
