import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Beam } from '../src/data/Beam';
import { BearWall } from '../src/data/BearWall';
import { Document } from '../src/data/Document';
import { Floor } from '../src/data/Floor';
import { Node } from '../src/data/Node';
import { Pillar } from '../src/data/Pillar';
import { Wall } from '../src/data/Wall';
import { Point3D } from '../src/math/Point3D';
import { DEFAULT_SELECTION_SETTINGS, SelectionFilter, selectionKindOf } from '../src/selection/SelectionFilter';
import type { CadView } from '../src/ui/CadView';
import { SelectionHandler } from '../src/ui/handlers/SelectionHandler';

const doc = Document.instance;

beforeEach(() => doc.init());

describe('SelectionFilter', () => {
  it('classifies every supported model type without UI dependencies', () => {
    expect(selectionKindOf(new Node())).toBe('node');
    expect(selectionKindOf(new Beam())).toBe('beam');
    expect(selectionKindOf(new Pillar())).toBe('pillar');
    expect(selectionKindOf(new Floor())).toBe('floor');
    expect(selectionKindOf(new Wall())).toBe('wall');
    expect(selectionKindOf(new BearWall())).toBe('bearWall');
  });

  it('allows all supported types by default', () => {
    const filter = new SelectionFilter();
    const values = [new Node(), new Beam(), new Pillar(), new Floor(), new Wall(), new BearWall()];

    expect(values.every((data) => filter.allows(data))).toBe(true);
    expect(filter.settings).toEqual(DEFAULT_SELECTION_SETTINGS);
    expect(Object.isFrozen(filter.settings)).toBe(true);
  });

  it('updates individual settings independently and keeps all as a derived value', () => {
    const filter = new SelectionFilter();

    filter.setEnabled('beam', false);
    expect(filter.isEnabled('all')).toBe(false);
    expect(filter.isEnabled('beam')).toBe(false);
    expect(filter.isEnabled('pillar')).toBe(true);

    filter.setEnabled('all', true);
    expect(filter.settings).toEqual(DEFAULT_SELECTION_SETTINGS);

    filter.setSettings({ all: false, node: true, wall: true });
    expect(filter.settings).toMatchObject({
      all: false,
      node: true,
      beam: false,
      pillar: false,
      floor: false,
      wall: true,
      bearWall: false,
    });
  });

  it('supports enabling only multiple requested types', () => {
    const filter = new SelectionFilter();
    filter.enableOnly('beam', 'bearWall');

    expect(filter.allows(new Beam())).toBe(true);
    expect(filter.allows(new BearWall())).toBe(true);
    expect(filter.allows(new Node())).toBe(false);
    expect(filter.allows(new Pillar())).toBe(false);
  });
});

describe('SelectionHandler filtering', () => {
  it('selects an allowed click but does not toggle a filtered click', () => {
    const { nodeI, beam } = addBeamModel();
    const filter = new SelectionFilter();
    filter.enableOnly('node');
    const handler = new SelectionHandler(filter);

    handler.onClick(
      createView(() => nodeI),
      nodeI.pos,
      mouseEvent(),
    );
    expect(nodeI.select).toBe(true);
    expect(beam.select).toBe(false);

    beam.select = true;
    handler.onClick(
      createView(() => beam),
      new Point3D(5, 0, 0),
      mouseEvent({ ctrlKey: true }),
    );
    expect(beam.select).toBe(true);
  });

  it('still clears existing selections explicitly when clicking an empty or filtered target', () => {
    const { nodeI, beam } = addBeamModel();
    nodeI.select = true;
    beam.select = true;
    const handler = new SelectionHandler(new SelectionFilter({ beam: false }));

    handler.onClick(
      createView(() => null),
      new Point3D(-1, -1, 0),
      mouseEvent(),
    );
    expect(nodeI.select).toBe(false);
    expect(beam.select).toBe(false);

    nodeI.select = true;
    beam.select = true;
    handler.onClick(
      createView(() => beam),
      new Point3D(5, 0, 0),
      mouseEvent(),
    );
    expect(nodeI.select).toBe(false);
    expect(beam.select).toBe(false);
  });

  it('restricts rectangle selection to allowed model types', () => {
    const { nodeI, nodeJ, beam } = addBeamModel();
    const filter = new SelectionFilter();
    filter.enableOnly('beam');
    const handler = new SelectionHandler(filter);
    const view = createView(() => null);

    handler.onClick(view, new Point3D(-1, -1, 0), mouseEvent());
    handler.onEndDrag(view, new Point3D(11, 1, 0), mouseEvent(), 20);

    expect(beam.select).toBe(true);
    expect(nodeI.select).toBe(false);
    expect(nodeJ.select).toBe(false);
  });

  it('opens a dialog only for an allowed double-click target', () => {
    const { nodeI, beam } = addBeamModel();
    const filter = new SelectionFilter();
    filter.enableOnly('node');
    const handler = new SelectionHandler(filter);
    const showDialog = vi.fn();
    handler.setDialogCallback(showDialog);

    handler.onDoubleClick(
      createView(() => beam),
      new Point3D(5, 0, 0),
      mouseEvent(),
    );
    expect(showDialog).not.toHaveBeenCalled();

    handler.onDoubleClick(
      createView(() => nodeI),
      nodeI.pos,
      mouseEvent(),
    );
    expect(showDialog).toHaveBeenCalledOnce();
    expect(showDialog).toHaveBeenCalledWith(nodeI);
  });
});

function addBeamModel(): { nodeI: Node; nodeJ: Node; beam: Beam } {
  const nodeI = new Node(new Point3D(0, 0, 0));
  const nodeJ = new Node(new Point3D(10, 0, 0));
  const beam = new Beam(nodeI, nodeJ);
  doc.addMany([nodeI, nodeJ, beam]);
  return { nodeI, nodeJ, beam };
}

function mouseEvent(overrides: Partial<Pick<MouseEvent, 'shiftKey' | 'ctrlKey'>> = {}): MouseEvent {
  return {
    shiftKey: false,
    ctrlKey: false,
    ...overrides,
  } as MouseEvent;
}

function createView(hitTest: () => ReturnType<CadView['hitTest']>): CadView {
  return {
    hitTest,
    renderSelection: vi.fn(),
    renderPreview: vi.fn(),
    clearPreview: vi.fn(),
    addPreviewPolygon: vi.fn(),
    selectionRectColor: 0,
  } as unknown as CadView;
}
