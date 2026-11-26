/* global document, window */
import { expect, test } from '@playwright/test';

test('opens biped, pauses playback, trains, and plays the selected skill’s best attempt', async ({
  page,
}) => {
  await page.goto('/projects/');
  await page.getByRole('link', { name: 'Explore biped robot' }).click();
  await expect(page.getByRole('heading', { name: 'Biped robot' })).toBeVisible();
  const viewer = page.getByRole('region', { name: 'Walk' });
  const walk = page.getByRole('button', { name: 'Walk', exact: true });
  await expect(viewer.getByRole('img', { name: /Walk scene/ })).toBeVisible();
  await expect(walk).toHaveAccessibleDescription(/High score:\s*—.*0 training sessions/);

  await viewer.getByRole('button', { name: 'Play', exact: true }).click();
  await viewer.getByRole('button', { name: 'Pause', exact: true }).click();
  const summary = viewer.getByTestId('biped-replay-summary');
  await expect(summary).toContainText('Baseline');
  await expect(viewer.getByRole('button', { name: 'Play', exact: true })).toBeEnabled();

  const start = viewer.getByRole('button', { name: 'Start training' });
  await start.click();
  await expect(walk).toHaveAccessibleDescription(/High score:\s*\d\/5 passed/, {
    timeout: 20000,
  });
  await viewer.getByRole('button', { name: 'Pause training' }).click();
  await expect(walk).toHaveAccessibleDescription(/1 training session$/);
  await walk.click();
  await expect(summary).toContainText(/Iteration\s*[1-9]\d*/);

  await viewer.getByText('Training & replay options', { exact: true }).click();
  await viewer.getByRole('checkbox', { name: 'Show sensors' }).check();
  await expect(viewer.getByText(/Far leg:/)).toBeVisible();
  await viewer.getByLabel('Test start').selectOption('1');
  const restart = viewer.getByRole('button', { name: 'Restart selected skill' });
  await viewer.getByRole('spinbutton', { name: 'Restart seed' }).fill('0');
  await expect(restart).toBeDisabled();
  await viewer.getByRole('spinbutton', { name: 'Restart seed' }).fill('2');
  await restart.click();
  await expect(viewer.getByText('Iteration 0 (seed 2)', { exact: false })).toBeVisible();
  await expect(walk).toHaveAccessibleDescription(/0 training sessions$/);
});

test('moves the skills below the viewer on mobile without page overflow', async ({ page }) => {
  await page.goto('/projects/biped/');
  const viewer = page.getByRole('region', { name: 'Walk' });
  const skills = page.getByRole('complementary', { name: 'Skills' });
  await expect(viewer.getByRole('button', { name: 'Start training' })).toBeEnabled();
  const [view, list] = await Promise.all([viewer.boundingBox(), skills.boundingBox()]);
  if ((await page.evaluate(() => window.innerWidth)) >= 832) {
    expect(list.x).toBeGreaterThanOrEqual(view.x + view.width);
    expect(view.width).toBeGreaterThan(list.width);
  } else {
    expect(list.y).toBeGreaterThanOrEqual(view.y + view.height);
    const last = skills.getByRole('button', { name: 'Get up', exact: true });
    await last.evaluate((button) => button.scrollIntoView({ block: 'start' }));
    await last.click();
    await expect(page.getByRole('img', { name: /Get up scene/ })).toBeInViewport({ ratio: 0.9 });
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth),
  );
});

test('switches scenes immediately, counts isolated training, and plays parkour in the viewer', async ({
  page,
}) => {
  await page.goto('/projects/biped/');
  const parkour = page.getByRole('button', { name: 'Run parkour' });
  await expect(parkour).toBeDisabled();
  const train = page.getByRole('button', { name: 'Start training' });
  const pause = page.getByRole('button', { name: 'Pause training', exact: true });
  await page.getByText('Training & replay options', { exact: true }).click();
  await page.getByRole('button', { name: 'Train all skills' }).click();
  await expect(page.getByText('Training Walk', { exact: true })).toBeVisible();
  const walk = page.getByRole('button', { name: 'Walk', exact: true });
  await expect(walk).toHaveAccessibleDescription(/High score:\s*\d\/5 passed/, {
    timeout: 20000,
  });
  await pause.click();
  await expect(train).toBeEnabled();
  for (const [name, tiles] of [
    ['Run', 1],
    ['Jump', 2],
    ['Climb stairs', 4],
    ['Get up', 1],
  ]) {
    const skill = page.getByRole('button', { name, exact: true });
    await skill.click();
    await expect(skill).toHaveAttribute('aria-pressed', 'true');
    const scene = page.getByRole('img', { name: new RegExp(name + ' scene') });
    await expect(scene.locator('rect.floor')).toHaveCount(tiles);
    if (name === 'Run') {
      await expect(skill).toHaveAccessibleDescription(/No valid run yet/);
      await expect(page.getByTestId('biped-replay-summary')).toContainText('m/s avg');
      await expect(page.getByTestId('biped-replay-summary')).toContainText('airborne strides');
    }
    await expect(skill).toHaveAccessibleDescription(/0 training sessions$/);
    await train.click();
    await expect(skill).toHaveAccessibleDescription(/High score:\s*\d\/5 passed/, {
      timeout: 20000,
    });
    await pause.click();
    await expect(skill).toHaveAccessibleDescription(/1 training session$/);
    await expect(train).toBeEnabled();
  }
  await parkour.click();
  const course = page.getByRole('region', { name: 'Parkour' });
  await expect(course).toBeVisible();
  await expect(course.getByTestId('biped-result')).not.toBeEmpty({ timeout: 17000 });
  await expect(course.getByRole('button', { name: 'Replay', exact: true })).toBeEnabled();
  await walk.click();
  await expect(walk).toHaveAccessibleDescription(/1 training session$/);
  await expect(page.getByTestId('biped-replay-summary')).toContainText(/Iteration\s*[1-9]\d*/);
});
