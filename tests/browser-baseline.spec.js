import { expect, test } from '@playwright/test';

test('normalizes editable controls without triggering iOS small-text zoom', async ({ page }) => {
  await page.goto('/');

  const computed = await page.evaluate(() => {
    const host = globalThis.document.createElement('div');
    host.innerHTML = `
      <label for="baseline-input">Input</label>
      <input id="baseline-input" />
      <label for="baseline-select">Select</label>
      <select id="baseline-select"><option>First</option></select>
      <label for="baseline-textarea">Textarea</label>
      <textarea id="baseline-textarea"></textarea>
    `;
    globalThis.document.body.append(host);

    const controls = [...host.querySelectorAll('input, select, textarea')];
    const sizes = controls.map((element) =>
      Number.parseFloat(globalThis.getComputedStyle(element).fontSize),
    );
    host.remove();
    return sizes;
  });

  expect(computed).toHaveLength(3);
  for (const size of computed) {
    expect(size).toBeGreaterThanOrEqual(16);
  }
});

test('preserves browser zoom and allows tap manipulation', async ({ page }) => {
  await page.goto('/');

  const viewport = page.locator('meta[name="viewport"]');
  await expect(viewport).toHaveAttribute('content', 'width=device-width, initial-scale=1');

  const touchAction = await page
    .getByRole('button', { name: 'Dark mode' })
    .evaluate((button) => globalThis.getComputedStyle(button).touchAction);
  expect(touchAction).toBe('manipulation');
});

for (const width of [320, 390]) {
  test(`no horizontal overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 });
    await page.goto('/');

    const overflow = await page.evaluate(
      () =>
        globalThis.document.documentElement.scrollWidth -
        globalThis.document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
