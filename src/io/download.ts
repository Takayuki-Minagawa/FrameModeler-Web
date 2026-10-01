/** 文字列またはBlobをブラウザのダウンロードとして保存する。 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadText(filename: string, content: string, mimeType: string): void {
  downloadBlob(filename, new Blob([content], { type: mimeType }));
}

/** 保存中のモデル名から、拡張子だけを差し替えた出力ファイル名を作る。 */
export function exportFilename(modelFilename: string, suffix: string, extension: string): string {
  const slash = Math.max(modelFilename.lastIndexOf('/'), modelFilename.lastIndexOf('\\'));
  const name = modelFilename.slice(slash + 1);
  const dot = name.lastIndexOf('.');
  const base = (dot > 0 ? name.slice(0, dot) : name) || 'model';
  return `${base}${suffix}.${extension}`;
}
