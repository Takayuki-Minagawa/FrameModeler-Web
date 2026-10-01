// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Beam } from '../src/data/Beam';
import { Document } from '../src/data/Document';
import { Node } from '../src/data/Node';
import { kindLabel, setLocale, t } from '../src/i18n';
import { Point3D } from '../src/math/Point3D';
import { formatMeasurement, StatusBar } from '../src/ui/StatusBar';

const doc = Document.instance;
let bar: StatusBar;
let info: HTMLElement;
let version: HTMLElement;
let coordinate: HTMLElement;

beforeEach(() => {
  doc.init();
  localStorage.clear();
  setLocale('ja');
  document.body.innerHTML = '<span id="v"></span><span id="c"></span><span id="i"></span>';
  version = document.querySelector('#v')!;
  coordinate = document.querySelector('#c')!;
  info = document.querySelector('#i')!;
  bar = new StatusBar({ version, coordinate, info }, doc, '9.9.9');
});

afterEach(() => vi.useRealTimers());

describe('StatusBar', () => {
  it('shows model counts, selection and the dirty marker', () => {
    const a = new Node(new Point3D(0, 0, 0));
    const b = new Node(new Point3D(1000, 0, 0));
    doc.addMany([a, b, new Beam(a, b)]);
    bar.setSelectedCount(2);
    expect(info.textContent).toBe('N:2 M:1 P:0 S:2');
    expect(version.textContent).toBe('Ver.9.9.9');

    bar.setDirty(true);
    expect(version.textContent).toBe('Ver.9.9.9 *');
    bar.refresh();
    expect(version.textContent).toBe('Ver.9.9.9 *');

    bar.setCoordinate(new Point3D(1.26, -2, 3000));
    expect(coordinate.textContent).toBe('(1.3, -2.0, 3000.0)');
  });

  it('joins operation, measurement, work-plane and snap details and follows the locale', () => {
    bar.setOperationStatus('firstPointSelected');
    bar.setMeasurement({ from: new Point3D(0, 0, 0), to: new Point3D(300, 400, 0), final: true });
    bar.setWorkPlaneError('parallel');
    bar.setSnapKind('midpoint');
    expect(info.textContent).toBe(
      'N:0 M:0 P:0 S:0 — 1点目選択済み / 距離 500.0 mm（ΔX 300.0 / ΔY 400.0 / ΔZ 0.0） / ' +
        '視線が現在レイヤーの作業平面と平行なため配置できません / スナップ: 中点',
    );
    expect(bar.workPlaneMessage).toBe('視線が現在レイヤーの作業平面と平行なため配置できません');

    setLocale('en');
    bar.refresh();
    expect(info.textContent).toContain('First point selected / Distance 500.0 mm (ΔX 300.0 / ΔY 400.0 / ΔZ 0.0)');
    expect(info.textContent).toContain('Snap: Midpoint');

    bar.setOperationStatus(null);
    bar.setMeasurement(null);
    bar.setWorkPlaneError(null);
    bar.setSnapKind('none');
    expect(info.textContent).toBe('N:0 M:0 P:0 S:0');
    expect(bar.workPlaneMessage).toBe('');
  });

  it('shows a notice first and clears it after a while, restarting the timer for a newer notice', () => {
    vi.useFakeTimers();
    bar.showNotice(() => 'first');
    expect(info.textContent).toBe('N:0 M:0 P:0 S:0 — first');

    vi.advanceTimersByTime(7000);
    bar.showNotice(() => 'second');
    vi.advanceTimersByTime(7000);
    expect(info.textContent).toBe('N:0 M:0 P:0 S:0 — second');
    vi.advanceTimersByTime(1000);
    expect(info.textContent).toBe('N:0 M:0 P:0 S:0');
  });

  it('re-translates a visible notice when the language changes', () => {
    vi.useFakeTimers();
    bar.showNotice(() => t('msg.noOrphans'));
    expect(info.textContent).toBe('N:0 M:0 P:0 S:0 — 孤立節点はありません');
    setLocale('en');
    bar.refresh();
    expect(info.textContent).toBe('N:0 M:0 P:0 S:0 — There are no orphan nodes');
  });

  it('formats signed deltas without negative zero', () => {
    const text = formatMeasurement({ from: new Point3D(100, 0, 0), to: new Point3D(0, -0.01, 3000), final: false });
    expect(text).toBe('距離 3001.7 mm（ΔX -100.0 / ΔY 0.0 / ΔZ 3000.0）');
  });
});

describe('i18n parameters', () => {
  it('replaces named placeholders and keeps unknown ones', () => {
    expect(t('msg.confirmDelete', { count: 3 })).toBe('選択した3要素を削除しますか？');
    expect(t('msg.nodeReferenced', { node: 1, type: '梁' })).toBe('節点 1 は 梁 {number} から参照されています');
    expect(t('msg.confirmDelete')).toBe('選択した{count}要素を削除しますか？');
    setLocale('en');
    expect(t('msg.confirmDeleteLayer', { name: 'RF', count: 0 })).toBe('Delete layer "RF"? (0 related elements)');
  });

  it('translates every model kind', () => {
    expect(kindLabel('bearWall')).toBe('耐力壁');
    setLocale('en');
    expect(kindLabel('pillar')).toBe('Pillar');
    expect(kindLabel('constraint')).toBe('Constraint');
  });
});
