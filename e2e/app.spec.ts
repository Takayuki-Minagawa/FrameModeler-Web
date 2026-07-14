import { expect, test, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const PILLAR_SAMPLE = fileURLToPath(new URL('../sample-data/pillar_test.json', import.meta.url));
const FULL_SAMPLE = fileURLToPath(new URL('../sample-data/test.json', import.meta.url));

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await expect(page.locator('#cad-canvas')).toBeVisible();
  await expect
    .poll(() => page.locator('#cad-canvas').evaluate((canvas: HTMLCanvasElement) => canvas.width * canvas.height))
    .toBeGreaterThan(0);
});

test('サンプルJSONを読み込み、モデル件数とレイヤーを反映する', async ({ page }) => {
  await loadSample(page, PILLAR_SAMPLE, 'N:19 M:12 P:0');

  await expect(page.locator('#layer-list > li')).toHaveCount(2);
  await expect(page.locator('#status-version')).toHaveText('Ver.1.0.0');
  await expect(page).toHaveTitle('FrameModeler Web v1.0.0');
});

test('dirtyモデルのNew/Openを確認し、拒否時はモデルを保持する', async ({ page }) => {
  await loadSample(page, PILLAR_SAMPLE, 'N:19 M:12 P:0');
  await addNode(page, 250, 150, 0);
  await expect(page.locator('#status-info')).toContainText('N:20');
  await expect(page.locator('#status-version')).toContainText('*');

  const rejectedNew = handleNextConfirm(page, false);
  await page.locator('#btn-new').click();
  await expect(rejectedNew).resolves.toMatch(/破棄|未保存/);
  await expect(page.locator('#status-info')).toContainText('N:20');

  const acceptedNew = handleNextConfirm(page, true);
  await page.locator('#btn-new').click();
  await expect(acceptedNew).resolves.toMatch(/破棄|未保存/);
  await expect(page.locator('#status-info')).toContainText('N:0 M:0 P:0');
  await expect(page.locator('#cad-canvas')).toHaveAttribute('data-selected-count', '0');
  await expect(page.locator('#status-version')).not.toContainText('*');

  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('#file-input');
    input?.addEventListener('click', () => {
      const root = document.documentElement;
      root.dataset.openInvocations = String(Number(root.dataset.openInvocations ?? '0') + 1);
    });
  });
  await addNode(page, 400, 0, 0);

  const rejectedOpen = handleNextConfirm(page, false);
  await page.locator('#btn-open').click();
  await expect(rejectedOpen).resolves.toContain('未保存');
  await expect(page.locator('html')).not.toHaveAttribute('data-open-invocations', '1');
  await expect(page.locator('#status-info')).toContainText('N:1');

  const chooserPromise = page.waitForEvent('filechooser');
  const acceptedOpen = handleNextConfirm(page, true);
  await page.locator('#btn-open').click();
  await expect(acceptedOpen).resolves.toContain('未保存');
  const chooser = await chooserPromise;
  await chooser.setFiles(PILLAR_SAMPLE);
  await expect(page.locator('#status-info')).toContainText('N:19 M:12 P:0');
  await expect(page.locator('#cad-canvas')).toHaveAttribute('data-selected-count', '0');
  await expect(page.locator('html')).toHaveAttribute('data-open-invocations', '1');
  await expect(page.locator('#status-version')).not.toContainText('*');
});

test('座標入力の編集をUndo/Redoできる', async ({ page }) => {
  await addNode(page, 125, 75, 0);
  await expect(page.locator('#status-info')).toContainText('N:1 M:0 P:0');
  await expect(page.locator('#btn-undo')).toBeEnabled();

  await page.locator('#btn-undo').click();
  await expect(page.locator('#status-info')).toContainText('N:0 M:0 P:0');
  await expect(page.locator('#cad-canvas')).toHaveAttribute('data-selected-count', '0');
  await expect(page.locator('#btn-redo')).toBeEnabled();
  await expect(page.locator('#status-version')).not.toContainText('*');

  await page.locator('#btn-redo').click();
  await expect(page.locator('#status-info')).toContainText('N:1 M:0 P:0');
  await expect(page.locator('#status-version')).toContainText('*');
});

test('2D screen-spaceと3D Raycasterの両方で要素を選択する', async ({ page }) => {
  await loadSample(page, FULL_SAMPLE, 'N:88 M:69 P:18');
  const canvas = page.locator('#cad-canvas');

  await selectVisibleElement(canvas);
  await expect(canvas).toHaveAttribute('data-selected-count', /[1-9]\d*/);

  await clearSelection(canvas);
  await page.locator('#btn-view-isometric').click();
  await expect(page.locator('#chk-3d')).toBeChecked();
  await page.keyboard.press('Home');
  await settleRendering(page);

  await selectVisibleElement(canvas);
  await expect(canvas).toHaveAttribute('data-selected-count', /[1-9]\d*/);

  await page.locator('#btn-new').click();
  await expect(canvas).toHaveAttribute('data-selected-count', '0');
});

test('作図anchor・失敗理由を表示し、取消時にoperation statusを解除する', async ({ page }) => {
  const canvas = page.locator('#cad-canvas');
  const status = page.locator('#status-info');

  await page.locator('#btn-add-beam').click();
  await page.locator('#input-coordinate-x').fill('0');
  await page.locator('#input-coordinate-y').fill('0');
  await page.locator('#input-coordinate-z').fill('0');
  await page.locator('#btn-coordinate-commit').click();
  await expect(canvas).toHaveAttribute('data-operation-status', 'firstPointSelected');
  await expect(status).toContainText('1点目選択済み');

  await page.keyboard.press('Escape');
  await expect(canvas).not.toHaveAttribute('data-operation-status');
  await expect(status).not.toContainText('1点目選択済み');

  await page.locator('#btn-add-pillar').click();
  await page.locator('#btn-coordinate-commit').click();
  await expect(canvas).toHaveAttribute('data-operation-status', 'noPointAbove');
  await expect(status).toContainText('直上の節点または部材が見つかりません');

  await page.locator('#btn-lang').click();
  await expect(status).toContainText('No node or member was found directly above');
  await page.keyboard.press('Escape');
  await expect(canvas).not.toHaveAttribute('data-operation-status');
});

test('DeleteとUndo後に選択件数をcanvas・statusへ再同期する', async ({ page }) => {
  await addNode(page, 0, 0, 0);
  await expect(page.locator('#status-info')).toContainText('N:1 M:0 P:0');
  await expect(page.locator('#btn-undo')).toHaveAttribute('title', 'Undo: 節点追加');
  await page.locator('#btn-select').click();
  const canvas = page.locator('#cad-canvas');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('CAD canvas is not visible');
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await expect(canvas).toHaveAttribute('data-selected-count', '1');

  const acceptedDelete = handleNextConfirm(page, true);
  await page.locator('#btn-delete').click();
  await expect(acceptedDelete).resolves.toMatch(/削除|Delete/);
  await expect(page.locator('#status-info')).toContainText('N:0 M:0 P:0 S:0');
  await expect(canvas).toHaveAttribute('data-selected-count', '0');
  await expect(page.locator('#btn-undo')).toHaveAttribute('title', 'Undo: 選択要素削除');

  await page.locator('#btn-undo').click();
  await expect(page.locator('#status-info')).toContainText('N:1 M:0 P:0 S:0');
  await expect(canvas).toHaveAttribute('data-selected-count', '0');
});

test('viewport resizeとテーマ永続化を反映する', async ({ page }) => {
  await loadSample(page, PILLAR_SAMPLE, 'N:19 M:12 P:0');
  const canvas = page.locator('#cad-canvas');
  const initial = await canvasMetrics(canvas);

  await page.setViewportSize({ width: 960, height: 700 });
  await expect
    .poll(() => canvasMetrics(canvas), { message: 'canvas backing buffer follows its resized container' })
    .toMatchObject({ matchesContainer: true, hasBackingBuffer: true });
  const resized = await canvasMetrics(canvas);
  expect(resized.cssWidth).not.toBe(initial.cssWidth);

  await page.locator('#btn-theme').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#cad-view-container')).toHaveCSS('background-color', 'rgb(26, 26, 26)');
  expect(await page.evaluate(() => localStorage.getItem('framemodeler-theme'))).toBe('dark');

  await page.reload();
  await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('#cad-view-container')).toHaveCSS('background-color', 'rgb(26, 26, 26)');
});

test('WebGLモデル描画をvisual baselineと比較する', async ({ page }) => {
  const canvas = page.locator('#cad-canvas');
  await page.locator('#cad-view-container').evaluate((container: HTMLElement) => {
    container.style.flex = '0 0 1060px';
    container.style.width = '1060px';
    container.style.height = '596px';
  });
  await expect
    .poll(() => canvasMetrics(canvas), { message: 'visual canvas uses the deterministic baseline size' })
    .toMatchObject({ cssWidth: 1060, cssHeight: 596, matchesContainer: true, hasBackingBuffer: true });

  await loadSample(page, FULL_SAMPLE, 'N:88 M:69 P:18');
  await page.locator('#chk-grid').uncheck();
  await page.locator('#btn-view-isometric').click();
  await page.keyboard.press('Home');
  await settleRendering(page);

  await expect(canvas).toHaveScreenshot('webgl-full-model.png', {
    animations: 'disabled',
    maxDiffPixelRatio: 0.035,
    threshold: 0.25,
  });
});

async function loadSample(page: Page, file: string, expectedCounts: string): Promise<void> {
  await page.locator('#file-input').setInputFiles(file);
  await expect(page.locator('#status-info')).toContainText(expectedCounts);
  await settleRendering(page);
}

async function addNode(page: Page, x: number, y: number, z: number): Promise<void> {
  await page.locator('#btn-add-node').click();
  await page.locator('#input-coordinate-x').fill(String(x));
  await page.locator('#input-coordinate-y').fill(String(y));
  await page.locator('#input-coordinate-z').fill(String(z));
  await page.locator('#btn-coordinate-commit').click();
}

function handleNextConfirm(page: Page, accept: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    page.once('dialog', async (dialog) => {
      try {
        const message = dialog.message();
        expect(dialog.type()).toBe('confirm');
        if (accept) await dialog.accept();
        else await dialog.dismiss();
        resolve(message);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function clearSelection(canvas: Locator): Promise<void> {
  await canvas.click({ position: { x: 5, y: 5 } });
  await expect(canvas).toHaveAttribute('data-selected-count', '0');
}

/** 実canvasクリックだけで、中心付近の描画要素を探索する。 */
async function selectVisibleElement(canvas: Locator): Promise<void> {
  const box = await canvas.boundingBox();
  if (!box) throw new Error('CAD canvas is not visible');

  const offsets = [
    [0.5, 0.5],
    [0.45, 0.5],
    [0.55, 0.5],
    [0.5, 0.45],
    [0.5, 0.55],
    [0.4, 0.4],
    [0.6, 0.4],
    [0.4, 0.6],
    [0.6, 0.6],
    [0.35, 0.5],
    [0.65, 0.5],
  ] as const;

  for (const [fx, fy] of offsets) {
    await canvas.click({ position: { x: box.width * fx, y: box.height * fy } });
    const selected = Number(await canvas.getAttribute('data-selected-count'));
    if (selected > 0) return;
  }

  throw new Error('No rendered element was selectable near the canvas center');
}

async function canvasMetrics(canvas: Locator): Promise<{
  cssWidth: number;
  cssHeight: number;
  matchesContainer: boolean;
  hasBackingBuffer: boolean;
}> {
  return canvas.evaluate((element: HTMLCanvasElement) => {
    const rect = element.getBoundingClientRect();
    const parentRect = element.parentElement?.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    return {
      cssWidth: Math.round(rect.width),
      cssHeight: Math.round(rect.height),
      matchesContainer:
        !!parentRect && Math.abs(rect.width - parentRect.width) <= 1 && Math.abs(rect.height - parentRect.height) <= 1,
      hasBackingBuffer:
        element.width > 0 &&
        element.height > 0 &&
        Math.abs(element.width - rect.width * dpr) <= 2 &&
        Math.abs(element.height - rect.height * dpr) <= 2,
    };
  });
}

async function settleRendering(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}
