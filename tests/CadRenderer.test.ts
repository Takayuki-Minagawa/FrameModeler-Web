import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { Beam } from '../src/data/Beam';
import { Constraint } from '../src/data/Constraint';
import { Document } from '../src/data/Document';
import { Floor } from '../src/data/Floor';
import { Node } from '../src/data/Node';
import { Spring } from '../src/data/Spring';
import { Support } from '../src/data/Support';
import { Truss } from '../src/data/Truss';
import { Wall } from '../src/data/Wall';
import { DisplayFilter } from '../src/display/DisplayFilter';
import { Point3D } from '../src/math/Point3D';
import { Layer } from '../src/ui/Layer';
import { CAD, getPalette } from '../src/ui/CadConfig';
import {
  alignedGridBounds,
  CadRenderer,
  chooseGridStep,
  springGlyphPoints,
  triangulatePolygon3D,
  type RenderContext,
} from '../src/ui/CadRenderer';
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

  it('triangulates a concave polygon after projecting a vertical plane to local 2D', () => {
    const points = verticalConcavePoints();
    const indices = triangulatePolygon3D(points);

    expect(indices).toHaveLength((points.length - 2) * 3);
    expect(triangleArea(points, indices)).toBeCloseTo(7);
  });

  it('uses the concave triangulation and stable transparent-plane render ordering', () => {
    const points = verticalConcavePoints();
    const nodes = points.map((point) => new Node(point));
    const floor = new Floor(nodes);
    doc.addMany([...nodes, floor]);
    const scene = new THREE.Scene();
    const renderer = new CadRenderer(scene);
    renderer.rebuildElements(context(true));

    const elementGroup = scene.getObjectByName('cad-elements')!;
    const mesh = elementGroup.children.find(
      (object): object is THREE.Mesh => object instanceof THREE.Mesh && !(object instanceof LineSegments2),
    )!;
    const material = mesh.material as THREE.MeshBasicMaterial;
    expect(mesh.geometry.getIndex()?.count).toBe((points.length - 2) * 3);
    expect(mesh.renderOrder).toBe(10);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(false);
    expect(material.depthTest).toBe(true);
    expect(material.polygonOffset).toBe(true);
    expect(material.polygonOffsetFactor).toBe(1);

    const edge = elementGroup.children.find((object) => object instanceof THREE.LineLoop)!;
    expect(edge.renderOrder).toBeGreaterThan(mesh.renderOrder);
    expect((edge.material as THREE.LineBasicMaterial).depthWrite).toBe(false);
    renderer.dispose();
  });

  it('draws members with screen-space width, updates resolution and preserves per-segment mapping', () => {
    const a = new Node(new Point3D(0, 0, 0));
    const b = new Node(new Point3D(1000, 0, 0));
    const c = new Node(new Point3D(1000, 1000, 0));
    const first = new Beam(a, b);
    const second = new Beam(b, c);
    doc.addMany([a, b, c, first, second]);
    const scene = new THREE.Scene();
    const renderer = new CadRenderer(scene);
    renderer.setViewportSize(800, 600);
    renderer.rebuildElements(context(true));

    const lines = scene
      .getObjectByName('cad-elements')!
      .children.find((object): object is LineSegments2 => object instanceof LineSegments2)!;
    expect(lines.material.worldUnits).toBe(false);
    expect(lines.material.linewidth).toBe(CAD.MEMBER_LINEWIDTH);
    expect(lines.material.resolution.toArray()).toEqual([800, 600]);
    expect(lines.geometry.instanceCount).toBe(2);
    expect(renderer.getMappedData(lines, 0)).toBe(first);
    expect(renderer.getMappedData(lines, 1)).toBe(second);

    renderer.setViewportSize(1200, 900);
    expect(lines.material.resolution.toArray()).toEqual([1200, 900]);
    const disposeMaterial = vi.spyOn(lines.material, 'dispose');
    const disposeGeometry = vi.spyOn(lines.geometry, 'dispose');
    renderer.dispose();
    expect(disposeMaterial).toHaveBeenCalledOnce();
    expect(disposeGeometry).toHaveBeenCalledOnce();
  });

  it('keeps LineSegments2 Raycaster intersections mapped to their member', () => {
    const a = new Node(new Point3D(-1, 0, 0));
    const b = new Node(new Point3D(1, 0, 0));
    const beam = new Beam(a, b);
    doc.addMany([a, b, beam]);
    const scene = new THREE.Scene();
    const renderer = new CadRenderer(scene);
    renderer.setViewportSize(1000, 1000);
    renderer.rebuildElements(context(true));
    const camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 100);
    camera.position.set(0, 0, 10);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);

    expect(renderer.raycast(raycaster).some((hit) => hit.data === beam)).toBe(true);
    renderer.dispose();
  });

  it('applies a UI-independent display filter to rendered and hit-tested elements', () => {
    const visible = new Node(new Point3D(0, 0, 0));
    const hidden = new Node(new Point3D(1000, 0, 0));
    doc.addMany([visible, hidden]);
    const displayFilter = new DisplayFilter();
    displayFilter.isolate(visible);
    const scene = new THREE.Scene();
    const renderer = new CadRenderer(scene, displayFilter);
    renderer.rebuildElements(context(true));

    const points = scene
      .getObjectByName('cad-elements')!
      .children.find((object): object is THREE.Points => object instanceof THREE.Points)!;
    expect((points.geometry.getAttribute('position') as THREE.BufferAttribute).count).toBe(1);
    expect(renderer.getMappedData(points, 0)).toBe(visible);

    const camera = new CameraController(
      () => 1,
      () => 1000,
    );
    expect(renderer.hitTest2D(750, 500, camera, rect, 20)).not.toBe(hidden);
    renderer.dispose();
  });

  it('creates finite spring glyphs for both ordinary and valid zero-length springs', () => {
    const ordinary = springGlyphPoints(new Point3D(0, 0, 0), new Point3D(1000, 0, 0), 2000);
    const zeroLength = springGlyphPoints(new Point3D(5, 6, 7), new Point3D(5, 6, 7), 2000);

    expect(ordinary[0]).toEqual(new Point3D(0, 0, 0));
    expect(ordinary.at(-1)).toEqual(new Point3D(1000, 0, 0));
    expect(ordinary.some((point) => point.y !== 0 || point.z !== 0)).toBe(true);
    expect(zeroLength[0]).toEqual(new Point3D(5, 6, 7));
    expect(zeroLength.at(-1)?.sub(zeroLength[0]).length).toBeGreaterThan(0);
    expect([...ordinary, ...zeroLength].every((point) => [point.x, point.y, point.z].every(Number.isFinite))).toBe(
      true,
    );
  });

  it('hit-tests the visible fallback glyph of a zero-length spring in plan view', () => {
    const nodeI = new Node(new Point3D(0, 0, 0));
    const nodeJ = new Node(new Point3D(0, 0, 0));
    const spring = new Spring(nodeI, nodeJ);
    spring.components = [{ dof: 'ux', stiffness: 10, unit: 'N/mm' }];
    doc.addMany([nodeI, nodeJ, spring]);
    const scene = new THREE.Scene();
    const renderer = new CadRenderer(scene);
    const camera = new CameraController(
      () => 1,
      () => 1000,
    );
    const visibleTip = camera.worldToScreen(new Point3D(80, 0, 0), rect)!;

    expect(renderer.hitTest2D(visibleTip.x, visibleTip.y, camera, rect, 8, (data) => data instanceof Spring)).toBe(
      spring,
    );
    renderer.dispose();
  });

  it('maps dedicated truss, spring, support, constraint and mass glyphs to their model data', () => {
    const coincidentI = new Node(new Point3D(0, 0, 0));
    const coincidentJ = new Node(new Point3D(0, 0, 0));
    const master = new Node(new Point3D(1000, 0, 0));
    const trussEnd = new Node(new Point3D(1000, 1000, 0));
    coincidentI.mass = {
      values: [1, 1, 1, 0, 0, 0],
      translationalUnit: 'kg',
      rotationalUnit: 'kg*m^2',
    };
    const truss = new Truss(master, trussEnd);
    truss.area = 100;
    const spring = new Spring(coincidentI, coincidentJ);
    spring.components = [{ dof: 'ux', stiffness: 10, unit: 'N/mm' }];
    const support = new Support(coincidentI, ['ux', 'uy', 'uz']);
    const constraint = new Constraint(master, 'ux', [{ node: coincidentI, dof: 'ux', coefficient: 1 }]);
    doc.addMany([coincidentI, coincidentJ, master, trussEnd, truss, spring, support, constraint]);
    doc.addLayer(new Layer(0, '1F', { id: 'layer-structural' }));
    const scene = new THREE.Scene();
    const renderer = new CadRenderer(scene);

    renderer.rebuildElements(context(true));

    const objects = scene.getObjectByName('cad-elements')!.children;
    const mappedObjects = (data: Node | Truss | Spring | Support | Constraint): THREE.Object3D[] =>
      objects.filter((object) => renderer.getMappedData(object, 0) === data);
    expect(mappedObjects(truss).some((object) => object instanceof LineSegments2)).toBe(true);
    expect(mappedObjects(truss).some((object) => object instanceof THREE.Points)).toBe(true);
    expect(mappedObjects(spring).some((object) => object instanceof THREE.Line)).toBe(true);
    expect(mappedObjects(support).some((object) => object instanceof THREE.LineSegments)).toBe(true);
    expect(mappedObjects(constraint).some((object) => object instanceof THREE.LineSegments)).toBe(true);
    expect(
      mappedObjects(coincidentI).some(
        (object) =>
          object instanceof THREE.Points && (object.material as THREE.PointsMaterial).size === CAD.NODE_SIZE + 8,
      ),
    ).toBe(true);
    renderer.dispose();
  });

  it('hit-tests support and constraint glyphs with structural predicates and honors layer locking', () => {
    const slave = new Node(new Point3D(0, 0, 0));
    const master = new Node(new Point3D(1000, 0, 0));
    const support = new Support(slave, ['ux']);
    const constraint = new Constraint(slave, 'ux', [{ node: master, dof: 'ux', coefficient: 1 }]);
    doc.addMany([slave, master, support, constraint]);
    const layer = new Layer(0, '1F', { id: 'layer-picking' });
    doc.addLayer(layer);
    doc.shownLayer = layer;
    const scene = new THREE.Scene();
    const renderer = new CadRenderer(scene);
    const camera = new CameraController(
      () => 1,
      () => 1000,
    );
    const slaveScreen = camera.worldToScreen(slave.pos, rect)!;
    const midpoint = camera.worldToScreen(new Point3D(500, 0, 0), rect)!;

    expect(renderer.hitTest2D(slaveScreen.x, slaveScreen.y, camera, rect)).toBe(support);
    expect(renderer.hitTest2D(slaveScreen.x, slaveScreen.y, camera, rect, 10, (data) => data instanceof Support)).toBe(
      support,
    );
    expect(renderer.hitTest2D(slaveScreen.x, slaveScreen.y, camera, rect, 10, (data) => data instanceof Node)).toBe(
      slave,
    );
    expect(renderer.hitTest2D(midpoint.x, midpoint.y, camera, rect, 10, (data) => data instanceof Constraint)).toBe(
      constraint,
    );

    doc.updateLayer(layer, { locked: true });
    expect(renderer.hitTest2D(slaveScreen.x, slaveScreen.y, camera, rect)).toBeNull();
    renderer.dispose();
  });

  it('shows and hit-tests every visible layer in front/right elevation contexts', () => {
    const lower = new Layer(0, '1F', { id: 'layer-lower' });
    const upper = new Layer(3000, '2F', { id: 'layer-upper' });
    doc.addLayer(lower);
    doc.addLayer(upper);
    doc.shownLayer = lower;
    const lowerNode = new Node(new Point3D(-500, 0, 0));
    const upperNode = new Node(new Point3D(500, 0, 3000));
    doc.addMany([lowerNode, upperNode]);
    const scene = new THREE.Scene();
    const renderer = new CadRenderer(scene);
    const elevationContext = { ...context(false), showAllLayers: true };
    renderer.rebuildElements(elevationContext);

    const points = scene
      .getObjectByName('cad-elements')!
      .children.find((object): object is THREE.Points => object instanceof THREE.Points)!;
    expect((points.geometry.getAttribute('position') as THREE.BufferAttribute).count).toBe(2);

    const camera = new CameraController(
      () => 1,
      () => 1000,
    );
    camera.setStandardView('front');
    const screen = camera.worldToScreen(upperNode.pos, rect)!;
    expect(renderer.hitTest2D(screen.x, screen.y, camera, rect, 10, (data) => data === upperNode)).toBeNull();
    expect(renderer.hitTest2D(screen.x, screen.y, camera, rect, 10, (data) => data === upperNode, true)).toBe(
      upperNode,
    );
    renderer.dispose();
  });
});

function verticalConcavePoints(): Point3D[] {
  return [
    new Point3D(0, 0, 0),
    new Point3D(3, 0, 0),
    new Point3D(3, 0, 3),
    new Point3D(2, 0, 3),
    new Point3D(2, 0, 1),
    new Point3D(1, 0, 1),
    new Point3D(1, 0, 3),
    new Point3D(0, 0, 3),
  ];
}

function triangleArea(points: ReadonlyArray<Point3D>, indices: ReadonlyArray<number>): number {
  let area = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = points[indices[i]];
    const b = points[indices[i + 1]];
    const c = points[indices[i + 2]];
    area += Point3D.crossProduct(b.sub(a), c.sub(a)).length / 2;
  }
  return area;
}
