import { expect, test } from '@playwright/test';

test('Fibonacci spacing tokens follow the documented scale', async ({ page }) => {
  await page.goto('/lab/');
  const sizes = await page.locator('.spacing-bar').evaluateAll((bars) =>
    bars.map((bar) => Math.round(bar.getBoundingClientRect().width)),
  );
  expect(sizes).toEqual([3, 5, 8, 13, 21, 34, 55, 89]);
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

      return ['--background', '--surface'].flatMap((surface) => [
        ...['--text', '--muted', '--accent', '--success', '--warning', '--danger'].map(
          (token) => ({ token, surface, ratio: contrast(token, surface), minimum: 4.5 }),
        ),
        {
          token: '--border-strong',
          surface,
          ratio: contrast('--border-strong', surface),
          minimum: 3,
        },
        {
          token: '--on-accent',
          surface: '--accent',
          ratio: contrast('--on-accent', '--accent'),
          minimum: 4.5,
        },
        {
          token: '--on-accent',
          surface: '--accent-hover',
          ratio: contrast('--on-accent', '--accent-hover'),
          minimum: 4.5,
        },
      ]);
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
