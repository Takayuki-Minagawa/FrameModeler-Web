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
import { Point3D } from '../src/math/Point3D';
import { CadView, type CadMeasurement } from '../src/ui/CadView';

const rect = { left: 0, top: 0, width: 1000, height: 1000 } as DOMRect;

class FakeCanvas extends EventTarget {
  style = { touchAction: '' };
  dataset: Record<string, string> = {};
  title = 'canvas';
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

function createView(): { view: CadView; canvas: FakeCanvas } {
  const canvas = new FakeCanvas();
  return { view: new CadView(canvas as unknown as HTMLCanvasElement), canvas };
}

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  const doc = Document.instance;
  doc.init();
  doc.addLayer(new Layer(0, '1F'));
  doc.shownLayer = doc.layers[0];
});

describe('CadView view mode', () => {
  it('reports plan, elevation and 3D projections', () => {
    const { view } = createView();
    expect(view.viewMode).toBe('plan');
    view.setStandardView('front');
    expect(view.viewMode).toBe('elevation');
    view.setStandardView('right');
    expect(view.viewMode).toBe('elevation');
    view.setStandardView('isometric');
    expect(view.viewMode).toBe('3d');
    view.show3D = false;
    expect(view.viewMode).toBe('plan');
    view.setStandardView('top');
    expect(view.viewMode).toBe('plan');
  });
});

describe('CadView pointer context', () => {
  it('tells handlers whether a click carries a screen position', () => {
    const { view } = createView();
    const seen: boolean[] = [];
    const handler = {
      onClick: () => seen.push(view.hasPointerPosition),
      onDoubleClick() {},
      onMouseMove() {},
      draw() {},
    };
    view.handler = handler;

    expect(view.hasPointerPosition).toBe(false);
    view.handleClick({ clientX: 500, clientY: 500, altKey: false } as MouseEvent);
    // 座標の数値入力は、CadViewを経由せずハンドラを直接呼ぶ。
    handler.onClick();
    expect(seen).toEqual([true, false]);
    expect(view.hasPointerPosition).toBe(false);
  });
});

describe('CadView measurement', () => {
  it('publishes an independent copy and suppresses redundant clears', () => {
    const { view } = createView();
    const seen: Array<Readonly<CadMeasurement> | null> = [];
    view.onMeasurementChanged = (measurement) => seen.push(measurement);

    view.setMeasurement(null);
    expect(seen).toEqual([]);

    const from = new Point3D(0, 0, 0);
    view.setMeasurement({ from, to: new Point3D(1, 2, 3), final: true });
    from.x = 99;
    expect(view.measurement?.from.x).toBe(0);
    expect(seen).toHaveLength(1);

    view.setMeasurement(null);
    expect(view.measurement).toBeNull();
    expect(seen.at(-1)).toBeNull();

    view.dispose();
    view.setMeasurement({ from, to: from, final: false });
    expect(seen).toHaveLength(2);
  });
});

describe('CadView work-plane errors', () => {
  it('reports a language-neutral code and leaves the canvas title to the caller', () => {
    const { view, canvas } = createView();
    const errors: Array<string | null> = [];
    view.onWorkPlaneUnavailable = (error) => errors.push(error);

    // 正面表示では視線が作業平面と平行になり、作図位置を求められない。
    view.setStandardView('front');
    expect(view.getMouseCoord({ clientX: 500, clientY: 500, altKey: false } as MouseEvent)).toBeNull();
    expect(errors).toEqual(['parallel']);
    expect(canvas.dataset.workPlaneError).toBe('parallel');
    expect(canvas.title).toBe('canvas');

    view.setStandardView('top');
    expect(view.getMouseCoord({ clientX: 500, clientY: 500, altKey: false } as MouseEvent)).not.toBeNull();
    expect(errors).toEqual(['parallel', null]);
    expect(canvas.dataset.workPlaneError).toBeUndefined();
  });

  it('refuses to capture an image before the view is renderable', async () => {
    const canvas = new FakeCanvas();
    canvas.parentElement = { clientWidth: 0, clientHeight: 0 };
    const view = new CadView(canvas as unknown as HTMLCanvasElement);
    await expect(view.captureImage()).rejects.toThrow(/not ready/);
  });
});
