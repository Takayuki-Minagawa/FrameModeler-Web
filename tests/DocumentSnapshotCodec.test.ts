import { beforeEach, describe, expect, it } from 'vitest';
import { Document } from '../src/data/Document';
import { Node } from '../src/data/Node';
import { Point3D } from '../src/math/Point3D';
import { exportDocumentSnapshot, importDocumentSnapshot } from '../src/io/DocumentSnapshotCodec';
import { serializeJson } from '../src/io/JsonSerializer';
import { Layer } from '../src/ui/Layer';

const document = Document.instance;

describe('portable Document snapshot codec', () => {
  beforeEach(() => document.init());

  it('restores filename and the shown layer separately from model JSON', () => {
    const first = new Layer(0, '1F');
    const second = new Layer(3000, '2F');
    document.bulkLoad([new Node(new Point3D(1, 2, 3))], [first, second]);
    document.shownLayer = second;
    document.filename = 'frame.json';
    const snapshot = exportDocumentSnapshot();

    document.init();
    importDocumentSnapshot(snapshot);

    expect(document.filename).toBe('frame.json');
    expect(document.shownLayer?.name).toBe('2F');
    expect(document.shownLayer?.posZ).toBe(3000);
    expect(document.nodeList[0].pos.equals(new Point3D(1, 2, 3))).toBe(true);
  });

  it('keeps legacy json+filename snapshots compatible', () => {
    document.bulkLoad([], [new Layer(0, '1F'), new Layer(3000, '2F')]);
    const legacy = { json: serializeJson(), filename: 'legacy.json' };

    document.init();
    importDocumentSnapshot(legacy);

    expect(document.filename).toBe('legacy.json');
    expect(document.shownLayer?.name).toBe('1F');
    expect(document.importMetadata).toBeNull();
  });

  it('preserves an explicitly null shown layer', () => {
    document.bulkLoad([], [new Layer(0, '1F')]);
    document.shownLayer = null;
    const snapshot = exportDocumentSnapshot();

    document.init();
    importDocumentSnapshot(snapshot);

    expect(document.shownLayer).toBeNull();
  });

  it('rejects a stale shown-layer reference before replacing the current Document', () => {
    document.bulkLoad([new Node(new Point3D(9, 9, 9))], []);
    const before = serializeJson();
    const snapshot = {
      json: JSON.stringify({ schemaVersion: 1, nodes: [], layers: [{ name: '1F', posZ: 0 }] }),
      filename: 'invalid.json',
      shownLayer: { name: 'missing', posZ: 3000 },
    };

    expect(() => importDocumentSnapshot(snapshot)).toThrow(/shownLayer.*layer not found/);
    expect(serializeJson()).toBe(before);
  });
});
