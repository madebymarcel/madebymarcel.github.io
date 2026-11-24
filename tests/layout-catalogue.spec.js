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
