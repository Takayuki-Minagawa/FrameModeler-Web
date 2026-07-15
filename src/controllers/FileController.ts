import { ImportCommand } from '../commands/DocumentCommands';
import type { Document } from '../data/Document';
import { createCalcYamlImportPlan, type CalcYamlImportMode } from '../io/CalcYamlDeserializer';
import { createJsonImportPlan } from '../io/JsonDeserializer';
import { downloadJson } from '../io/JsonSerializer';

export type SelectYamlMode = () => Promise<CalcYamlImportMode | null>;

/** ファイル種別判定、atomic import、新規作成、JSON保存をmainから分離する。 */
export class FileController {
  constructor(private readonly document: Document) {}

  reset(): void {
    this.document.execute(
      new ImportCommand('新規作成', (document) => {
        document.init();
        document.filename = '';
      }),
    );
  }

  async openText(name: string, content: string, selectYamlMode: SelectYamlMode): Promise<boolean> {
    if (isYamlFile(name, content)) {
      const mode = await selectYamlMode();
      if (!mode) return false;
      const plan = await createCalcYamlImportPlan(content, { mode });
      this.document.execute(
        new ImportCommand('YAML読込', (document) => {
          const summary = plan.commit(document);
          document.filename = name;
          return summary;
        }),
      );
    } else if (isJsonFile(name, content)) {
      const plan = createJsonImportPlan(content);
      this.document.execute(
        new ImportCommand('JSON読込', (document) => {
          plan.commit(document);
          document.filename = name;
        }),
      );
    } else {
      throw new Error('Unsupported file type');
    }
    return true;
  }

  save(): string {
    const filename = this.document.hasFileName ? toJsonFilename(this.document.filename) : 'model.json';
    downloadJson(filename);
    this.document.filename = filename;
    return filename;
  }
}

export function isJsonFile(name: string, content: string): boolean {
  return /\.json$/i.test(name) || /^[\s\r\n]*[\{\[]/.test(content);
}

export function isYamlFile(name: string, content: string): boolean {
  return /\.ya?ml$/i.test(name) || /^[\s\r\n]*schema_version\s*:/i.test(content);
}

/** 任意の拡張子を.jsonへ置換する。 */
export function toJsonFilename(name: string): string {
  const slash = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const dot = name.lastIndexOf('.');
  const base = dot > slash ? name.slice(0, dot) : name;
  return `${base || 'model'}.json`;
}
