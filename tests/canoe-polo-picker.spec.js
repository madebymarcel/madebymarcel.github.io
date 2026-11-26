import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { chooseGeneration, generationPicker } from './generation-picker.js';

test('generation picker keeps its rows and scroll position when training adds a snapshot', async ({
  page,
}) => {
  // Deliver a real-shaped worker message on demand rather than race the training speed.
  await page.addInitScript(() => {
    globalThis.Worker = class {
      constructor() {
        globalThis.testTrainingWorker = this;
      }
      postMessage() {}
      terminate() {}
    };
  });
  await page.goto('/projects/canoe-polo/');
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download Generation 0' }).click();
  const data = JSON.parse(await readFile(await (await pending).path(), 'utf8'));
  const [genesis] = data.generations;
  const generations = Array.from({ length: 30 }, (_, index) => ({
    ...genesis,
    id: 'picker-' + (index + 1),
    number: index + 1,
    parentId: genesis.id,
  }));
  const input = page.getByLabel('Generation file (JSON)');
  await expect(input).toBeEnabled();
  await input.setInputFiles({
    name: 'picker.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify({ ...data, generations })),
  });
  await expect(page.getByText(/Imported 30 generations\. Saved on this device/)).toBeVisible();
  await chooseGeneration(page, 'Train from', generations.at(-1));
  await page.getByRole('button', { name: 'Start or resume training' }).click();
  await expect(generationPicker(page, 'Train from')).toBeDisabled();

  const blue = generationPicker(page, 'Blue team');
  await blue.click();
  const picker = page.getByRole('dialog', { name: 'Choose Blue team' });
  const list = picker.getByRole('list');
  await expect(list.getByRole('listitem')).toHaveCount(31);
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2;
  });
  const before = await list.evaluate((element) => element.scrollTop);
  expect(before).toBeGreaterThan(0);
  await page.evaluate(
    (generation) => {
      globalThis.testTrainingWorker.onmessage({ data: { kind: 'generation', generation } });
    },
    { ...genesis, id: 'picker-31', number: 31, parentId: 'picker-30' },
  );
  await expect(page.locator('#generations-heading')).toHaveText('Generations (32)');
  await expect(list.getByRole('listitem')).toHaveCount(31);
  expect(await list.evaluate((element) => element.scrollTop)).toBe(before);
  await picker.getByRole('button', { name: 'Generation 15 · picker-1', exact: true }).click();
  await expect(blue).toContainText('Generation 15');
  await blue.click();
  await expect(list.getByRole('listitem')).toHaveCount(32);
  await expect(list.getByRole('button', { name: 'Generation 31 · picker-3' })).toBeVisible();
  await picker.getByRole('button', { name: 'Cancel' }).click();

  await chooseGeneration(page, 'Red team', generations[5]);
  await expect(generationPicker(page, 'Red team')).toContainText('Generation 6');
  await page.getByRole('button', { name: 'Pause training' }).click();
  await expect(generationPicker(page, 'Train from')).toContainText('Generation 31');
});
