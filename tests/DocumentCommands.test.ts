import { beforeEach, describe, expect, it } from 'vitest';
import {
  AddElementsCommand,
  AddLayerCommand,
  DeleteSelectionCommand,
  ImportCommand,
  MoveNodesCommand,
  UpdateLayersCommand,
  UpdatePropertiesCommand,
} from '../src/commands/DocumentCommands';
import { Beam } from '../src/data/Beam';
import { Document } from '../src/data/Document';
import { Layer } from '../src/data/Layer';
import { Node } from '../src/data/Node';
import { Point3D } from '../src/math/Point3D';

const doc = Document.instance;

beforeEach(() => doc.init());

describe('Document commands', () => {
  it('executes an atomic element addition with one validated notification', () => {
    const nodeI = new Node(new Point3D(0, 0, 0));
    const nodeJ = new Node(new Point3D(1000, 0, 0));
    const beam = new Beam(nodeI, nodeJ);
    const changes: string[] = [];
    const unsubscribe = doc.subscribe((event) => changes.push(event.kind));

    doc.execute(new AddElementsCommand([nodeI, nodeJ, beam], '梁追加'));

    unsubscribe();
    expect(doc.allDataList).toEqual([nodeI, nodeJ, beam]);
    expect(doc.nodeList.map((node) => node.number)).toEqual([0, 1]);
    expect(beam.number).toBe(0);
    expect(changes).toEqual(['model']);
  });

  it('clones requested move positions and rolls an invalid move back atomically', () => {
    const nodeI = new Node(new Point3D(0, 0, 0));
    const nodeJ = new Node(new Point3D(1000, 0, 0));
    const beam = new Beam(nodeI, nodeJ);
    doc.addMany([nodeI, nodeJ, beam]);
    const requested = new Point3D(250, 0, 0);
    const command = new MoveNodesCommand([[nodeI, requested]]);
    requested.x = 999;

    doc.execute(command);
    expect(nodeI.pos).toEqual(new Point3D(250, 0, 0));

    const before = nodeJ.pos.clone();
    expect(() => doc.execute(new MoveNodesCommand([[nodeJ, nodeI.pos]]))).toThrow(/member length/);
    expect(nodeJ.pos).toEqual(before);
    expect(doc.memberList).toEqual([beam]);
  });

  it('rolls property mutations back when command validation fails', () => {
    const node = new Node(new Point3D(0, 0, 0));
    doc.add(node);

    expect(() =>
      doc.execute(
        new UpdatePropertiesCommand('節点編集', node, (target) => {
          target.pos = new Point3D(Number.POSITIVE_INFINITY, 0, 0);
        }),
      ),
    ).toThrow(/finite/);

    expect(node.pos).toEqual(new Point3D(0, 0, 0));
  });

  it('rejects foreign command targets before mutating any object', () => {
    const inside = new Node(new Point3D(0, 0, 0));
    const outside = new Node(new Point3D(10, 0, 0));
    doc.add(inside);

    expect(() =>
      doc.execute(
        new MoveNodesCommand([
          [inside, new Point3D(5, 0, 0)],
          [outside, new Point3D(20, 0, 0)],
        ]),
      ),
    ).toThrow(/does not belong/);
    expect(inside.pos).toEqual(new Point3D(0, 0, 0));
    expect(outside.pos).toEqual(new Point3D(10, 0, 0));

    expect(() =>
      doc.execute(
        new UpdatePropertiesCommand('foreign edit', outside, (target) => {
          target.pos = new Point3D(30, 0, 0);
        }),
      ),
    ).toThrow(/does not belong/);
    expect(outside.pos).toEqual(new Point3D(10, 0, 0));
  });

  it('routes deletion, layer updates, layer addition and import through the same command boundary', () => {
    const lower = new Layer(0, '1F', { id: 'layer-1f' });
    expect(doc.execute(new AddLayerCommand(lower))).toBe(true);
    expect(doc.execute(new AddLayerCommand(new Layer(3000, 'duplicate-id', { id: 'layer-1f' })))).toBe(false);

    doc.execute(
      new UpdateLayersCommand('レイヤー非表示', (document) => {
        document.updateLayer(lower, { visible: false, locked: true });
      }),
    );
    expect(lower.visible).toBe(false);
    expect(lower.locked).toBe(true);

    doc.execute(
      new UpdateLayersCommand('レイヤーロック解除', (document) => {
        document.updateLayer(lower, { visible: true, locked: false });
      }),
    );

    const nodeI = new Node(new Point3D(0, 0, 0));
    const nodeJ = new Node(new Point3D(1000, 0, 0));
    const beam = new Beam(nodeI, nodeJ);
    doc.execute(new AddElementsCommand([nodeI, nodeJ, beam]));
    doc.execute(new DeleteSelectionCommand([beam]));
    expect(doc.memberList).toEqual([]);
    expect(doc.nodeList).toEqual([nodeI, nodeJ]);

    const imported = new Node(new Point3D(5, 6, 7));
    const importedLayer = new Layer(7, 'Imported', { id: 'layer-imported' });
    doc.execute(
      new ImportCommand('読込', (document) => {
        document.bulkLoad([imported], [importedLayer]);
        document.filename = 'imported.json';
      }),
    );
    expect(doc.nodeList).toEqual([imported]);
    expect(doc.layers).toEqual([importedLayer]);
    expect(doc.filename).toBe('imported.json');
  });

  it('rejects add, delete, move and property updates on locked layers without partial changes', () => {
    const layer = new Layer(0, '1F', { id: 'layer-locked' });
    doc.addLayer(layer);
    const nodeI = new Node(new Point3D(0, 0, 0));
    const nodeJ = new Node(new Point3D(1000, 0, 0));
    const beam = new Beam(nodeI, nodeJ);
    doc.addMany([nodeI, nodeJ, beam]);
    doc.updateLayer(layer, { locked: true });

    const added = new Node(new Point3D(500, 500, 0));
    expect(() => doc.execute(new AddElementsCommand([added], '節点追加'))).toThrow(/locked layer/);
    expect(doc.allDataList).not.toContain(added);

    expect(() => doc.execute(new DeleteSelectionCommand([beam]))).toThrow(/locked layer/);
    expect(doc.memberList).toEqual([beam]);

    expect(() => doc.execute(new MoveNodesCommand([[nodeI, new Point3D(250, 0, 0)]]))).toThrow(/locked layer/);
    expect(nodeI.pos).toEqual(new Point3D(0, 0, 0));

    const originalSection = beam.section;
    expect(() =>
      doc.execute(new UpdatePropertiesCommand('断面編集', beam, (target) => (target.section = 'LOCKED'))),
    ).toThrow(/locked layer/);
    expect(beam.section).toBe(originalSection);
  });

  it('rolls back a move or position update that would enter a locked layer', () => {
    const lower = new Layer(0, '1F', { id: 'layer-lower' });
    const upper = new Layer(3000, '2F', { id: 'layer-upper', locked: true });
    doc.addLayer(lower);
    doc.addLayer(upper);
    const node = new Node(new Point3D(0, 0, 0));
    doc.add(node);

    expect(() => doc.execute(new MoveNodesCommand([[node, new Point3D(0, 0, 3000)]]))).toThrow(/locked layer/);
    expect(node.pos).toEqual(new Point3D(0, 0, 0));

    expect(() =>
      doc.execute(new UpdatePropertiesCommand('節点編集', node, (target) => (target.pos = new Point3D(0, 0, 3000)))),
    ).toThrow(/locked layer/);
    expect(node.pos).toEqual(new Point3D(0, 0, 0));
  });

  it('treats members connected to a moved node as affected locked data', () => {
    const lower = new Layer(0, '1F', { id: 'layer-lower' });
    const upper = new Layer(3000, '2F', { id: 'layer-upper' });
    doc.addLayer(lower);
    doc.addLayer(upper);
    const bottom = new Node(new Point3D(0, 0, 0));
    const top = new Node(new Point3D(0, 0, 3000));
    const member = new Beam(bottom, top);
    doc.addMany([bottom, top, member]);
    doc.updateLayer(upper, { locked: true });

    expect(() => doc.execute(new MoveNodesCommand([[bottom, new Point3D(100, 0, 0)]]))).toThrow(/locked layer/);
    expect(bottom.pos).toEqual(new Point3D(0, 0, 0));

    expect(() =>
      doc.execute(new UpdatePropertiesCommand('節点編集', bottom, (target) => (target.pos = new Point3D(100, 0, 0)))),
    ).toThrow(/locked layer/);
    expect(bottom.pos).toEqual(new Point3D(0, 0, 0));
  });
});
