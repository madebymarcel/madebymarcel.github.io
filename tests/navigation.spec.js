import { expect, test } from '@playwright/test';

test('mobile menu opens, closes on Escape and restores button focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  const menu = page.getByRole('button', { name: 'Menu' });
  const navigation = page.getByRole('navigation', { name: 'Primary' });
  await expect(menu).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(navigation).toBeHidden();

  await menu.click();
  await expect(navigation).toBeVisible();
  await expect(page.locator('.menu-toggle[aria-controls]')).toHaveAttribute(
    'aria-expanded',
    'true',
  );

  await page.keyboard.press('Escape');
  await expect(navigation).toBeHidden();
  await expect(menu).toBeFocused();
});

test('navigation moves focus to the new page heading', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Menu' }).click();
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'About' })
    .click();

  const heading = page.getByRole('heading', { name: 'About' });
  await expect(heading).toBeVisible();
  await expect(heading).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
});

test('reselecting the active mobile page restores visible keyboard focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/about/');

  const menu = page.getByRole('button', { name: 'Menu' });
  await menu.click();
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'About' })
    .click();

  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
});

test('the backdrop closes mobile navigation without changing routes', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/about/');

  const menu = page.getByRole('button', { name: 'Menu' });
  await menu.click();
  await page.mouse.click(8, 120);

  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden();
});

test('unknown direct URL displays a helpful 404 page', async ({ page }) => {
  await page.goto('/this-page-is-not-here');
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return home' })).toBeVisible();
});

test('desktop navigation stays visible without the menu toggle', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');

  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Menu' })).toBeHidden();
});

test('desktop navigation does not move when page overflow changes', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Primary' });
  await page.locator('html').evaluate((element) => {
    element.style.overflowY = 'hidden';
  });
  const before = await nav.boundingBox();
  await page.locator('html').evaluate((element) => {
    element.style.overflowY = 'scroll';
  });
  const after = await nav.boundingBox();
  expect(before).not.toBeNull();
  expect(after).not.toBeNull();
  expect(Math.abs(before.x - after.x)).toBeLessThanOrEqual(1);
});

test('mobile drawer overlays content and closes with its close button', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const main = page.locator('main');
  const before = await main.boundingBox();
  await page.getByRole('button', { name: 'Menu' }).click();
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveCSS('position', 'fixed');
  expect(await main.boundingBox()).toEqual(before);
  await expect(drawer.getByRole('button', { name: 'Close' })).toBeFocused();
  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole('button', { name: 'Menu' })).toBeFocused();
});

test('resizing to desktop dismisses the mobile drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
});
