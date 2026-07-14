import { beforeEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Document } from '../src/data/Document';
import { Node } from '../src/data/Node';
import { Wall } from '../src/data/Wall';
import { Point3D } from '../src/math/Point3D';
import { Layer } from '../src/ui/Layer';
import { getPalette } from '../src/ui/CadConfig';
import { alignedGridBounds, CadRenderer, chooseGridStep, type RenderContext } from '../src/ui/CadRenderer';
import { CameraController } from '../src/ui/CameraController';

const doc = Document.instance;
const rect = { left: 0, top: 0, width: 1000, height: 1000 } as DOMRect;

beforeEach(() => doc.init());

function context(show3D: boolean): RenderContext {
  return {
    palette: getPalette(),
    show3D,
    cameraDistance: 2000,
    cameraCenter: new THREE.Vector3(),
    layerZ: 0,
    showGrid: true,
    gridWidth: 100,
    gridBounds: { minX: -2000, maxX: 2000, minY: -2000, maxY: 2000 },
  };
}

function addVerticalWall(): Wall {
  const nodes = [
    new Node(new Point3D(-100, 0, -100)),
    new Node(new Point3D(100, 0, -100)),
    new Node(new Point3D(100, 0, 100)),
    new Node(new Point3D(-100, 0, 100)),
  ];
  for (const node of nodes) doc.add(node);
  const wall = new Wall(nodes);
  doc.add(wall);
  doc.addLayer(new Layer(0, '0F'));
  doc.shownLayer = doc.layers[0];
  return wall;
}

describe('CadRenderer picking and grid', () => {
  it('maps a Raycaster intersection on a vertical wall back to DocumentData', () => {
    const wall = addVerticalWall();
    const scene = new THREE.Scene();
    const renderer = new CadRenderer(scene);
    renderer.rebuildElements(context(true));

    const camera = new CameraController(
      () => 1,
      () => 1000,
    );
    camera.show3D = true;
    const raycaster = new THREE.Raycaster();
    expect(camera.setRayFromScreen(raycaster, 500, 500, rect)).toBe(true);
    raycaster.params.Line = { threshold: 10 };
    raycaster.params.Points = { threshold: 10 };

    expect(renderer.raycast(raycaster).some((hit) => hit.data === wall)).toBe(true);
    renderer.dispose();
  });

  it('hits a vertical wall as a screen-space line in plan view', () => {
    const wall = addVerticalWall();
    const scene = new THREE.Scene();
    const renderer = new CadRenderer(scene);
    const camera = new CameraController(
      () => 1,
      () => 1000,
    );

    expect(renderer.hitTest2D(500, 504, camera, rect)).toBe(wall);
    renderer.dispose();
  });

  it('aligns the grid globally and selects 1/2/5/10 LOD steps', () => {
    expect(alignedGridBounds({ minX: 155, maxX: 945, minY: -955, maxY: -151 }, 100)).toEqual({
      minX: 100,
      maxX: 1000,
      minY: -1000,
      maxY: -100,
    });
    expect(chooseGridStep(100, 10_000)).toBe(100);
    expect(chooseGridStep(100, 50_000)).toBe(200);
    expect(chooseGridStep(100, 120_000)).toBe(500);
  });
});
