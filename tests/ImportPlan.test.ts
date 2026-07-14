import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ImportCommand } from '../src/commands/DocumentCommands';
import { FileController } from '../src/controllers/FileController';
import { Document } from '../src/data/Document';
import { Layer } from '../src/data/Layer';
import { Node } from '../src/data/Node';
import { createCalcYamlImportPlan } from '../src/io/CalcYamlDeserializer';
import { createJsonImportPlan } from '../src/io/JsonDeserializer';
import { serializeJson } from '../src/io/JsonSerializer';
import { Point3D } from '../src/math/Point3D';

const document = Document.instance;

function legacyJson(x: number): string {
  return JSON.stringify({ nodes: [{ number: 0, pos: { x, y: 0, z: 0 } }] });
}

describe('side-effect-free import plans', () => {
  beforeEach(() => document.init());

  it('builds JSON completely before a short synchronous Command commit', () => {
    document.add(new Node(new Point3D(9, 0, 0)));
    const before = serializeJson();
    const plan = createJsonImportPlan(legacyJson(4));
    expect(serializeJson()).toBe(before);

    const events: string[] = [];
    const unsubscribe = document.subscribe((event) => events.push(event.kind));
    document.execute(new ImportCommand('JSON test import', (target) => plan.commit(target)));
    unsubscribe();

    expect(document.nodeList.map((node) => node.pos.x)).toEqual([4]);
    expect(events).toEqual(['model']);
  });

  it('parses and builds YAML without replacing the current Document', async () => {
    document.add(new Node(new Point3D(9, 0, 0)));
    const before = serializeJson();
    const yaml = readFileSync(resolve(__dirname, '..', 'sample-data', 'Test0202_calc.yaml'), 'utf8');
    const plan = await createCalcYamlImportPlan(yaml, { mode: 'source' });
    expect(serializeJson()).toBe(before);

    const summary = document.execute(new ImportCommand('YAML test import', (target) => plan.commit(target)));
    expect(summary.beams).toBe(4);
    expect(summary.trusses).toBe(2);
    expect(document.importMetadata?.summary.format).toBe('calc-yaml');
  });

  it('routes FileController.openText through exactly one ImportCommand', async () => {
    const controller = new FileController(document);
    const execute = vi.spyOn(document, 'execute');

    await expect(controller.openText('frame.json', legacyJson(7), async () => null)).resolves.toBe(true);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0][0]).toBeInstanceOf(ImportCommand);
    expect(document.nodeList[0].pos.x).toBe(7);
    expect(document.filename).toBe('frame.json');
    execute.mockRestore();
  });

  it('defers reset notifications until its ImportCommand commits', () => {
    const controller = new FileController(document);
    document.addLayer(new Layer(0, '1F', { id: 'reset-layer' }));
    document.add(new Node(new Point3D(1, 2, 0)));
    const modelEvents: string[] = [];
    let layerViewEvents = 0;
    const unsubscribeModel = document.subscribe((event) => modelEvents.push(event.kind));
    const unsubscribeLayerView = document.subscribeLayerView(() => layerViewEvents++);

    controller.reset();

    unsubscribeModel();
    unsubscribeLayerView();
    expect(document.allDataList).toHaveLength(0);
    expect(document.layers).toHaveLength(0);
    expect(modelEvents).toEqual(['layers']);
    expect(layerViewEvents).toBe(1);
  });
});
