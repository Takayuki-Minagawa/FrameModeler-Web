import { beforeEach, describe, expect, it } from 'vitest';
import { Beam } from '../src/data/Beam';
import { Document } from '../src/data/Document';
import { Floor } from '../src/data/Floor';
import { summarizeModel } from '../src/data/ModelSummary';
import { Node } from '../src/data/Node';
import { Support } from '../src/data/Support';
import { elementsToCsv, nodesToCsv, summaryToCsv, toCsv, toMeters, toSquareMeters } from '../src/io/CsvExporter';
import { exportFilename } from '../src/io/download';
import { Point3D } from '../src/math/Point3D';

const doc = Document.instance;

beforeEach(() => doc.init());

function node(x: number, y: number, z = 0): Node {
  return new Node(new Point3D(x, y, z));
}

describe('toCsv', () => {
  it('quotes separators, quotes and line breaks and ends every row with CRLF', () => {
    expect(
      toCsv([
        ['a', 'b,c', 'say "hi"'],
        ['line\nbreak', 1.5, null],
        [undefined, Number.NaN, 0],
      ]),
    ).toBe('a,"b,c","say ""hi"""\r\n"line\nbreak",1.5,\r\n,,0\r\n');
  });

  it('neutralises text that a spreadsheet would run as a formula but keeps numbers intact', () => {
    expect(toCsv([['=SUM(A1)', '+1', '-2', '@x', 'G-1', -3]])).toBe("'=SUM(A1),'+1,'-2,'@x,G-1,-3\r\n");
    expect(toCsv([['=1,2']])).toBe('"\'=1,2"\r\n');
  });
});

describe('model CSV exports', () => {
  function build(): void {
    const n = [node(0, 0), node(6000, 0), node(6000, 4000), node(0, 4000)];
    const beam = new Beam(n[0], n[1]);
    beam.section = 'H-400x200';
    const floor = new Floor(n);
    doc.addMany([...n, beam, floor, new Support(n[0], ['ux', 'uz'])]);
  }

  it('lists nodes with their numbers and coordinates', () => {
    build();
    expect(nodesToCsv(doc).split('\r\n')).toEqual([
      'number,x_mm,y_mm,z_mm',
      '0,0,0,0',
      '1,6000,0,0',
      '2,0,4000,0',
      '3,6000,4000,0',
      '',
    ]);
  });

  it('lists every non-node element with node numbers, length and area', () => {
    build();
    expect(elementsToCsv(doc).split('\r\n')).toEqual([
      'kind,number,section,nodes,length_mm,area_mm2',
      'beam,0,H-400x200,0 1,6000,',
      'floor,0,S1,0 1 3 2,,24000000',
      'support,0,,0,,',
      '',
    ]);
  });

  it('writes the quantity summary in metres with a total row', () => {
    build();
    const csv = summaryToCsv(summarizeModel(doc), {
      kind: 'Type',
      section: 'Section',
      count: 'Count',
      lengthM: 'Length (m)',
      areaM2: 'Area (m2)',
      total: 'Total',
      unassigned: '(none)',
      kindName: (kind) => kind.toUpperCase(),
    });
    expect(csv.split('\r\n')).toEqual([
      'Type,Section,Count,Length (m),Area (m2)',
      'BEAM,H-400x200,1,6,',
      'FLOOR,S1,1,,24',
      'Total,,2,6,24',
      '',
    ]);
  });

  it('rounds unit conversions to three decimals without negative zero', () => {
    expect(toMeters(1234.5678)).toBe(1.235);
    expect(toSquareMeters(1_234_567)).toBe(1.235);
    expect(Object.is(toMeters(-0.0001), 0)).toBe(true);
  });
});

describe('exportFilename', () => {
  it('replaces only the extension of the model file name', () => {
    expect(exportFilename('model.json', '', 'png')).toBe('model.png');
    expect(exportFilename('dir/my.model.yaml', '_nodes', 'csv')).toBe('my.model_nodes.csv');
    expect(exportFilename('C:\\work\\frame', '_1F', 'dxf')).toBe('frame_1F.dxf');
    expect(exportFilename('', '', 'dxf')).toBe('model.dxf');
    expect(exportFilename('.hidden', '', 'csv')).toBe('.hidden.csv');
  });
});
