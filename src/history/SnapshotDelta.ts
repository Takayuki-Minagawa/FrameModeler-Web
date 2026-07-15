import type { PortableDocumentSnapshot } from '../io/DocumentSnapshotCodec';

type PathSegment = string | number;

export type SnapshotDeltaOperation =
  { kind: 'set'; path: PathSegment[]; value: unknown } | { kind: 'delete'; path: PathSegment[] };

export type SnapshotDelta = ReadonlyArray<SnapshotDeltaOperation>;

interface ExpandedSnapshot {
  model: unknown;
  filename: string;
  shownLayer?: PortableDocumentSnapshot['shownLayer'];
}

/** Portable snapshot同士の構造差分だけを保持する。 */
export function createSnapshotDelta(before: PortableDocumentSnapshot, after: PortableDocumentSnapshot): SnapshotDelta {
  const operations: SnapshotDeltaOperation[] = [];
  diffValue(expand(before), expand(after), [], operations);
  return operations;
}

/** 現在snapshotへ差分を適用し、新しいportable snapshotを返す。 */
export function applySnapshotDelta(snapshot: PortableDocumentSnapshot, delta: SnapshotDelta): PortableDocumentSnapshot {
  let expanded: unknown = structuredClone(expand(snapshot));
  for (const operation of delta) expanded = applyOperation(expanded, operation);
  return collapse(expanded as ExpandedSnapshot);
}

function expand(snapshot: PortableDocumentSnapshot): ExpandedSnapshot {
  return {
    model: JSON.parse(snapshot.json) as unknown,
    filename: snapshot.filename,
    ...(snapshot.shownLayer === undefined ? {} : { shownLayer: structuredClone(snapshot.shownLayer) }),
  };
}

function collapse(snapshot: ExpandedSnapshot): PortableDocumentSnapshot {
  return {
    json: JSON.stringify(snapshot.model, null, 2),
    filename: snapshot.filename,
    ...(snapshot.shownLayer === undefined ? {} : { shownLayer: structuredClone(snapshot.shownLayer) }),
  };
}

function diffValue(before: unknown, after: unknown, path: PathSegment[], operations: SnapshotDeltaOperation[]): void {
  if (Object.is(before, after)) return;

  if (Array.isArray(before) && Array.isArray(after)) {
    if (before.length !== after.length) {
      operations.push({ kind: 'set', path, value: structuredClone(after) });
      return;
    }
    for (let index = 0; index < before.length; index++) {
      diffValue(before[index], after[index], [...path, index], operations);
    }
    return;
  }

  if (isRecord(before) && isRecord(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      if (!(key in after)) {
        operations.push({ kind: 'delete', path: [...path, key] });
      } else if (!(key in before)) {
        operations.push({ kind: 'set', path: [...path, key], value: structuredClone(after[key]) });
      } else {
        diffValue(before[key], after[key], [...path, key], operations);
      }
    }
    return;
  }

  operations.push({ kind: 'set', path, value: structuredClone(after) });
}

function applyOperation(root: unknown, operation: SnapshotDeltaOperation): unknown {
  if (operation.path.length === 0) {
    return operation.kind === 'set' ? structuredClone(operation.value) : undefined;
  }

  const copy = structuredClone(root) as Record<string | number, unknown>;
  let target: Record<string | number, unknown> = copy;
  for (const segment of operation.path.slice(0, -1)) {
    const next = target[segment];
    if (!next || typeof next !== 'object') {
      throw new Error(`Cannot apply history delta at ${operation.path.join('.')}`);
    }
    target = next as Record<string | number, unknown>;
  }
  const key = operation.path.at(-1)!;
  if (operation.kind === 'delete') {
    if (Array.isArray(target) && typeof key === 'number') target.splice(key, 1);
    else delete target[key];
  } else {
    target[key] = structuredClone(operation.value);
  }
  return copy;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
