import { describe, expect, it } from 'vitest';
import { senangIcon, senangShape, senangIconNames, senangShapeCatalog } from '../../packages/htmv/src/senangstart.js';

const svg = (source: string) => decodeURIComponent(source.slice(source.indexOf(',') + 1));

describe('optional SenangStart image sources', () => {
  it('exposes immutable discovery data for both catalogs', () => {
    expect(senangIconNames).toContain('sparkles');
    expect(Object.isFrozen(senangIconNames)).toBe(true);
    const shape = senangShapeCatalog.find((entry) => entry.name === 'soft-nova')!;
    expect(shape.variants).toContain('duotone');
    expect(Object.isFrozen(shape.variants)).toBe(true);
  });

  it('resolves icon color, thickness and intrinsic dimensions without browser globals', () => {
    const source = senangIcon('sparkles', { color: '#cf492e', thickness: 1.5 });
    expect(source).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    const artwork = svg(source);
    expect(artwork).toContain('rgba(207,73,46,1)');
    expect(artwork).toContain('stroke-width="1.5"');
    expect(artwork).toContain('width="24"');
    expect(artwork).toContain('height="24"');
    expect(artwork).not.toMatch(/currentColor|var\(/i);
  });

  it('resolves both duotone channels and uses a deterministic default variant', () => {
    const artwork = svg(senangShape('soft-nova', { variant: 'duotone', primary: '#cf492e', secondary: '#dfb96e' }));
    expect(artwork).toContain('rgba(207,73,46,1)');
    expect(artwork).toContain('rgba(223,185,110,1)');
    expect(artwork).not.toMatch(/currentColor|var\(/i);
    expect(senangShape('soft-nova')).toBe(senangShape('soft-nova', { variant: 'solid' }));
  });

  it('rejects unknown assets, unavailable variants and invalid paint options', () => {
    expect(() => senangIcon('missing-icon')).toThrow('Unknown SenangStart icon');
    expect(() => senangIcon('__proto__')).toThrow('Unknown SenangStart icon');
    expect(() => senangShape('missing-shape')).toThrow('Unknown SenangStart shape');
    expect(() => senangShape('soft-nova', { variant: 'tonal' })).toThrow('Available:');
    expect(() => senangIcon('sparkles', { color: 'var(--ink)' })).toThrow();
    expect(() => senangIcon('sparkles', { color: 'rgb(999,0,0)' })).toThrow();
    for (const thickness of [0, -1, NaN, Infinity]) expect(() => senangIcon('sparkles', { thickness })).toThrow('positive');
  });

  it('resolves every pinned catalog asset and variant to a self-contained source', () => {
    for (const name of senangIconNames) expect(svg(senangIcon(name))).not.toMatch(/currentColor|var\(/i);
    for (const shape of senangShapeCatalog) {
      for (const variant of shape.variants) expect(svg(senangShape(shape.name, { variant }))).not.toMatch(/currentColor|var\(/i);
    }
  });
});
