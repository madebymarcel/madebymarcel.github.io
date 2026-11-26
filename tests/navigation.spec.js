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

test('clicking the exposed page closes mobile navigation without changing routes', async ({
  page,
}) => {
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

test('mobile drawer pushes content and footer, keeps the header still and fades out', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const main = page.locator('main');
  const footer = page.locator('footer');
  const header = page.locator('header');
  const toggle = header.locator('.menu-toggle');
  const before = await main.boundingBox();
  const footerBefore = await footer.boundingBox();
  const headerBefore = await header.boundingBox();
  const toggleBefore = await toggle.boundingBox();
  await page.getByRole('button', { name: 'Menu' }).click();
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  await expect(drawer).toBeVisible();
  await expect(drawer).toHaveCSS('position', 'fixed');
  await expect(drawer).toHaveCSS('opacity', '1');
  const drawerBounds = await drawer.boundingBox();
  const width = drawerBounds.width;
  expect(drawerBounds.y).toBeCloseTo(headerBefore.y + headerBefore.height, 0);
  expect(drawerBounds.y + drawerBounds.height).toBeCloseTo(844, 0);
  await expect.poll(async () => (await main.boundingBox()).x).toBeCloseTo(before.x - width, 0);
  const after = await main.boundingBox();
  expect(after.x).toBeCloseTo(before.x - width, 0);
  expect(after.width).toBeCloseTo(before.width, 0);
  expect((await footer.boundingBox()).x).toBeCloseTo(footerBefore.x - width, 0);
  expect(await header.boundingBox()).toEqual(headerBefore);
  expect(await drawer.evaluate((element) => element.matches(':modal'))).toBe(false);
  await expect(page.locator('.site-content')).toHaveAttribute('inert', '');
  await expect(page.locator('.menu-toggle')).toHaveCount(1);
  await expect(toggle).toHaveAccessibleName('Close');
  await expect(toggle).toBeFocused();
  expect(await toggle.boundingBox()).toEqual(toggleBefore);
  expect(
    await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth -
        globalThis.document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
  const closing = await toggle.evaluate(async (element) => {
    // Start and pause the exit in the same browser task, not across protocol round trips.
    const dialog = element.closest('app-site-header').querySelector('.navigation-drawer');
    element.click();
    const animations = dialog.getAnimations();
    for (const animation of animations) animation.pause();
    await Promise.all(animations.map((animation) => animation.ready));
    for (const animation of animations) {
      animation.currentTime = Number(animation.effect.getTiming().duration) / 2;
    }
    const style = globalThis.getComputedStyle(dialog);
    const state = { opacity: Number(style.opacity), display: style.display, open: dialog.open };
    for (const animation of animations) animation.play();
    return state;
  });
  expect(closing.open).toBe(true);
  expect(closing.display).not.toBe('none');
  expect(closing.opacity).toBeGreaterThan(0);
  expect(closing.opacity).toBeLessThan(1);
  await expect(page.locator('.navigation-drawer')).toBeHidden();
  await expect(page.locator('.site-content')).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  expect(await main.boundingBox()).toEqual(before);
  expect(await footer.boundingBox()).toEqual(footerBefore);
  await expect(page.getByRole('button', { name: 'Menu' })).toBeFocused();
  await expect(page.locator('.site-content')).not.toHaveAttribute('inert');
});

test('the shared toggle keeps the header usable and tabs into the sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/about/');
  const toggle = page.locator('header .menu-toggle');
  await toggle.click();
  await expect(toggle).toHaveAccessibleName('Close');
  await expect(toggle).toBeFocused();
  const drawer = page.locator('.navigation-drawer');
  const home = drawer.getByRole('link', { name: 'Home' });
  const about = drawer.getByRole('link', { name: 'About' });
  await page.keyboard.press('Tab');
  await expect(home).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(about).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(home).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(toggle).toBeFocused();
  await page.getByRole('link', { name: 'madebymarcel.' }).click();
  await expect(page).toHaveURL('/');
  await expect(toggle).toHaveAccessibleName('Menu');
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden();
});

test('the sidebar follows the header bottom after a mobile resize', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/about/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.setViewportSize({ width: 320, height: 640 });
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  await expect(drawer).toHaveCSS('opacity', '1');
  const headerBounds = await page.locator('header').boundingBox();
  const drawerBounds = await drawer.boundingBox();
  expect(drawerBounds.y).toBeCloseTo(headerBounds.y + headerBounds.height, 0);
  expect(drawerBounds.y + drawerBounds.height).toBeCloseTo(640, 0);
  await page.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toBeHidden();
});

test('mobile drawer respects reduced motion when opening and closing', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/about/');
  const main = page.locator('main');
  const before = await main.boundingBox();
  await page.getByRole('button', { name: 'Menu' }).click();
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  await expect(drawer).toHaveCSS('opacity', '1');
  const content = page.locator('.site-content');
  await expect(content).toHaveCSS('transition-property', 'none');
  const width = (await drawer.boundingBox()).width;
  expect((await main.boundingBox()).x).toBeCloseTo(before.x - width, 0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.navigation-drawer')).toBeHidden();
  await expect(page.getByRole('button', { name: 'Menu' })).toBeFocused();
  await expect(content).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 0, 0)');
  expect(await main.boundingBox()).toEqual(before);
});

test('resizing to desktop dismisses the mobile drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Menu' }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole('dialog', { name: 'Menu' })).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toBeVisible();
});
