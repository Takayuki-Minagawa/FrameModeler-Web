/** モーダルダイアログのベースユーティリティ */

export interface DialogResult {
  ok: boolean;
}

/** モーダルオーバーレイを作成 */
export function createModalOverlay(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  return overlay;
}

/** ダイアログボックスを作成 */
export function createDialogBox(title: string): HTMLDivElement {
  const box = document.createElement('div');
  box.className = 'modal-dialog';
  const h3 = document.createElement('h3');
  h3.textContent = title;
  box.appendChild(h3);
  return box;
}

/** フォーム行を追加 */
export function addFormRow(container: HTMLElement, label: string, inputType: string, value: string, readonly: boolean = false): HTMLInputElement {
  const row = document.createElement('div');
  row.className = 'form-row';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  row.appendChild(lbl);

  const input = document.createElement('input');
  input.type = inputType;
  input.value = value;
  if (readonly) input.readOnly = true;
  row.appendChild(input);

  container.appendChild(row);
  return input;
}

/** セレクト行を追加 */
export function addSelectRow(container: HTMLElement, label: string, options: string[], selected: string): HTMLSelectElement {
  const row = document.createElement('div');
  row.className = 'form-row';

  const lbl = document.createElement('label');
  lbl.textContent = label;
  row.appendChild(lbl);

  const select = document.createElement('select');
  for (const opt of options) {
    const option = document.createElement('option');
    option.value = opt;
    option.textContent = opt;
    if (opt === selected) option.selected = true;
    select.appendChild(option);
  }
  row.appendChild(select);

  container.appendChild(row);
  return select;
}

/** OK/キャンセルボタン行を追加 */
export function addButtonRow(container: HTMLElement): { okBtn: HTMLButtonElement; cancelBtn: HTMLButtonElement } {
  const row = document.createElement('div');
  row.className = 'button-row';

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'キャンセル';
  row.appendChild(cancelBtn);

  const okBtn = document.createElement('button');
  okBtn.textContent = 'OK';
  okBtn.className = 'primary';
  row.appendChild(okBtn);

  container.appendChild(row);
  return { okBtn, cancelBtn };
}

/** ダイアログをPromiseとして表示 */
export function showDialog(overlay: HTMLDivElement): { promise: Promise<boolean>; resolve: (ok: boolean) => void } {
  let resolveFunc: (ok: boolean) => void;
  const promise = new Promise<boolean>((resolve) => {
    resolveFunc = resolve;
  });
  document.body.appendChild(overlay);
  return { promise, resolve: resolveFunc! };
}

export function closeDialog(overlay: HTMLDivElement): void {
  overlay.remove();
}
