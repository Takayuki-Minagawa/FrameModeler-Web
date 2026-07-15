import { describe, expect, it } from 'vitest';
import type { PortableDocumentSnapshot } from '../src/io/DocumentSnapshotCodec';
import { applySnapshotDelta, createSnapshotDelta } from '../src/history/SnapshotDelta';

function snapshot(
  model: unknown,
  filename = 'model.json',
  shownLayer: PortableDocumentSnapshot['shownLayer'] = null,
): PortableDocumentSnapshot {
  return { json: JSON.stringify(model, null, 2), filename, shownLayer };
}

describe('SnapshotDelta', () => {
  it('stores a scalar model edit as a leaf-level structural operation', () => {
    const before = snapshot({ nodes: [{ number: 0, pos: { x: 0, y: 0, z: 0 } }], layers: [] });
    const after = snapshot({ nodes: [{ number: 0, pos: { x: 1250, y: 0, z: 0 } }], layers: [] });

    const delta = createSnapshotDelta(before, after);

    expect(delta).toEqual([{ kind: 'set', path: ['model', 'nodes', 0, 'pos', 'x'], value: 1250 }]);
    expect(JSON.parse(applySnapshotDelta(before, delta).json)).toEqual(JSON.parse(after.json));
  });

  it('round-trips array-size, property deletion, filename and stable shown-layer changes', () => {
    const before = snapshot(
      {
        nodes: [{ number: 0, pos: { x: 0, y: 0, z: 0 }, legacy: true }],
        layers: [{ id: 'layer-ground', name: '1F', posZ: 0 }],
      },
      'before.json',
      { id: 'layer-ground', name: '1F', posZ: 0 },
    );
    const after = snapshot(
      {
        nodes: [
          { number: 0, pos: { x: 0, y: 0, z: 0 } },
          { number: 1, pos: { x: 3000, y: 0, z: 0 } },
        ],
        layers: [
          { id: 'layer-ground', name: 'Ground', posZ: 0 },
          { id: 'layer-roof', name: 'Roof', posZ: 3000 },
        ],
      },
      'after.json',
      { id: 'layer-roof', name: 'Roof', posZ: 3000 },
    );
    const beforeCopy = structuredClone(before);
    const afterCopy = structuredClone(after);

    const forward = createSnapshotDelta(before, after);
    const backward = createSnapshotDelta(after, before);
    const applied = applySnapshotDelta(before, forward);
    const restored = applySnapshotDelta(applied, backward);

    expect(JSON.parse(applied.json)).toEqual(JSON.parse(after.json));
    expect(applied.filename).toBe(after.filename);
    expect(applied.shownLayer).toEqual(after.shownLayer);
    expect(JSON.parse(restored.json)).toEqual(JSON.parse(before.json));
    expect(restored.filename).toBe(before.filename);
    expect(restored.shownLayer).toEqual(before.shownLayer);
    expect(before).toEqual(beforeCopy);
    expect(after).toEqual(afterCopy);
  });

  it('produces no operations for semantically equal snapshots with identical formatting', () => {
    const current = snapshot({ schemaVersion: 2, nodes: [], layers: [] });
    expect(createSnapshotDelta(current, structuredClone(current))).toEqual([]);
    expect(applySnapshotDelta(current, [])).toEqual(current);
  });
});
