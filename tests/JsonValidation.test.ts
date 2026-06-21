import { describe, it, expect, beforeEach } from 'vitest';
import { Document } from '../src/data/Document';
import { deserializeJson } from '../src/io/JsonDeserializer';

const doc = Document.instance;

beforeEach(() => {
  doc.init();
});

function json(obj: unknown): string {
  return JSON.stringify(obj);
}

describe('JsonDeserializer validation (I-2/I-3/I-4)', () => {
  it('rejects a non-object document', () => {
    expect(() => deserializeJson('[]')).toThrow();
  });

  it('rejects a missing required nodes array', () => {
    expect(() => deserializeJson(json({ beams: [] }))).toThrow();
  });

  it('rejects a node with a non-numeric coordinate (I-2)', () => {
    expect(() =>
      deserializeJson(json({ nodes: [{ number: 0, pos: { x: 'a', y: 0, z: 0 }, select: false }] }))
    ).toThrow(/node\[0\]\.pos\.x/);
  });

  it('rejects a node missing its pos object (I-2)', () => {
    expect(() =>
      deserializeJson(json({ nodes: [{ number: 0, select: false }] }))
    ).toThrow(/node\[0\]\.pos/);
  });

  it('rejects duplicate node numbers (I-3)', () => {
    expect(() =>
      deserializeJson(json({
        nodes: [
          { number: 0, pos: { x: 0, y: 0, z: 0 }, select: false },
          { number: 0, pos: { x: 1, y: 0, z: 0 }, select: false },
        ],
      }))
    ).toThrow(/Duplicate node number/);
  });

  it('rejects a member referencing a missing node', () => {
    expect(() =>
      deserializeJson(json({
        nodes: [{ number: 0, pos: { x: 0, y: 0, z: 0 }, select: false }],
        beams: [{ number: 0, nodeI: 0, nodeJ: 9, select: false }],
      }))
    ).toThrow(/not found/);
  });

  it('rejects a floor with fewer than 3 nodes (I-4)', () => {
    expect(() =>
      deserializeJson(json({
        nodes: [
          { number: 0, pos: { x: 0, y: 0, z: 0 }, select: false },
          { number: 1, pos: { x: 1, y: 0, z: 0 }, select: false },
        ],
        floors: [{ number: 0, nodes: [0, 1], select: false, weight: 0, direction: 'X' }],
      }))
    ).toThrow(/at least 3 nodes/);
  });

  it('falls back to X for an invalid floor direction (I-1)', () => {
    deserializeJson(json({
      nodes: [
        { number: 0, pos: { x: 0, y: 0, z: 0 }, select: false },
        { number: 1, pos: { x: 1, y: 0, z: 0 }, select: false },
        { number: 2, pos: { x: 1, y: 1, z: 0 }, select: false },
        { number: 3, pos: { x: 0, y: 1, z: 0 }, select: false },
      ],
      floors: [{ number: 0, nodes: [0, 1, 2, 3], select: false, weight: 0, direction: 'BOGUS' }],
    }));
    expect(doc.planeList.length).toBe(1);
    // direction は X にフォールバックしているはず
    const floor = doc.planeList[0] as { direction: string };
    expect(floor.direction).toBe('X');
  });
});
