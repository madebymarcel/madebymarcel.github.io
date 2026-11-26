export function generationPicker(page, label) {
  return page.getByRole('button', { name: new RegExp('^' + label + ':') });
}

export async function chooseGeneration(page, label, generation) {
  const name =
    generation.number === 0
      ? 'Generation 0'
      : 'Generation ' + generation.number + ' · ' + generation.id.slice(0, 8);
  await generationPicker(page, label).click();
  await page
    .getByRole('dialog', { name: 'Choose ' + label, exact: true })
    .getByRole('button', { name, exact: true })
    .click();
}
