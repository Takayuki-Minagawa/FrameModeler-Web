import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    setClearColor(): void {}
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

import { Document } from '../src/data/Document';
import { Layer } from '../src/data/Layer';
import { Node } from '../src/data/Node';
import { Point3D } from '../src/math/Point3D';
import { CadView } from '../src/ui/CadView';
import type { ObjectSnapKind } from '../src/ui/ObjectSnapEngine';

const rect = { left: 0, top: 0, width: 1000, height: 1000 } as DOMRect;

class FakeCanvas extends EventTarget {
  style = { touchAction: '' };
  dataset: Record<string, string> = {};
  title = '';
  clientWidth = rect.width;
  clientHeight = rect.height;
  parentElement = { clientWidth: rect.width, clientHeight: rect.height };

  getBoundingClientRect(): DOMRect {
    return rect;
  }
  setPointerCapture(): void {}
  hasPointerCapture(): boolean {
    return false;
  }
  releasePointerCapture(): void {}
}

function mouseEvent(x: number, y: number, altKey = false): MouseEvent {
  return { clientX: x, clientY: y, altKey } as MouseEvent;
}

describe('CadView object snap integration', () => {
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    const doc = Document.instance;
    doc.init();
    doc.addLayer(new Layer(0, '1F'));
    doc.shownLayer = doc.layers[0];
  });

  it('exposes the current kind/notification and temporarily bypasses every snap with Alt', () => {
    Document.instance.add(new Node(new Point3D(0, 0, 0)));
    const canvas = new FakeCanvas();
    const view = new CadView(canvas as unknown as HTMLCanvasElement);
    const changes: ObjectSnapKind[] = [];
    view.onSnapChanged = (result) => changes.push(result.kind);

    // cameraDistance=2000 / viewportHeight=1000: 1 CSS px = 4 model units.
    const snapped = view.getMouseCoord(mouseEvent(502, 500));
    expect(snapped).toEqual(new Point3D(0, 0, 0));
    expect(view.currentSnapKind).toBe('node');
    expect(view.currentSnapResult.source).toBe(Document.instance.nodeList[0]);
    expect(canvas.dataset.snapKind).toBe('node');

    const raw = view.getMouseCoord(mouseEvent(502, 500, true));
    expect(raw?.x).toBeCloseTo(8);
    expect(raw?.y).toBeCloseTo(0);
    expect(view.currentSnapKind).toBe('none');
    expect(canvas.dataset.snapKind).toBe('none');
    expect(changes).toEqual(['node', 'none']);

    view.dispose();
    expect(canvas.dataset.snapKind).toBeUndefined();
  });

  it('does not snap to display-filtered data and clears stale candidates when snapping is disabled', () => {
    const node = new Node(new Point3D(0, 0, 0));
    Document.instance.add(node);
    const canvas = new FakeCanvas();
    const view = new CadView(canvas as unknown as HTMLCanvasElement);

    expect(view.getMouseCoord(mouseEvent(502, 500))).toEqual(new Point3D(0, 0, 0));
    expect(view.currentSnapKind).toBe('node');

    view.displayFilter.hide(node);
    expect(view.getMouseCoord(mouseEvent(502, 500))).toEqual(new Point3D(10, 0, 0));
    expect(view.currentSnapKind).toBe('grid');

    view.snapping = false;
    expect(view.cycleSnapCandidate()).toBe(false);
    expect(view.currentSnapKind).toBe('none');
    view.dispose();
  });

  it('drops a snap source when the rendered model or layer context changes', () => {
    Document.instance.add(new Node(new Point3D(0, 0, 0)));
    const canvas = new FakeCanvas();
    const view = new CadView(canvas as unknown as HTMLCanvasElement);

    view.getMouseCoord(mouseEvent(500, 500));
    expect(view.currentSnapKind).toBe('node');
    expect(view.currentSnapResult.source).not.toBeNull();

    view.renderElements();
    expect(view.currentSnapKind).toBe('none');
    expect(view.currentSnapResult.source).toBeNull();
    view.dispose();
  });

  it('mirrors operation and selection status to canvas datasets and callbacks', () => {
    const selected = new Node(new Point3D(0, 0, 0));
    selected.select = true;
    Document.instance.add(selected);
    const canvas = new FakeCanvas();
    const view = new CadView(canvas as unknown as HTMLCanvasElement);
    const operationChanges: Array<string | null> = [];
    const selectionCounts: number[] = [];
    view.onOperationStatusChanged = (status) => operationChanges.push(status);
    view.onSelectionChanged = (items) => selectionCounts.push(items.length);

    view.setOperationStatus('firstPointSelected');
    view.renderSelection();
    expect(canvas.dataset.operationStatus).toBe('firstPointSelected');
    expect(canvas.dataset.selectedCount).toBe('1');

    view.setOperationStatus(null);
    Document.instance.init();
    view.renderSelection();
    expect(canvas.dataset.operationStatus).toBeUndefined();
    expect(canvas.dataset.selectedCount).toBe('0');
    expect(operationChanges).toEqual(['firstPointSelected', null]);
    expect(selectionCounts).toEqual([1, 0]);

    view.dispose();
    expect(canvas.dataset.operationStatus).toBeUndefined();
    expect(canvas.dataset.selectedCount).toBeUndefined();
  });
});
