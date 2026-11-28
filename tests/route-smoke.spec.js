import { expect, test } from '@playwright/test';

const routes = [
  ['/', 'Made by Marcel'],
  ['/about/', 'About'],
  ['/experience/', 'Experience'],
  ['/projects/', 'Projects'],
  ['/projects/canoe-polo/', 'Canoe polo AI'],
  ['/projects/biped/', 'Biped robot'],
  ['/projects/t-rex-v3/', 'T. rex V3'],
  ['/lab/', 'Lab'],
  ['/contact/', 'Contact'],
  ['/404/', 'Page not found'],
];

test('all prerendered routes load directly without browser errors', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const [path, heading] of routes) {
    await test.step(path, async () => {
      const response = await page.goto(path);
      expect(response?.ok()).toBe(true);
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading);
      await expect(page.getByRole('main')).toBeVisible();
      await expect(page).toHaveTitle(/Made by Marcel/);
      expect(errors).toEqual([]);
    });
  }
});
