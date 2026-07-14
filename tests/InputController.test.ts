import { describe, expect, it } from 'vitest';
import { InputController, type InputHost } from '../src/ui/InputController';

class FakeCanvas extends EventTarget {
  style = { touchAction: '' };
  parentElement = null;
  private readonly captured = new Set<number>();

  setPointerCapture(id: number): void {
    this.captured.add(id);
  }
  hasPointerCapture(id: number): boolean {
    return this.captured.has(id);
  }
  releasePointerCapture(id: number): void {
    this.captured.delete(id);
  }
}

function pointerEvent(type: string, options: Partial<PointerEvent> = {}): PointerEvent {
  const event = new Event(type, { cancelable: true }) as PointerEvent;
  Object.assign(event, {
    pointerId: 1,
    button: 0,
    clientX: 10,
    clientY: 10,
    ...options,
  });
  return event;
}

function mouseEvent(type: string, options: Partial<MouseEvent> = {}): MouseEvent {
  const event = new Event(type, { cancelable: true }) as MouseEvent;
  Object.assign(event, { button: 0, clientX: 10, clientY: 10, ...options });
  return event;
}

function host(acceptsDoubleClick: boolean): InputHost & {
  clicks: number;
  doubleClicks: number;
  pans: number;
  dragDistances: number[];
} {
  return {
    clicks: 0,
    doubleClicks: 0,
    pans: 0,
    dragDistances: [],
    hasHandler: true,
    acceptsDoubleClick,
    show3D: false,
    handleClick() {
      this.clicks++;
    },
    handleDoubleClick() {
      this.doubleClicks++;
    },
    handleMouseMove() {},
    handleEndDrag(_event, distance) {
      this.dragDistances.push(distance);
    },
    panCamera() {
      this.pans++;
    },
    rotateCamera() {},
    zoomCamera() {},
    resize() {},
  };
}

function dispatchClick(canvas: FakeCanvas, x: number): void {
  canvas.dispatchEvent(pointerEvent('pointerdown', { clientX: x }));
  canvas.dispatchEvent(pointerEvent('pointerup', { clientX: x }));
}

describe('InputController pointer gestures', () => {
  it('passes both rapid clicks to drawing tools without converting the second click', () => {
    const canvas = new FakeCanvas();
    const target = host(false);
    const controller = new InputController(canvas as unknown as HTMLCanvasElement, target);

    dispatchClick(canvas, 10);
    dispatchClick(canvas, 12);
    canvas.dispatchEvent(mouseEvent('dblclick', { clientX: 12 }));

    expect(target.clicks).toBe(2);
    expect(target.doubleClicks).toBe(0);
    controller.dispose();
  });

  it('dispatches native dblclick only for a tool that opts in', () => {
    const canvas = new FakeCanvas();
    const target = host(true);
    const controller = new InputController(canvas as unknown as HTMLCanvasElement, target);

    dispatchClick(canvas, 10);
    dispatchClick(canvas, 12);
    canvas.dispatchEvent(mouseEvent('dblclick', { clientX: 12 }));

    expect(target.clicks).toBe(2);
    expect(target.doubleClicks).toBe(1);
    controller.dispose();
  });

  it('resets the double-click sequence when the tool context changes', () => {
    const canvas = new FakeCanvas();
    const target = host(true);
    const controller = new InputController(canvas as unknown as HTMLCanvasElement, target);

    dispatchClick(canvas, 10);
    controller.resetGestureState();
    dispatchClick(canvas, 11);
    canvas.dispatchEvent(mouseEvent('dblclick', { clientX: 11 }));

    expect(target.doubleClicks).toBe(0);
    controller.dispose();
  });

  it('clears drag state on lost pointer capture and removes listeners on dispose', () => {
    const canvas = new FakeCanvas();
    const target = host(false);
    const controller = new InputController(canvas as unknown as HTMLCanvasElement, target);

    canvas.dispatchEvent(pointerEvent('pointerdown', { button: 1 }));
    canvas.dispatchEvent(pointerEvent('pointermove', { button: 1, clientX: 20 }));
    canvas.dispatchEvent(pointerEvent('lostpointercapture', { button: 1, clientX: 20 }));
    canvas.dispatchEvent(pointerEvent('pointermove', { button: 1, clientX: 30 }));
    expect(target.pans).toBe(1);

    controller.dispose();
    dispatchClick(canvas, 10);
    expect(target.clicks).toBe(0);
  });

  it('reports drag distance in CSS pixels', () => {
    const canvas = new FakeCanvas();
    const target = host(false);
    const controller = new InputController(canvas as unknown as HTMLCanvasElement, target);

    canvas.dispatchEvent(pointerEvent('pointerdown', { clientX: 0, clientY: 0 }));
    canvas.dispatchEvent(pointerEvent('pointermove', { clientX: 3, clientY: 4 }));
    canvas.dispatchEvent(pointerEvent('pointerup', { clientX: 3, clientY: 4 }));
    expect(target.dragDistances).toEqual([5]);
    controller.dispose();
  });
});
