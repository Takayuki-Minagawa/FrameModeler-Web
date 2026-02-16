export abstract class DocumentData {
  number: number = 0;
  select: boolean = false;

  abstract get typeText(): string;

  isRemovable(): { removable: boolean; reason: string } {
    return { removable: true, reason: '' };
  }

  /** XML保存用: サブクラスでオーバーライド */
  save(writer: (name: string, value: string) => void): void {
    writer('Number', String(this.number));
    writer('Select', String(this.select));
  }

  /** XML読込用: サブクラスでオーバーライド */
  load(reader: (name: string, defaultValue?: string) => string): void {
    this.number = parseInt(reader('Number', '0'));
    this.select = reader('Select', 'False') === 'True';
  }
}
