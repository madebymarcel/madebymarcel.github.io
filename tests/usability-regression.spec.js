import { expect, test } from '@playwright/test';

for (const width of [320, 390, 768]) {
  test(`no horizontal scrolling at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/');

    const overflow = await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth -
        globalThis.document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
}

test('skip link is keyboard accessible', async ({ page }) => {
  await page.goto('/');
  const skip = page.getByRole('link', { name: 'Skip to content' });
  await page.keyboard.press('Tab');
  await expect(skip).toBeFocused();
  await expect(skip).toBeVisible();
  await expect(skip).toHaveAttribute('href', '#main-content');
});

test('normal links preserve browser Back and Forward navigation', async ({ page }) => {
  await page.goto('/');
  const menu = page.getByRole('button', { name: 'Menu' });
  if (await menu.isVisible()) await menu.click();

  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'About' })
    .click();
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible();

  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Made by Marcel' })).toBeVisible();

  await page.goForward();
  await expect(page.getByRole('heading', { name: 'About' })).toBeVisible();
});

test('honors reduced-motion preference without disabling interactions', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');

  const seconds = await page.evaluate(() => {
    const element = globalThis.document.createElement('span');
    element.style.animationDuration = '10s';
    globalThis.document.body.append(element);
    const duration = globalThis.getComputedStyle(element).animationDuration;
    element.remove();
    return Number.parseFloat(duration);
  });

  expect(seconds).toBeLessThan(0.01);
});
