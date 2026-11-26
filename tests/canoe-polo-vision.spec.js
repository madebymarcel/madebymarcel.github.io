import { expect, test } from '@playwright/test';

test('player vision is opt-in, with all ten sight cones and a text summary', async ({ page }) => {
  await page.goto('/projects/canoe-polo/');
  await expect(page.getByRole('button', { name: 'Start new match' })).toBeEnabled();
  const toggle = page.getByRole('checkbox', { name: 'Show player vision' });
  const cones = page.locator('.polo-vision-overlay .polo-vision-cone');
  const summary = page.locator('.polo-vision-summary');

  await expect(toggle).not.toBeChecked();
  await expect(cones).toHaveCount(0);
  await expect(summary).toHaveCount(0);

  await toggle.focus();
  await toggle.press('Space');
  await expect(toggle).toBeChecked();
  await expect(cones).toHaveCount(10);
  await expect(page.locator('.polo-vision-cone.polo-vision-red')).toHaveCount(5);
  await expect(summary).toHaveText(
    'Sight cones: 135° · 24 m. Ball in sight cone: Blue 1, 2, 3, 4, 5; Red 1, 2, 3, 4, 5.',
  );
  await expect(cones.first()).toHaveAttribute('d', /A 24 24 0 0 1/);
  await expect(cones.first()).toHaveAttribute(
    'transform',
    await page.locator('[data-player-id="0"]').getAttribute('transform'),
  );
  await expect(cones.last()).toHaveAttribute(
    'transform',
    await page.locator('[data-player-id="9"]').getAttribute('transform'),
  );

  await toggle.press('Space');
  await expect(toggle).not.toBeChecked();
  await expect(cones).toHaveCount(0);
});

test('a manually controlled player can turn their vision without turning the boat', async ({
  page,
}) => {
  await page.goto('/projects/canoe-polo/');
  const start = page.getByRole('button', { name: 'Start new match' });
  await expect(start).toBeEnabled();
  await page.getByText('Player controls', { exact: true }).click();
  await page.getByLabel('Control player').selectOption('0');
  await page.getByRole('checkbox', { name: 'Show player vision' }).check();
  const boat = page.locator('[data-player-id="0"]');
  const cone = page.locator('.polo-vision-cone').first();
  const hullTransform = await boat.getAttribute('transform');
  await expect(boat.locator('.polo-controlled-boat')).toHaveCount(1);
  await expect(cone).toHaveAttribute('transform', hullTransform);

  await start.click();
  await page.getByLabel('Look', { exact: true }).selectOption('1');
  await expect(cone).not.toHaveAttribute('transform', hullTransform);
  await expect(boat).toHaveAttribute('transform', hullTransform);
});
