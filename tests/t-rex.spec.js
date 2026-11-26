import { expect, test } from '@playwright/test';

test('T. rex is the third project and its SVG loads without horizontal overflow', async ({ page }) => {
  await page.goto('/projects/');
  const projects = page.locator('main article');
  await expect(projects.nth(2).getByRole('heading')).toHaveText('T. rex');
  await projects.nth(2).getByRole('link', { name: 'Explore T. rex' }).click();
  await expect(page).toHaveURL(/\/projects\/t-rex\/?$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('T. rex');

  const artwork = page.getByRole('img', { name: /Tyrannosaurus rex seen from above/ });
  await expect(artwork).toBeVisible();
  await expect(artwork).toHaveJSProperty('naturalWidth', 420);
  const bounds = await artwork.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
});

test('T. rex opens directly as a prerendered page', async ({ page }) => {
  const response = await page.goto('/projects/t-rex/');
  expect(response.status()).toBe(200);
  await expect(page).toHaveTitle('T. rex | Made by Marcel');
  await expect(page.getByRole('img', { name: /Tyrannosaurus rex seen from above/ })).toBeVisible();
});
