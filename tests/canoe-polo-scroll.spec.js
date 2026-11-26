import { expect, test } from '@playwright/test';

async function documentTop(locator) {
  return locator.evaluate((element) => element.getBoundingClientRect().top + globalThis.scrollY);
}

test.beforeEach(async ({ page, isMobile }) => {
  test.skip(!isMobile, 'Checks the single-column phone layout.');
  await page.clock.install();
  await page.addInitScript(() => {
    Math.random = () => 0.1;
  });
  await page.goto('/projects/canoe-polo/');
  await expect(page.getByRole('button', { name: 'Start new match' })).toBeEnabled();
});

test('the pitch stays in place through a background training generation', async ({ page }) => {
  const pitch = page.getByRole('img', { name: /Top-down canoe polo pitch/ });
  await page.getByLabel('Resource usage').selectOption('0');
  await page.getByRole('button', { name: 'Start new match' }).tap();
  await pitch.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const before = await documentTop(pitch);
  const scrollBefore = await page.evaluate(() => globalThis.scrollY);

  // Start training without scrolling up to its controls, as if it were already running.
  await page.getByRole('button', { name: 'Start or resume training' }).evaluate((el) => el.click());
  await expect(page.getByRole('heading', { name: 'Generations (1)', exact: true })).toHaveCount(0, {
    timeout: 20_000,
  });
  expect(await documentTop(pitch)).toBeCloseTo(before);
  expect(await page.evaluate(() => globalThis.scrollY)).toBe(scrollBefore);
});

test('referee decisions grow inside the log without moving the rest of the page', async ({
  page,
}) => {
  await page.getByLabel('Speed', { exact: true }).selectOption('16');
  const generations = page.getByRole('heading', { name: 'Generations (1)', exact: true });
  await generations.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  const before = await documentTop(generations);

  await page.getByRole('button', { name: 'Start new match' }).evaluate((el) => el.click());
  await page.clock.runFor(7_000);
  const decisions = page.getByRole('region', { name: 'Referee decisions' }).locator('ol');
  expect(await decisions.locator('li').count()).toBeGreaterThan(1);
  expect(await documentTop(generations)).toBeCloseTo(before);

  // The browser can still scroll back to controls outside the match.
  const training = page.getByRole('heading', { name: 'Background training' });
  await training.evaluate((element) => element.scrollIntoView({ block: 'center' }));
  await expect(training).toBeInViewport();
});

test('changing vision counts do not move the pitch in landscape', async ({ page }) => {
  await page.setViewportSize({ width: 760, height: 390 });
  await page.getByRole('checkbox', { name: 'Show player vision' }).check();
  await page.getByLabel('Speed', { exact: true }).selectOption('16');
  const pitch = page.getByRole('img', { name: /Top-down canoe polo pitch/ });
  const before = await documentTop(pitch);
  const summary = page.locator('.polo-vision-summary');
  const initial = await summary.innerText();
  await page.getByRole('button', { name: 'Start new match' }).evaluate((el) => el.click());

  let changed = false;
  for (let step = 0; step < 55; step++) {
    await page.clock.runFor(100);
    changed ||= (await summary.innerText()) !== initial;
    expect(await documentTop(pitch)).toBeCloseTo(before);
  }
  expect(changed).toBe(true);
});
