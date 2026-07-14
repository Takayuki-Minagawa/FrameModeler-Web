import { describe, expect, it, vi } from 'vitest';
import { DocumentHistory, type DocumentSnapshot } from '../src/history/DocumentHistory';

function snapshot(value: number, selected: boolean = false): DocumentSnapshot {
  return {
    json: JSON.stringify({ nodes: [{ number: 0, value, select: selected }] }),
    filename: 'model.json',
  };
}

describe('DocumentHistory', () => {
  it('records, undoes and redoes a committed model change', () => {
    let current = snapshot(1);
    const restore = vi.fn((next: DocumentSnapshot) => {
      current = next;
    });
    const history = new DocumentHistory(() => current, restore);

    const before = history.capture();
    current = snapshot(2);
    expect(history.record('move', before)).toBe(true);
    expect(history.canUndo).toBe(true);
    expect(history.isDirty).toBe(true);

    expect(history.undo()).toBe(true);
    expect(JSON.parse(current.json).nodes[0].value).toBe(1);
    expect(history.redo()).toBe(true);
    expect(JSON.parse(current.json).nodes[0].value).toBe(2);
    expect(restore).toHaveBeenCalledTimes(2);
  });

  it('ignores selection-only changes', () => {
    let current = snapshot(1, false);
    const history = new DocumentHistory(
      () => current,
      (next) => {
        current = next;
      },
    );
    const before = history.capture();
    current = snapshot(1, true);

    expect(history.record('selection', before)).toBe(false);
    expect(history.canUndo).toBe(false);
    expect(history.isDirty).toBe(false);
  });

  it('tracks the saved revision independently of undo cursor', () => {
    let current = snapshot(1);
    const history = new DocumentHistory(
      () => current,
      (next) => {
        current = next;
      },
    );
    const before = history.capture();
    current = snapshot(2);
    history.record('edit', before);
    history.markSaved();
    expect(history.isDirty).toBe(false);

    history.undo();
    expect(history.isDirty).toBe(true);
    history.redo();
    expect(history.isDirty).toBe(false);
  });

  it('drops redo entries after a new edit', () => {
    let current = snapshot(1);
    const history = new DocumentHistory(
      () => current,
      (next) => {
        current = next;
      },
    );
    let before = history.capture();
    current = snapshot(2);
    history.record('first', before);
    history.undo();

    before = history.capture();
    current = snapshot(3);
    history.record('replacement', before);
    expect(history.canRedo).toBe(false);
    expect(history.state.undoLabel).toBe('replacement');
  });
});
