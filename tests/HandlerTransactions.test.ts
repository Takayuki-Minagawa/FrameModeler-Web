// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Document } from '../src/data/Document';
import { Floor, FloorDirection } from '../src/data/Floor';
import { Node } from '../src/data/Node';
import { Point3D } from '../src/math/Point3D';
import type { CadView } from '../src/ui/CadView';
import { AddBeamHandler } from '../src/ui/handlers/AddBeamHandler';
import { AddFloorHandler } from '../src/ui/handlers/AddFloorHandler';

const doc = Document.instance;
const event = { shiftKey: false, ctrlKey: false } as MouseEvent;

beforeEach(() => doc.init());

function view(overrides: Record<string, unknown> = {}): CadView {
  return {
    clearPreview() {},
    renderElements() {},
    renderPreview() {},
    renderSelection() {},
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

  it('reports a degenerate floor without leaving planned nodes behind', () => {
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    const handler = new AddFloorHandler();
    const cadView = view();

    handler.onClick(cadView, new Point3D(0, 0, 0), event);
    handler.onClick(cadView, new Point3D(1000, 0, 0), event);

    expect(doc.allDataList).toHaveLength(0);
    expect(alertSpy).toHaveBeenCalledOnce();
    alertSpy.mockRestore();
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
