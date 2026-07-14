import { describe, expect, it } from 'vitest';
import type { DisplayLabelDescriptor } from '../src/display/DisplayLabels';
import { Point3D } from '../src/math/Point3D';
import { CadLabelRenderer } from '../src/ui/CadLabelRenderer';

class FakeStyle {
  left = '';
  top = '';
}

class FakeNode {
  readonly children: FakeNode[] = [];
  readonly style = new FakeStyle();
  readonly dataset: Record<string, string | undefined> = {};
  className = '';
  textContent: string | null = null;

  constructor(readonly ownerDocument: FakeDocument) {}

  setAttribute(): void {}

  appendChild(child: FakeNode): FakeNode {
    this.children.push(child);
    return child;
  }

  replaceChildren(...children: FakeNode[]): void {
    this.children.length = 0;
    for (const child of children) {
      if (child instanceof FakeFragment) this.children.push(...child.children);
      else this.children.push(child);
    }
  }

  remove(): void {}
}

class FakeFragment extends FakeNode {}

class FakeDocument {
  createElement(): FakeNode {
    return new FakeNode(this);
  }

  createDocumentFragment(): FakeFragment {
    return new FakeFragment(this);
  }
}

describe('CadLabelRenderer', () => {
  it('places local-axis labels at their projected tips instead of overlapping at the origin', () => {
    const ownerDocument = new FakeDocument();
    const parent = new FakeNode(ownerDocument);
    const canvas = { ownerDocument, parentElement: parent } as unknown as HTMLCanvasElement;
    const renderer = new CadLabelRenderer(canvas);
    const descriptors: DisplayLabelDescriptor[] = [
      { kind: 'memberNumber', text: 'M1', position: new Point3D(10, 20, 0) },
      {
        kind: 'localAxis',
        text: 'x',
        position: new Point3D(10, 20, 0),
        axis: 'x',
        direction: Point3D.XDirection.clone(),
      },
      {
        kind: 'localAxis',
        text: 'y',
        position: new Point3D(10, 20, 0),
        axis: 'y',
        direction: Point3D.YDirection.clone(),
      },
    ];

    renderer.render(descriptors, (point) => ({ x: point.x, y: point.y }));

    const labels = parent.children[0].children;
    expect(labels.map((label) => [label.textContent, label.style.left, label.style.top])).toEqual([
      ['M1', '10px', '20px'],
      ['x', '260px', '20px'],
      ['y', '10px', '270px'],
    ]);
    expect(labels[1].dataset.axis).toBe('x');
    expect(labels[2].dataset.axis).toBe('y');
  });
});
