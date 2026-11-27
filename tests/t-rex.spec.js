import { expect, test } from '@playwright/test';

test('T. rex is third and its SVG fits the viewport', async ({ page }) => {
  await page.goto('/projects/');
  const projects = page.locator('main article');
  await expect(projects.nth(2).getByRole('heading')).toHaveText('T. rex');
  await projects.nth(2).getByRole('link', { name: 'Explore T. rex' }).click();
  await expect(page).toHaveURL(/\/projects\/t-rex\/?$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('T. rex');

  const artwork = page.getByRole('img', { name: /Tyrannosaurus rex seen from above/ });
  await expect(artwork).toBeVisible();
  await expect(artwork).toHaveJSProperty('naturalWidth', 420);
  const bounds = await artwork.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width);
});

test('T. rex opens directly as a prerendered page', async ({ page }) => {
  const response = await page.goto('/projects/t-rex/');
  expect(response.status()).toBe(200);
  await expect(page).toHaveTitle('T. rex | Made by Marcel');
  await expect(page.getByRole('img', { name: /Tyrannosaurus rex seen from above/ })).toBeVisible();
});

test('a learned replay uses the overhead rig and keeps shins and feet behind thighs', async ({
  page,
}) => {
  await page.goto('/projects/t-rex/');
  await page.getByRole('button', { name: 'Watch learned demo' }).click();
  const view = page.getByRole('img', { name: /Tyrannosaurus rex walking/ });
  await expect(view).toBeVisible();
  const tail = view.locator('[data-bone^="tail-"]');
  await expect(tail).toHaveCount(6);
  const tip = tail.last();
  const initial = await tip.getAttribute('d');
  await expect(tip).not.toHaveAttribute('d', initial);
  const order = await view.locator('path').evaluateAll((nodes) => nodes.map((n) => n.dataset.bone));
  expect(order.indexOf('toes1')).toBeLessThan(order.indexOf('thigh1'));
  const side = page.getByRole('img', { name: 'Side view of the physical skeleton' });
  await expect(side.locator('[data-bone^="tail-"]')).toHaveCount(6);
});

test('the T. rex worker trains independently and enables a local replay', async ({ page }) => {
  await page.goto('/projects/t-rex/');
  const best = page.getByRole('button', { name: 'Watch your best' });
  await expect(best).toBeDisabled();
  await page.getByRole('button', { name: 'Start training' }).click();
  await expect(best).toBeEnabled({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Pause training' }).click();
  await best.click();
  await expect(page.getByRole('img', { name: /Tyrannosaurus rex walking/ })).toBeVisible();
});
