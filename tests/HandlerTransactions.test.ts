// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/dialogs/MessageDialog', () => ({
  showMessageDialog: vi.fn(async () => undefined),
  showConfirmDialog: vi.fn(async () => true),
  showChoiceDialog: vi.fn(async () => null),
}));

import { Document } from '../src/data/Document';
import { showMessageDialog } from '../src/ui/dialogs/MessageDialog';
import { Floor, FloorDirection } from '../src/data/Floor';
import { Layer } from '../src/data/Layer';
import { Node } from '../src/data/Node';
import { Point3D } from '../src/math/Point3D';
import type { CadView } from '../src/ui/CadView';
import { AddBeamHandler } from '../src/ui/handlers/AddBeamHandler';
import { AddFloorHandler } from '../src/ui/handlers/AddFloorHandler';
import { AddPillarHandler } from '../src/ui/handlers/AddPillarHandler';
import { AddWallHandler } from '../src/ui/handlers/AddWallHandler';

const doc = Document.instance;
const event = { shiftKey: false, ctrlKey: false } as MouseEvent;

beforeEach(() => doc.init());

function view(overrides: Record<string, unknown> = {}): CadView {
  return {
    clearPreview() {},
    renderElements() {},
    renderPreview() {},
    renderSelection() {},
    setOperationStatus: vi.fn(),
    ...overrides,
  } as unknown as CadView;
}

describe('drawing handler atomic commits', () => {
  it('does not add the first beam endpoint before the second click', () => {
    const handler = new AddBeamHandler();
    const cadView = view();

    handler.onClick(cadView, new Point3D(0, 0, 0), event);
    expect(doc.allDataList).toHaveLength(0);

    handler.onDeactivate(cadView);
    expect(doc.allDataList).toHaveLength(0);
  });

  it('adds both missing nodes and the beam as one completed model', () => {
    const handler = new AddBeamHandler();
    const cadView = view();

    handler.onClick(cadView, new Point3D(0, 0, 0), event);
    handler.onClick(cadView, new Point3D(1000, 0, 0), event);

    expect(doc.nodeList).toHaveLength(2);
    expect(doc.memberList).toHaveLength(1);
    expect(doc.memberList[0].nodeI).toBe(doc.getNodeAt(new Point3D(0, 0, 0)));
    expect(doc.memberList[0].nodeJ).toBe(doc.getNodeAt(new Point3D(1000, 0, 0)));
  });

  it('publishes the two-click anchor status and clears it on commit or cancel', () => {
    const status = vi.fn();
    const handler = new AddBeamHandler();
    const cadView = view({ setOperationStatus: status });

    handler.onClick(cadView, new Point3D(0, 0, 0), event);
    expect(status).toHaveBeenLastCalledWith('firstPointSelected');

    handler.onDeactivate(cadView);
    expect(status).toHaveBeenLastCalledWith(null);

    handler.onClick(cadView, new Point3D(0, 0, 0), event);
    handler.onClick(cadView, new Point3D(1000, 0, 0), event);
    expect(status).toHaveBeenLastCalledWith(null);
    expect(doc.memberList).toHaveLength(1);
  });

  it('reports why pillar and wall placement cannot find an upper point', () => {
    const pillarStatus = vi.fn();
    new AddPillarHandler().onClick(view({ setOperationStatus: pillarStatus }), new Point3D(0, 0, 0), event);
    expect(pillarStatus).toHaveBeenLastCalledWith('noPointAbove');

    const wallStatus = vi.fn();
    new AddWallHandler().onClick(view({ setOperationStatus: wallStatus }), new Point3D(0, 0, 0), event);
    expect(wallStatus).toHaveBeenLastCalledWith('noPointAbove');
    expect(doc.allDataList).toHaveLength(0);
  });

  it('does not ask for a layer above while the shown layer is locked', () => {
    const layer = new Layer(0, '1F');
    doc.addLayer(layer);
    doc.shownLayer = layer;
    doc.updateLayer(layer, { locked: true });
    const request = vi.fn(async () => true);
    const pillarStatus = vi.fn();
    const pillar = new AddPillarHandler();
    pillar.setLayerAboveRequest(request);
    pillar.onClick(view({ setOperationStatus: pillarStatus }), new Point3D(0, 0, 0), event);
    expect(pillarStatus).toHaveBeenLastCalledWith('layerLocked');

    const wallStatus = vi.fn();
    const wall = new AddWallHandler();
    wall.setLayerAboveRequest(request);
    wall.onClick(view({ setOperationStatus: wallStatus }), new Point3D(0, 0, 0), event);
    expect(wallStatus).toHaveBeenLastCalledWith('layerLocked');
    expect(request).not.toHaveBeenCalled();
    expect(doc.allDataList).toHaveLength(0);
  });

  it('asks for a layer above and retries the pillar at the same point once it exists', async () => {
    const layer = new Layer(0, '1F');
    doc.addLayer(layer);
    doc.shownLayer = layer;
    const cadView = view();
    const pillar = new AddPillarHandler();
    (cadView as { handler: unknown }).handler = pillar;
    pillar.setLayerAboveRequest(async () => {
      doc.addLayer(new Layer(3500, '2F'));
      return true;
    });
    pillar.onClick(cadView, new Point3D(100, 200, 0), event);
    await vi.waitFor(() => expect(doc.memberList).toHaveLength(1));
    expect(doc.memberList[0].posJ).toEqual(new Point3D(100, 200, 3500));
  });

  it('reports coincident points instead of silently discarding a two-click operation', () => {
    const status = vi.fn();
    const handler = new AddBeamHandler();
    const cadView = view({ setOperationStatus: status });

    handler.onClick(cadView, new Point3D(10, 20, 0), event);
    handler.onClick(cadView, new Point3D(10, 20, 0), event);

    expect(status).toHaveBeenLastCalledWith('coincidentPoints');
    expect(doc.allDataList).toHaveLength(0);
  });

  it('reports a degenerate floor without leaving planned nodes behind', () => {
    const dialog = vi.mocked(showMessageDialog);
    dialog.mockClear();
    const handler = new AddFloorHandler();
    const cadView = view();

    handler.onClick(cadView, new Point3D(0, 0, 0), event);
    handler.onClick(cadView, new Point3D(1000, 0, 0), event);

    expect(doc.allDataList).toHaveLength(0);
    expect(dialog).toHaveBeenCalledOnce();
    expect(dialog.mock.calls[0][1]).toEqual({ level: 'error' });
  });

  it('confirms a direct floor-direction mutation through Document.update', () => {
    const nodes = [
      new Node(new Point3D(0, 0, 0)),
      new Node(new Point3D(1000, 0, 0)),
      new Node(new Point3D(1000, 1000, 0)),
      new Node(new Point3D(0, 1000, 0)),
    ];
    const floor = new Floor(nodes);
    doc.addMany([...nodes, floor]);
    let changes = 0;
    const unsubscribe = doc.subscribe(() => changes++);
    const handler = new AddFloorHandler();
    const cadView = view({ hitTest: () => floor });

    handler.onDoubleClick(cadView, new Point3D(500, 500, 0), event);

    expect(floor.direction).toBe(FloorDirection.Y);
    expect(changes).toBe(1);
    unsubscribe();
  });
});
