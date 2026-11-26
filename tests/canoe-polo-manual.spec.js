import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { chooseGeneration } from './generation-picker.js';

test('takes over one player during a match and hands it back without a restart', async ({
  page,
}) => {
  await page.goto('/projects/canoe-polo/');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Generation 0' }).click();
  const data = JSON.parse(await readFile(await (await download).path(), 'utf8'));
  const [genesis] = data.generations;
  const weights = genesis.weights.map(() => 0);
  weights[0] = 20; // A fixed policy that keeps both AI teams stationary.
  const coast = { ...genesis, id: 'coast-test', number: 1, parentId: genesis.id, weights };
  const importFile = page.getByLabel('Generation file (JSON)');
  await expect(importFile).toBeEnabled();
  await importFile.setInputFiles({
    name: 'coast.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...data, generations: [coast] })),
  });
  await expect(page.getByText(/Imported 1 generation\. Saved on this device/)).toBeVisible();

  await chooseGeneration(page, 'Blue team', coast);
  await chooseGeneration(page, 'Red team', coast);
  await page.getByRole('button', { name: 'Start new match' }).click();
  const pitch = page.getByRole('img', { name: /Top-down canoe polo pitch/ });
  const player = pitch.locator('[data-player-id="2"]');
  const teammate = pitch.locator('[data-player-id="1"]');
  const before = await player.getAttribute('transform');
  const teammateBefore = await teammate.getAttribute('transform');
  const ball = pitch.locator('circle.ball');
  const ballBefore = await ball.getAttribute('cx');

  await page.getByText('Player controls', { exact: true }).click();
  const control = page.getByLabel('Control player');
  await expect(control).toHaveValue('-1');
  await control.selectOption({ label: 'Blue 3' });
  await expect(pitch.locator('.polo-controlled-boat')).toHaveCount(1);
  await expect(player.locator('.polo-controlled-boat')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Throw', exact: true })).toBeDisabled();
  await page.getByLabel('Look', { exact: true }).selectOption('1');
  await expect(player.locator('.helmet')).toHaveAttribute('cy', /[1-9]/);
  await page.getByRole('button', { name: 'Grab or catch' }).click();
  await expect(ball).toHaveAttribute('cx', ballBefore);
  await page.getByRole('button', { name: 'Paddle left' }).click();
  await expect(player).not.toHaveAttribute('transform', before);
  await expect(teammate).toHaveAttribute('transform', teammateBefore);

  await page.getByRole('button', { name: 'Pause match' }).click();
  const pausedPose = await player.getAttribute('transform');
  await control.selectOption('-1');
  await expect(pitch.locator('.polo-controlled-boat')).toHaveCount(0);
  await expect(player).toHaveAttribute('transform', pausedPose);
  await expect(page.getByRole('button', { name: 'Resume match' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Paddle left' })).toHaveCount(0);
});
