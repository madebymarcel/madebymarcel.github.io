import { expect, test } from '@playwright/test';

test('Fibonacci spacing tokens follow the documented scale', async ({ page }) => {
  await page.goto('/lab/');
  const bars = page.locator('.spacing-bar');
  const sizes = await bars.evaluateAll((items) => {
    return items.map((bar) => Math.round(bar.getBoundingClientRect().width));
  });
  expect(sizes).toEqual([3, 5, 8, 13, 21, 34, 55, 89, 144]);
});

for (const theme of ['light', 'dark']) {
  test(`semantic colors meet contrast targets in ${theme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/lab/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const ratios = await page.evaluate(() => {
      const styles = globalThis.getComputedStyle(globalThis.document.documentElement);
      const canvas = globalThis.document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d');

      const luminance = (token) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = styles.getPropertyValue(token).trim();
        context.fillRect(0, 0, 1, 1);
        const pixel = context.getImageData(0, 0, 1, 1).data;
        const linear = [...pixel.slice(0, 3)].map((value) => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
      };

      const contrast = (a, b) => {
        const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
        return (values[0] + 0.05) / (values[1] + 0.05);
      };

      const textTokens = ['--text', '--muted', '--accent', '--success', '--warning', '--danger'];
      const results = [];
      const check = (token, surface, minimum) => {
        results.push({ token, surface, ratio: contrast(token, surface), minimum });
      };

      for (const surface of ['--background', '--surface']) {
        for (const token of textTokens) {
          check(token, surface, 4.5);
        }
        check('--border-strong', surface, 3);
      }

      check('--on-accent', '--accent', 4.5);
      check('--on-accent', '--accent-hover', 4.5);
      return results;
    });

    for (const { token, surface, ratio, minimum } of ratios) {
      expect(ratio, `${token} against ${surface}`).toBeGreaterThanOrEqual(minimum);
    }
  });
}

test('design system examples are operable and reflow at 320px', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto('/lab/');

  const toggle = page.getByRole('button', { name: 'Toggle example' });
  await toggle.focus();
  await page.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.getByLabel('Example name (required)').fill('Example');
  await page.getByRole('button', { name: 'Validate example' }).click();
  await expect(page.getByText('Example validated.')).toBeVisible();

  const overflow = await page.evaluate(
    () =>
      globalThis.document.documentElement.scrollWidth -
      globalThis.document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test('fluid space pairs interpolate and clamp at the configured endpoints', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 780 });
  await page.goto('/lab/');

  const bars = page.locator('.fluid-bar');
  const widths = () => {
    return bars.evaluateAll((items) => items.map((item) => item.offsetWidth));
  };
  const minimums = [5, 8, 13, 13, 21, 34, 55];
  const maximums = [8, 13, 21, 34, 34, 89, 144];

  expect(await widths()).toEqual(minimums);
  await page.setViewportSize({ width: 800, height: 900 });
  const middle = await widths();
  middle.forEach((value, index) => {
    const expected = (minimums[index] + maximums[index]) / 2;
    expect(Math.abs(value - expected)).toBeLessThanOrEqual(2);
  });

  await page.setViewportSize({ width: 1600, height: 900 });
  expect(await widths()).toEqual(maximums);
});

test('golden split follows container width rather than viewport width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/lab/');

  const wide = page.locator('.golden-demo .ds-golden-split');
  const narrow = page.locator('.golden-demo-narrow .ds-golden-split');
  const columns = (layout) => {
    return layout.evaluate((element) => {
      return globalThis.getComputedStyle(element).gridTemplateColumns.split(' ').map(parseFloat);
    });
  };

  const wideColumns = await columns(wide);
  expect(wideColumns).toHaveLength(2);
  expect(wideColumns[0] / wideColumns[1]).toBeCloseTo(1.618, 2);
  expect(await columns(narrow)).toHaveLength(1);

  await page.setViewportSize({ width: 320, height: 780 });
  expect(await columns(wide)).toHaveLength(1);
});
