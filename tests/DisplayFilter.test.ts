import { describe, expect, it, vi } from 'vitest';
import { Beam } from '../src/data/Beam';
import { Floor, FloorDirection } from '../src/data/Floor';
import { Layer } from '../src/data/Layer';
import { Node } from '../src/data/Node';
import { Point3D } from '../src/math/Point3D';
import { Spring } from '../src/data/Spring';
import { DisplayFilter } from '../src/display/DisplayFilter';
import {
  DisplayLabelOptions,
  createDisplayLabelDescriptors,
  createElementLabelDescriptors,
} from '../src/display/DisplayLabels';

describe('DisplayFilter', () => {
  it('supports selected-only, explicit hide, isolate and show-all modes', () => {
    const selected = new Node();
    const other = new Node();
    selected.select = true;
    const filter = new DisplayFilter();

    filter.showSelectedOnly();
    expect(filter.allows(selected)).toBe(true);
    expect(filter.allows(other)).toBe(false);

    filter.hide(selected);
    expect(filter.allows(selected)).toBe(false);
    filter.show(selected);
    expect(filter.allows(selected)).toBe(true);

    filter.isolate(other);
    expect(filter.allows(selected)).toBe(false);
    expect(filter.allows(other)).toBe(true);
    other.select = false;
    expect(filter.allows(other)).toBe(true);

    filter.hide(other);
    expect(filter.allows(other)).toBe(false);
    filter.showAll();
    expect(filter.allows(selected)).toBe(true);
    expect(filter.allows(other)).toBe(true);

    expect(filter.isolateSelected([selected, other])).toBe(1);
    expect(filter.allows(selected)).toBe(true);
    expect(filter.allows(other)).toBe(false);
  });

  it('does not enter an empty isolation and leaves stale isolation after document replacement', () => {
    const original = new Node();
    const replacement = new Node();
    const filter = new DisplayFilter();

    expect(filter.isolateSelected([original])).toBe(0);
    expect(filter.mode).toBe('all');
    expect(filter.allows(replacement)).toBe(true);

    filter.isolate(original);
    expect(filter.mode).toBe('isolate');
    filter.prune([replacement]);
    expect(filter.mode).toBe('all');
    expect(filter.allows(replacement)).toBe(true);
  });

  it('captures hidden selections, exposes immutable snapshots and notifies subscribers', () => {
    const a = new Node();
    const b = new Node();
    a.select = true;
    const filter = new DisplayFilter();
    const listener = vi.fn();
    const unsubscribe = filter.subscribe(listener);

    expect(filter.hideSelected([a, b])).toBe(1);
    expect(filter.settings.hidden).toEqual([a]);
    expect(Object.isFrozen(filter.settings.hidden)).toBe(true);
    expect(listener).toHaveBeenCalledOnce();

    a.select = false;
    b.select = true;
    expect(filter.allows(a)).toBe(false);
    expect(filter.allows(b)).toBe(true);

    filter.prune([b]);
    expect(filter.settings.hidden).toEqual([]);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});

describe('display label descriptors', () => {
  it('keeps label toggles UI-independent and immutable', () => {
    const options = new DisplayLabelOptions();
    expect(options.settings.nodeNumber).toBe(false);

    options.setSettings({ nodeNumber: true, section: true, localAxes: true });
    expect(options.isEnabled('nodeNumber')).toBe(true);
    expect(options.isEnabled('memberNumber')).toBe(false);
    expect(Object.isFrozen(options.settings)).toBe(true);

    options.reset();
    expect(options.settings.nodeNumber).toBe(false);
  });

  it('creates number, section, direction, story-height and local-axis data', () => {
    const nodeI = new Node(new Point3D(0, 0, 0));
    const nodeJ = new Node(new Point3D(1000, 0, 0));
    const nodeK = new Node(new Point3D(1000, 1000, 0));
    const nodeL = new Node(new Point3D(0, 1000, 0));
    nodeI.number = 2;
    const beam = new Beam(nodeI, nodeJ);
    beam.number = 3;
    beam.section = 'G2';
    const floor = new Floor([nodeI, nodeJ, nodeK, nodeL]);
    floor.number = 4;
    floor.section = 'S2';
    floor.direction = FloorDirection.Y;
    const layers = [new Layer(6000, '3F'), new Layer(0, '1F'), new Layer(3000, '2F')];
    const options = new DisplayLabelOptions({
      nodeNumber: true,
      memberNumber: true,
      planeNumber: true,
      section: true,
      floorDirection: true,
      weight: true,
      storyHeight: true,
      localAxes: true,
    });

    const labels = createDisplayLabelDescriptors([nodeI, beam, floor], layers, options.settings, { x: -500, y: 0 });
    expect(labels.filter((item) => item.kind === 'nodeNumber').map((item) => item.text)).toEqual(['N2']);
    expect(labels.filter((item) => item.kind === 'memberNumber').map((item) => item.text)).toEqual(['M3']);
    expect(labels.filter((item) => item.kind === 'planeNumber').map((item) => item.text)).toEqual(['P4']);
    expect(labels.filter((item) => item.kind === 'section').map((item) => item.text)).toEqual(['G2', 'S2']);
    expect(labels.find((item) => item.kind === 'floorDirection')?.text).toBe('Y');
    expect(labels.find((item) => item.kind === 'weight')?.text).toBe('W=0');
    expect(labels.filter((item) => item.kind === 'storyHeight').map((item) => item.text)).toEqual(['H=3000', 'H=3000']);

    const axes = labels.filter((item) => item.kind === 'localAxis');
    expect(axes).toHaveLength(6);
    for (const axis of axes) expect(axis.direction?.length).toBeCloseTo(1);
    const beamAxes = axes.filter((item) => item.data === beam);
    const x = beamAxes.find((item) => item.axis === 'x')!.direction!;
    const y = beamAxes.find((item) => item.axis === 'y')!.direction!;
    const z = beamAxes.find((item) => item.axis === 'z')!.direction!;
    expect(Point3D.dotProduct(x, y)).toBeCloseTo(0);
    expect(Point3D.dotProduct(y, z)).toBeCloseTo(0);
    expect(Point3D.dotProduct(z, x)).toBeCloseTo(0);
  });

  it('does not emit disabled or unavailable labels', () => {
    const incompleteBeam = new Beam();
    const options = new DisplayLabelOptions({ memberNumber: true, section: true, localAxes: true });
    expect(createElementLabelDescriptors([incompleteBeam], options.settings)).toEqual([]);
  });

  it('uses an explicit spring orientation for local-axis labels', () => {
    const nodeI = new Node(new Point3D(0, 0, 0));
    const nodeJ = new Node(new Point3D(1000, 0, 0));
    const spring = new Spring(nodeI, nodeJ);
    spring.orientX = Point3D.YDirection.clone();
    spring.orientY = Point3D.ZDirection.clone();
    const labels = createElementLabelDescriptors([spring], new DisplayLabelOptions({ localAxes: true }).settings);

    expect(labels.find((item) => item.axis === 'x')?.direction).toEqual(Point3D.YDirection);
    expect(labels.find((item) => item.axis === 'y')?.direction).toEqual(Point3D.ZDirection);
    expect(labels.find((item) => item.axis === 'z')?.direction).toEqual(Point3D.XDirection);
  });

  it('creates a finite orthonormal local frame for a zero-length spring without an explicit orientation', () => {
    const nodeI = new Node(new Point3D(10, 20, 30));
    const nodeJ = new Node(new Point3D(10, 20, 30));
    const spring = new Spring(nodeI, nodeJ);
    spring.components = [{ dof: 'ux', stiffness: 100, unit: 'N/mm' }];

    const axes = createElementLabelDescriptors([spring], new DisplayLabelOptions({ localAxes: true }).settings).filter(
      (item) => item.kind === 'localAxis',
    );

    expect(axes).toHaveLength(3);
    const directions = axes.map((item) => item.direction!);
    expect(directions.every((direction) => direction.length > 0.999999)).toBe(true);
    expect(Math.abs(Point3D.dotProduct(directions[0], directions[1]))).toBeLessThan(1e-10);
    expect(Math.abs(Point3D.dotProduct(directions[1], directions[2]))).toBeLessThan(1e-10);
    expect(Math.abs(Point3D.dotProduct(directions[2], directions[0]))).toBeLessThan(1e-10);
  });
});
