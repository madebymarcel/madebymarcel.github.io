import { expect, test } from '@playwright/test';

test('all 26 layout previews and foundations are rendered in one column', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/lab/');
  const previews = page.locator('.layout-example .preview-stage');
  await expect(previews).toHaveCount(26);
  await expect(page.getByRole('heading', { name: 'Design system', exact: true })).toBeVisible();

  const bounds = await previews.evaluateAll((items) => {
    return items.map((item) => {
      const rect = item.getBoundingClientRect();
      return { width: rect.width, top: rect.top, bottom: rect.bottom };
    });
  });
  for (const [index, rect] of bounds.entries()) {
    expect(rect.width).toBeGreaterThan(1280);
    if (index > 0) expect(rect.top).toBeGreaterThan(bounds[index - 1].bottom);
  }

  await expect(page.getByRole('heading', { name: 'Bento layout', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Canvas workspace', exact: true })).toBeVisible();
});

test('all layout previews reflow when the browser becomes narrow', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/lab/');
  const bento = page.locator('[data-pattern="bento"] .ds-bento');
  const columns = () => {
    return bento.evaluate((element) => {
      return globalThis.getComputedStyle(element).gridTemplateColumns.split(' ').length;
    });
  };
  expect(await columns()).toBe(3);

  await page.setViewportSize({ width: 320, height: 780 });
  expect(await columns()).toBe(1);
  await expect(page.locator('.layout-example .preview-stage')).toHaveCount(26);
  const overflow = await page.evaluate(
    () =>
      globalThis.document.documentElement.scrollWidth -
      globalThis.document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('layout previews leave framing to the tiles and keep list text inset', async ({ page }) => {
  await page.goto('/lab/');
  const editorial = page.locator('[data-pattern="editorial"]');
  const editorialCard = editorial.locator('.preview-tile').first();
  const listCard = page.locator('.preview-tile.preview-list').first();

  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(editorial).toHaveCSS('border-top-width', '0px');
    await expect(editorial).toHaveCSS('padding-left', '0px');
    await expect(editorialCard).toHaveCSS('border-top-width', '1px');
    const insets = await listCard.evaluate((element) => {
      const card = element.getBoundingClientRect();
      const title = element.querySelector('.preview-title').getBoundingClientRect();
      const row = element.querySelector('li').getBoundingClientRect();
      return { top: title.top - card.top, left: title.left - card.left, row: row.left - card.left };
    });
    expect(insets.top).toBeGreaterThan(6);
    expect(insets.left).toBeGreaterThan(6);
    expect(insets.row).toBeCloseTo(insets.left);
  }
});
