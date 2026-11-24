import { expect, test } from '@playwright/test';

test('catalogue switches between all 26 layouts and foundations', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/lab/');
  const sidebar = page.getByRole('complementary', { name: 'Design system catalogue' });
  const options = sidebar.getByRole('button');
  await expect(options).toHaveCount(27);
  const names = await options.allTextContents();

  for (const name of names.slice(1)) {
    const option = sidebar.getByRole('button', { name: name.trim(), exact: true });
    await option.click();
    await expect(option).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#lab-panel h2')).toHaveText(name.trim());
    await expect(page.locator('.preview-stage')).toBeVisible();
    await expect(page.locator('.preview-stage .preview-tile').first()).toBeVisible();
  }

  await options.first().click();
  await expect(page.getByRole('heading', { name: 'Design system', exact: true })).toBeVisible();
});

test('layout previews respond to container width and mobile selection', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/lab/');
  await page.getByRole('button', { name: 'Bento layout', exact: true }).click();
  const bento = page.locator('.preview-stage .ds-bento');
  const columns = () => {
    return bento.evaluate((element) => {
      return globalThis.getComputedStyle(element).gridTemplateColumns.split(' ').length;
    });
  };
  expect(await columns()).toBe(3);
  await page.getByRole('button', { name: '320px', exact: true }).click();
  expect(await columns()).toBe(1);

  await page.setViewportSize({ width: 320, height: 780 });
  const menu = page.getByLabel('Catalogue entry');
  await expect(menu).toBeVisible();
  await menu.selectOption('editorial');
  await expect(page.locator('#lab-panel h2')).toHaveText('Editorial layout');
  await expect(page.locator('.preview-stage')).toBeVisible();
  const overflow = await page.evaluate(
    () =>
      globalThis.document.documentElement.scrollWidth -
      globalThis.document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
