import { expect, test, type Download, type Locator, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
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
  await expect(page.locator('#status-version')).toHaveText('Ver.1.1.0');
  await expect(page).toHaveTitle('FrameModeler Web v1.1.0');
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
  await expect(page.locator('#btn-undo')).toHaveAttribute('title', '元に戻す: 節点追加');

  await page.locator('#btn-lang').click();
  await expect(page.locator('#btn-undo')).toHaveAttribute('title', 'Undo: Add node');

  await page.locator('#btn-undo').click();
  await expect(page.locator('#status-info')).toContainText('N:0 M:0 P:0');
  await expect(page.locator('#cad-canvas')).toHaveAttribute('data-selected-count', '0');
  await expect(page.locator('#btn-redo')).toBeEnabled();
  await expect(page.locator('#btn-redo')).toHaveAttribute('title', 'Redo: Add node');
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
  await expect(page.locator('#btn-undo')).toHaveAttribute('title', '元に戻す: 節点追加');
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
  await expect(page.locator('#btn-undo')).toHaveAttribute('title', '元に戻す: 選択要素削除');

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

test('数字キーでツールを切り替え、全選択と選択反転を行う', async ({ page }) => {
  await loadSample(page, PILLAR_SAMPLE, 'N:19 M:12 P:0');
  const canvas = page.locator('#cad-canvas');

  await page.keyboard.press('9');
  await expect(page.locator('#btn-measure')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('4');
  await expect(page.locator('#btn-add-beam')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('1');
  await expect(page.locator('#btn-select')).toHaveAttribute('aria-pressed', 'true');

  // 平面表示では現在の階にある要素だけ、3Dではモデル全体が対象になる。
  await page.keyboard.press('Control+a');
  const planCount = Number(await canvas.getAttribute('data-selected-count'));
  expect(planCount).toBeGreaterThan(0);
  expect(planCount).toBeLessThan(31);

  await page.locator('#btn-view-isometric').click();
  await page.keyboard.press('Control+a');
  await expect(canvas).toHaveAttribute('data-selected-count', '31');
  await expect(page.locator('#status-info')).toContainText('S:31');

  await page.keyboard.press('Control+i');
  await expect(canvas).toHaveAttribute('data-selected-count', '0');

  await page.locator('#edit-menu > summary').click();
  await page.locator('#btn-invert-selection').click();
  await expect(canvas).toHaveAttribute('data-selected-count', '31');
  await expect(page.locator('#edit-menu')).not.toHaveAttribute('open');
});

test('配列複写で梁を繰り返し複写し、1回のUndoで戻す', async ({ page }) => {
  await addBeam(page, [0, 0, 0], [6000, 0, 0]);
  await expect(page.locator('#status-info')).toContainText('N:2 M:1 P:0');

  await page.keyboard.press('1');
  await page.keyboard.press('Control+a');
  await expect(page.locator('#cad-canvas')).toHaveAttribute('data-selected-count', '3');

  await page.keyboard.press('Control+d');
  const dialog = page.getByRole('dialog', { name: '配列複写' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('ΔX・ΔY・ΔZのいずれかを0以外にしてください');

  await dialog.getByLabel('ΔY (mm)').fill('4000');
  await dialog.getByLabel('個数').fill('2');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator('#status-info')).toContainText('N:6 M:3 P:0');
  await expect(page.locator('#status-info')).toContainText('4節点、2要素を追加しました');
  await expect(page.locator('#btn-undo')).toHaveAttribute('title', '元に戻す: 配列複写');

  // 同じ条件で再実行しても、複写先に同じ要素があるため増えない。
  await page.locator('#edit-menu > summary').click();
  await page.locator('#btn-array-copy').click();
  await expect(dialog.getByLabel('ΔY (mm)')).toHaveValue('4000');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('#status-info')).toContainText('N:6 M:3 P:0');
  await expect(page.locator('#status-info')).toContainText('追加はありませんでした');

  await page.locator('#btn-undo').click();
  await expect(page.locator('#status-info')).toContainText('N:2 M:1 P:0');
  await page.locator('#btn-redo').click();
  await expect(page.locator('#status-info')).toContainText('N:6 M:3 P:0');
});

test('計測ツールで距離と各軸の差分を表示する', async ({ page }) => {
  const status = page.locator('#status-info');
  await page.locator('#btn-measure').click();

  await enterCoordinate(page, 0, 0, 0);
  await expect(status).toContainText('1点目選択済み');
  await enterCoordinate(page, 3000, 4000, 0);
  await expect(status).toContainText('距離 5000.0 mm（ΔX 3000.0 / ΔY 4000.0 / ΔZ 0.0）');
  await expect(status).not.toContainText('1点目選択済み');
  // 計測はモデルを変更しない。
  await expect(status).toContainText('N:0 M:0 P:0');
  await expect(page.locator('#btn-undo')).toBeDisabled();

  await page.locator('#btn-lang').click();
  await expect(status).toContainText('Distance 5000.0 mm (ΔX 3000.0 / ΔY 4000.0 / ΔZ 0.0)');

  await page.keyboard.press('Escape');
  await expect(status).not.toContainText('Distance');
});

test('重複節点を結合し、孤立節点を削除する', async ({ page }) => {
  const status = page.locator('#status-info');
  await addBeam(page, [0, 0, 0], [6000, 0, 0]);
  await addBeam(page, [0.8, 0, 0], [0.8, 4000, 0]);
  await addNode(page, 3000, 3000, 0);
  await expect(status).toContainText('N:5 M:2 P:0');

  await page.locator('#edit-menu > summary').click();
  await page.locator('#btn-merge-nodes').click();
  const dialog = page.getByRole('dialog', { name: '重複節点の結合' });
  await expect(dialog.getByLabel('許容距離 (mm)')).toHaveValue('1');
  await dialog.getByRole('button', { name: 'OK' }).click();
  await expect(status).toContainText('N:4 M:2 P:0');
  await expect(status).toContainText('1個の節点を結合し、重複した0要素を削除しました');
  await expect(page.locator('#btn-undo')).toHaveAttribute('title', '元に戻す: 重複節点結合');

  const confirmed = handleNextConfirm(page, true);
  await page.locator('#edit-menu > summary').click();
  await page.locator('#btn-remove-orphans').click();
  await expect(confirmed).resolves.toContain('節点1個を削除しますか');
  await expect(status).toContainText('N:3 M:2 P:0');
  await expect(status).toContainText('孤立節点を1個削除しました');

  await page.locator('#btn-undo').click();
  await page.locator('#btn-undo').click();
  await expect(status).toContainText('N:5 M:2 P:0');
});

test('数量集計を表示し、CSV・PNG・DXFを保存する', async ({ page }) => {
  await loadSample(page, PILLAR_SAMPLE, 'N:19 M:12 P:0');

  await page.locator('#export-menu > summary').click();
  await page.locator('#btn-summary').click();
  const dialog = page.getByRole('dialog', { name: '数量集計' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('row', { name: /^節点\s*19$/ })).toBeVisible();
  await expect(dialog.getByRole('row', { name: /^合計\s+12\s/ })).toBeVisible();

  const summary = await saveDownload(page, () => dialog.getByRole('button', { name: 'CSVを保存' }).click());
  expect(summary.name).toBe('pillar_test_summary.csv');
  expect(summary.content.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  expect(summary.content.toString('utf8')).toContain('種別,断面,数,延長 (m),面積 (m²)');
  await dialog.getByRole('button', { name: '閉じる' }).click();
  await expect(dialog).toBeHidden();

  const nodes = await saveDownload(page, () => clickExport(page, '#btn-export-nodes-csv'));
  expect(nodes.name).toBe('pillar_test_nodes.csv');
  expect(nodes.content.toString('utf8').trim().split('\r\n')).toHaveLength(20);

  const elements = await saveDownload(page, () => clickExport(page, '#btn-export-elements-csv'));
  expect(elements.name).toBe('pillar_test_elements.csv');
  expect(elements.content.toString('utf8').trim().split('\r\n')).toHaveLength(13);

  const dxf = await saveDownload(page, () => clickExport(page, '#btn-export-dxf'));
  expect(dxf.name).toMatch(/^pillar_test_.+\.dxf$/);
  const dxfText = dxf.content.toString('latin1');
  expect(dxfText).toContain('AC1009');
  expect(dxfText).toContain('CIRCLE');
  expect(dxfText.endsWith('0\r\nEOF\r\n')).toBe(true);

  await page.locator('#btn-view-isometric').click();
  const wholeModel = await saveDownload(page, () => clickExport(page, '#btn-export-dxf'));
  expect(wholeModel.name).toBe('pillar_test.dxf');
  expect(wholeModel.content.toString('latin1')).not.toContain('CIRCLE');

  const png = await saveDownload(page, () => clickExport(page, '#btn-export-png'));
  expect(png.name).toBe('pillar_test.png');
  expect(png.content.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  // 単色の空画像ではなく、モデルが描かれた画像であること。
  expect(png.content.length).toBeGreaterThan(5000);
  await expect(page.locator('#status-info')).toContainText('pillar_test.png を保存しました');
  // 出力はモデルを変更しない。
  await expect(page.locator('#status-version')).not.toContainText('*');
});

test('レイヤー操作の文言を言語切替へ追随させ、メニューを外側クリックで閉じる', async ({ page }) => {
  await loadSample(page, PILLAR_SAMPLE, 'N:19 M:12 P:0');
  const visibility = page.locator('#layer-list > li').first().locator('[data-action="visibility"]');
  await expect(visibility).toHaveAttribute('aria-label', 'レイヤーを非表示');
  await expect(page.locator('#btn-duplicate-layer')).toHaveAttribute('title', 'レイヤー複製');

  await page.locator('#btn-lang').click();
  await expect(visibility).toHaveAttribute('aria-label', 'Hide layer');
  await expect(page.locator('#btn-duplicate-layer')).toHaveAttribute('title', 'Duplicate layer');
  await expect(page.locator('#btn-measure')).toHaveText('Measure');
  await expect(page.locator('#edit-menu > summary')).toHaveText('Edit');

  await page.locator('#edit-menu > summary').click();
  await expect(page.locator('#edit-menu')).toHaveAttribute('open', '');
  await page.locator('#export-menu > summary').click();
  await expect(page.locator('#edit-menu')).not.toHaveAttribute('open');
  await expect(page.locator('#export-menu')).toHaveAttribute('open', '');
  await page.locator('#cad-canvas').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#export-menu')).not.toHaveAttribute('open');
});

async function loadSample(page: Page, file: string, expectedCounts: string): Promise<void> {
  await page.locator('#file-input').setInputFiles(file);
  await expect(page.locator('#status-info')).toContainText(expectedCounts);
  await settleRendering(page);
}

async function enterCoordinate(page: Page, x: number, y: number, z: number): Promise<void> {
  await page.locator('#input-coordinate-x').fill(String(x));
  await page.locator('#input-coordinate-y').fill(String(y));
  await page.locator('#input-coordinate-z').fill(String(z));
  await page.locator('#btn-coordinate-commit').click();
}

async function addNode(page: Page, x: number, y: number, z: number): Promise<void> {
  await page.locator('#btn-add-node').click();
  await enterCoordinate(page, x, y, z);
}

/** 座標入力で梁を追加し、追加直後に開くプロパティダイアログを既定値のまま閉じる。 */
async function addBeam(page: Page, from: [number, number, number], to: [number, number, number]): Promise<void> {
  await page.locator('#btn-add-beam').click();
  await enterCoordinate(page, ...from);
  await enterCoordinate(page, ...to);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'キャンセル' }).click();
  await expect(dialog).toBeHidden();
}

async function clickExport(page: Page, selector: string): Promise<void> {
  await page.locator('#export-menu > summary').click();
  await page.locator(selector).click();
}

async function saveDownload(page: Page, trigger: () => Promise<void>): Promise<{ name: string; content: Buffer }> {
  const [download] = await Promise.all([page.waitForEvent('download') as Promise<Download>, trigger()]);
  const path = await download.path();
  return { name: download.suggestedFilename(), content: await readFile(path) };
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
