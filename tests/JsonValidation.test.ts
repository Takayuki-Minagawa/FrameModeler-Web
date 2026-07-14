import { describe, it, expect, beforeEach } from 'vitest';
import { Document } from '../src/data/Document';
import { deserializeJson } from '../src/io/JsonDeserializer';
import { serializeJson } from '../src/io/JsonSerializer';

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
    expect(() => deserializeJson(json({ nodes: [{ number: 0, pos: { x: 'a', y: 0, z: 0 }, select: false }] }))).toThrow(
      /node\[0\]\.pos\.x/,
    );
  });

  it('rejects a node missing its pos object (I-2)', () => {
    expect(() => deserializeJson(json({ nodes: [{ number: 0, select: false }] }))).toThrow(/node\[0\]\.pos/);
  });

  it('rejects duplicate node numbers (I-3)', () => {
    expect(() =>
      deserializeJson(
        json({
          nodes: [
            { number: 0, pos: { x: 0, y: 0, z: 0 }, select: false },
            { number: 0, pos: { x: 1, y: 0, z: 0 }, select: false },
          ],
        }),
      ),
    ).toThrow(/Duplicate node number/);
  });

  it('rejects a member referencing a missing node', () => {
    expect(() =>
      deserializeJson(
        json({
          nodes: [{ number: 0, pos: { x: 0, y: 0, z: 0 }, select: false }],
          beams: [{ number: 0, nodeI: 0, nodeJ: 9, select: false }],
        }),
      ),
    ).toThrow(/not found/);
  });

  it('rejects a floor with fewer than 3 nodes (I-4)', () => {
    expect(() =>
      deserializeJson(
        json({
          nodes: [
            { number: 0, pos: { x: 0, y: 0, z: 0 }, select: false },
            { number: 1, pos: { x: 1, y: 0, z: 0 }, select: false },
          ],
          floors: [{ number: 0, nodes: [0, 1], select: false, weight: 0, direction: 'X' }],
        }),
      ),
    ).toThrow(/at least 3 nodes/);
  });

  it('falls back to X for an invalid floor direction (I-1)', () => {
    deserializeJson(
      json({
        nodes: [
          { number: 0, pos: { x: 0, y: 0, z: 0 }, select: false },
          { number: 1, pos: { x: 1, y: 0, z: 0 }, select: false },
          { number: 2, pos: { x: 1, y: 1, z: 0 }, select: false },
          { number: 3, pos: { x: 0, y: 1, z: 0 }, select: false },
        ],
        floors: [{ number: 0, nodes: [0, 1, 2, 3], select: false, weight: 0, direction: 'BOGUS' }],
      }),
    );
    expect(doc.planeList.length).toBe(1);
    // direction は X にフォールバックしているはず
    const floor = doc.planeList[0] as unknown as { direction: string };
    expect(floor.direction).toBe('X');
  });

  it('reads legacy v0 without schemaVersion and writes normalized v1 without selection state', () => {
    deserializeJson(
      json({
        nodes: [{ number: 0, pos: { x: 0, y: 0, z: 0 }, select: true }],
      }),
    );

    const output = JSON.parse(serializeJson());
    expect(output.schemaVersion).toBe(1);
    expect(output.nodes[0].select).toBeUndefined();
    expect(doc.nodeList[0].select).toBe(false);
    expect(doc.importMetadata).toBeNull();
  });

  it('rejects unsupported JSON schema versions', () => {
    expect(() => deserializeJson(json({ schemaVersion: 2, nodes: [] }))).toThrow(/Unsupported JSON schemaVersion: 2/);
  });

  it('rejects non-finite coordinates produced by JSON exponent overflow', () => {
    expect(() => deserializeJson('{"nodes":[{"number":0,"pos":{"x":1e400,"y":0,"z":0}}]}')).toThrow(/pos\.x.*finite/);
  });

  it.each([-1, 0.5])('rejects invalid node IDs (%s)', (number) => {
    expect(() =>
      deserializeJson(
        json({
          nodes: [{ number, pos: { x: 0, y: 0, z: 0 } }],
        }),
      ),
    ).toThrow(/node\[0\]\.number.*non-negative integer/);
  });

  it('rejects duplicate member numbers across beams and pillars', () => {
    expect(() =>
      deserializeJson(
        json({
          nodes: [
            { number: 0, pos: { x: 0, y: 0, z: 0 } },
            { number: 1, pos: { x: 1, y: 0, z: 0 } },
            { number: 2, pos: { x: 0, y: 0, z: 1 } },
          ],
          beams: [{ number: 0, nodeI: 0, nodeJ: 1 }],
          pillars: [{ number: 0, nodeI: 0, nodeJ: 2 }],
        }),
      ),
    ).toThrow(/Duplicate member number/);
  });

  it('rejects a member with the same endpoint', () => {
    expect(() =>
      deserializeJson(
        json({
          nodes: [{ number: 0, pos: { x: 0, y: 0, z: 0 } }],
          beams: [{ number: 0, nodeI: 0, nodeJ: 0 }],
        }),
      ),
    ).toThrow(/endpoints must be different/);
  });

  it('rejects a zero-area floor', () => {
    expect(() =>
      deserializeJson(
        json({
          nodes: [
            { number: 0, pos: { x: 0, y: 0, z: 0 } },
            { number: 1, pos: { x: 1, y: 0, z: 0 } },
            { number: 2, pos: { x: 2, y: 0, z: 0 } },
          ],
          floors: [{ number: 0, nodes: [0, 1, 2], weight: 0, direction: 'X' }],
        }),
      ),
    ).toThrow(/collinear|area/);
  });

  it('rejects duplicate plane vertices', () => {
    expect(() =>
      deserializeJson(
        json({
          nodes: [
            { number: 0, pos: { x: 0, y: 0, z: 0 } },
            { number: 1, pos: { x: 1, y: 0, z: 0 } },
            { number: 2, pos: { x: 1, y: 1, z: 0 } },
          ],
          floors: [{ number: 0, nodes: [0, 1, 2, 1], weight: 0, direction: 'X' }],
        }),
      ),
    ).toThrow(/duplicate node reference/);
  });

  it.each([2, 3])('rejects a %s-node Wall because the current schema requires a quadrilateral', (count) => {
    const nodes = [
      { number: 0, pos: { x: 0, y: 0, z: 0 } },
      { number: 1, pos: { x: 1, y: 0, z: 0 } },
      { number: 2, pos: { x: 1, y: 0, z: 1 } },
    ];
    expect(() =>
      deserializeJson(
        json({
          nodes,
          walls: [{ number: 0, nodes: nodes.slice(0, count).map((node) => node.number), weight: 0 }],
        }),
      ),
    ).toThrow(/exactly 4 nodes/);
  });

  it('rejects a non-planar Floor', () => {
    expect(() =>
      deserializeJson(
        json({
          nodes: [
            { number: 0, pos: { x: 0, y: 0, z: 0 } },
            { number: 1, pos: { x: 1, y: 0, z: 0 } },
            { number: 2, pos: { x: 1, y: 1, z: 1 } },
            { number: 3, pos: { x: 0, y: 1, z: 0 } },
          ],
          floors: [{ number: 0, nodes: [0, 1, 2, 3], weight: 0, direction: 'X' }],
        }),
      ),
    ).toThrow(/non-planar/);
  });

  it('rejects a self-intersecting Floor and preserves the current Document atomically', () => {
    deserializeJson(json({ nodes: [{ number: 0, pos: { x: 9, y: 8, z: 7 } }] }));
    const before = serializeJson();
    expect(() =>
      deserializeJson(
        json({
          nodes: [
            { number: 0, pos: { x: 0, y: 0, z: 0 } },
            { number: 1, pos: { x: 1, y: 1, z: 0 } },
            { number: 2, pos: { x: 0, y: 1, z: 0 } },
            { number: 3, pos: { x: 1, y: 0, z: 0 } },
          ],
          floors: [{ number: 0, nodes: [0, 1, 2, 3], weight: 0, direction: 'X' }],
        }),
      ),
    ).toThrow(/self-intersect/);
    expect(serializeJson()).toBe(before);
  });
});
