export type UnknownRecord = Record<string, unknown>;

export function asRecord(value: unknown, path: string): UnknownRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${path}: expected object`);
  }
  return value as UnknownRecord;
}

export function requiredArray(value: unknown, path: string): unknown[] {
  if (value === undefined) throw new Error(`Invalid JSON field '${path}': required array`);
  if (!Array.isArray(value)) throw new Error(`Invalid JSON field '${path}': expected array`);
  return value;
}

export function optionalArray(value: unknown, path: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`Invalid JSON field '${path}': expected array`);
  return value;
}

export function asFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`Invalid ${path}: expected finite number`);
  }
  return value;
}

export function optionalFiniteNumber(value: unknown, path: string): number | undefined {
  if (value === undefined) return undefined;
  return asFiniteNumber(value, path);
}

export function asId(value: unknown, path: string): number {
  const number = asFiniteNumber(value, path);
  if (!Number.isInteger(number) || number < 0) {
    throw new Error(`Invalid ${path}: expected a non-negative integer`);
  }
  return number;
}

export function asIdArray(value: unknown, path: string): number[] {
  if (!Array.isArray(value)) throw new Error(`Invalid ${path}: expected number array`);
  return value.map((item, index) => asId(item, `${path}[${index}]`));
}

export function optionalIdArray(value: unknown, path: string): number[] | undefined {
  if (value === undefined) return undefined;
  return asIdArray(value, path);
}

export function asString(value: unknown, path: string): string {
  if (typeof value !== 'string') throw new Error(`Invalid ${path}: expected string`);
  return value;
}

export function optionalString(value: unknown, path: string): string | undefined {
  if (value === undefined) return undefined;
  return asString(value, path);
}

export function optionalBoolean(value: unknown, path: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw new Error(`Invalid ${path}: expected boolean`);
  return value;
}

export function optionalStringArray(value: unknown, path: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`Invalid ${path}: expected string array`);
  return value.map((item, index) => asString(item, `${path}[${index}]`));
}

export function validateLegacySelection(value: unknown, path: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`Invalid ${path}: expected boolean`);
  }
}

export function cloneJsonRecord(value: UnknownRecord, path: string): Record<string, unknown> {
  const stack = new WeakSet<object>();
  return cloneJsonValue(value, path, stack) as Record<string, unknown>;
}

function cloneJsonValue(value: unknown, path: string, stack: WeakSet<object>): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return asFiniteNumber(value, path);
  if (typeof value !== 'object') throw new Error(`Invalid ${path}: expected JSON-compatible value`);
  if (stack.has(value)) throw new Error(`Invalid ${path}: circular value`);
  stack.add(value);
  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((item, index) => cloneJsonValue(item, `${path}[${index}]`, stack));
  } else {
    result = Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJsonValue(item, `${path}.${key}`, stack)]),
    );
  }
  stack.delete(value);
  return result;
}
