import type { Layer } from '../data/Layer';

const extrasByLayer = new WeakMap<Layer, Readonly<Record<string, unknown>>>();
const KNOWN_FIELDS = new Set(['id', 'name', 'posZ', 'visible', 'locked']);

export function setLayerJsonExtras(layer: Layer, raw: Readonly<Record<string, unknown>>): void {
  const extras = Object.fromEntries(Object.entries(raw).filter(([key]) => !KNOWN_FIELDS.has(key)));
  if (Object.keys(extras).length > 0) extrasByLayer.set(layer, Object.freeze(extras));
}

export function getLayerJsonExtras(layer: Layer): Readonly<Record<string, unknown>> {
  return extrasByLayer.get(layer) ?? {};
}
