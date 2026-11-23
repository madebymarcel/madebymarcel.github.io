import { expect, test } from '@playwright/test';

test('home keeps its heading above a decorative water canvas', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.water-hero h1')).toHaveText('Made by Marcel');
  await expect(page.locator('.water-hero canvas')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('.water-hero canvas')).toHaveCount(1);
});

test('home remains readable with reduced motion enabled', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Made by Marcel' })).toBeVisible();
});

test('full-bleed water does not create horizontal scrolling', async ({ page }) => {
  await page.goto('/');
  const overflow = await page.evaluate(
    () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
  );
  expect(overflow).toBe(false);
});
