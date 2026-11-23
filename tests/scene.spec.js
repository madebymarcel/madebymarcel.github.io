import { expect, test } from '@playwright/test';

test('renders the original parallax scene without JavaScript exceptions', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');

  await expect(page).toHaveTitle(/Made by Marcel/);
  await expect(page.locator('.scene-frame svg')).toBeVisible();
  expect(await page.locator('[data-parallax-layer]').count()).toBeGreaterThan(10);

  await page.evaluate(() => window.scrollTo(0, window.innerHeight / 2));
  await expect(page.locator('.scene-stage')).toBeVisible();
  expect(errors).toEqual([]);
});

test('theme switch updates the scene without reloading', async ({ page }) => {
  await page.goto('/');
  const toggle = page.getByRole('switch', { name: 'Night mode' });

  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'night');
  await expect(toggle).toHaveAttribute('aria-checked', 'true');

  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
});

test('supports reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.locator('.scene-frame svg')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'day');
});
