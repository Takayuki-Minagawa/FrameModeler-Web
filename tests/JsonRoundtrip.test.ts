import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Document } from '../src/data/Document';
import { Node } from '../src/data/Node';
import { Beam } from '../src/data/Beam';
import { Pillar } from '../src/data/Pillar';
import { Floor } from '../src/data/Floor';
import { Wall } from '../src/data/Wall';
import { BearWall } from '../src/data/BearWall';
import { serializeJson } from '../src/io/JsonSerializer';
import { deserializeJson } from '../src/io/JsonDeserializer';

const doc = Document.instance;

function readSample(name: string): string {
  return readFileSync(resolve(__dirname, '..', 'sample-data', name), 'utf-8');
}

interface Counts {
  nodes: number;
  beams: number;
  pillars: number;
  floors: number;
  walls: number;
  bearWalls: number;
  layers: number;
}

function expectedCounts(jsonString: string): Counts {
  const j = JSON.parse(jsonString);
  return {
    nodes: (j.nodes ?? []).length,
    beams: (j.beams ?? []).length,
    pillars: (j.pillars ?? []).length,
    floors: (j.floors ?? []).length,
    walls: (j.walls ?? []).length,
    bearWalls: (j.bearWalls ?? []).length,
    layers: (j.layers ?? []).length,
  };
}

function actualCounts(): Counts {
  const all = doc.allDataList;
  // BearWall extends Plane (not Wall) and Floor extends Plane; Wall is its own
  // class. Use exact constructor checks to avoid instanceof cross-counting.
  const isExact = (d: object, ctor: Function) =>
    d instanceof (ctor as any) &&
    (d as { constructor: Function }).constructor === ctor;
  return {
    nodes: all.filter(d => isExact(d, Node)).length,
    beams: all.filter(d => isExact(d, Beam)).length,
    pillars: all.filter(d => isExact(d, Pillar)).length,
    floors: all.filter(d => isExact(d, Floor)).length,
    walls: all.filter(d => isExact(d, Wall)).length,
    bearWalls: all.filter(d => isExact(d, BearWall)).length,
    layers: doc.layers.length,
  };
}

const samples = ['pillar_test.json', 'test.json'];

describe('JSON round trip', () => {
  beforeEach(() => {
    doc.init();
  });

  for (const sample of samples) {
    it(`${sample}: deserialize preserves element counts`, () => {
      const raw = readSample(sample);
      const expected = expectedCounts(raw);

      deserializeJson(raw);
      expect(actualCounts()).toEqual(expected);
    });

    it(`${sample}: deserialize -> serialize -> deserialize preserves counts`, () => {
      const raw = readSample(sample);
      const expected = expectedCounts(raw);

      deserializeJson(raw);
      const out1 = serializeJson();

      doc.init();
      deserializeJson(out1);
      expect(actualCounts()).toEqual(expected);
    });

    it(`${sample}: serialize is idempotent (stable after first round trip)`, () => {
      const raw = readSample(sample);

      deserializeJson(raw);
      const out1 = serializeJson();

      doc.init();
      deserializeJson(out1);
      const out2 = serializeJson();

      doc.init();
      deserializeJson(out2);
      const out3 = serializeJson();

      // Once the document has passed through a serialize/deserialize cycle,
      // further cycles must produce byte-identical output.
      expect(out2).toBe(out1);
      expect(out3).toBe(out2);
    });
  }
});
