import { expect, test } from '@playwright/test';

test('home page renders and navigates to a lazy-loaded section', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  await expect(page).toHaveTitle(/Made by Marcel/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Made by Marcel');
  await page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Lab' }).click();
  await expect(page).toHaveURL(/\/lab\/?$/);
  await expect(page.getByRole('heading', { name: 'Lab' })).toBeVisible();
  await expect(page.locator('footer')).toHaveText(`Made by Marcel (${new Date().getFullYear()})`);
  expect(errors).toEqual([]);
});

test('theme control changes the active color mode', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Dark mode' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('each prerendered route works when opened directly', async ({ page }) => {
  await page.goto('/projects/');
  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
});
