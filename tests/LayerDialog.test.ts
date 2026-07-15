// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { Layer } from '../src/data/Layer';
import { setLocale } from '../src/i18n';
import { showLayerDialog } from '../src/ui/dialogs/LayerDialog';

afterEach(() => {
  document.body.replaceChildren();
  setLocale('ja');
});

describe('showLayerDialog', () => {
  it('keeps non-editable visibility and lock flags when name or elevation is edited', async () => {
    const source = new Layer(0, '1F', { visible: false, locked: true });
    const resultPromise = showLayerDialog(source);
    const inputs = document.querySelectorAll<HTMLInputElement>('.modal-dialog input');
    inputs[0].value = '基準階';
    inputs[1].value = '1250';

    document.querySelector<HTMLButtonElement>('.modal-dialog .primary')!.click();

    await expect(resultPromise).resolves.toMatchObject({
      name: '基準階',
      posZ: 1250,
      visible: false,
      locked: true,
    });
  });
});
