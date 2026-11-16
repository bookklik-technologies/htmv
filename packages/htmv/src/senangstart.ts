import icons from '@bookklik/senangstart-icons/icons';
import shapes, { catalog } from '@bookklik/senangstart-shapes/shapes';
import { parseColor } from '@htmv/core';

export type SenangShapeVariant = 'solid' | 'outline' | 'duotone' | 'tonal';

export interface SenangIconOptions {
  color?: string;
  thickness?: number;
}

export interface SenangShapeOptions extends SenangIconOptions {
  variant?: SenangShapeVariant;
  primary?: string;
  secondary?: string;
}

const shapeIndex = new Map(catalog.shapes.map((shape) => [shape.slug, shape]));

export const senangIconNames: readonly string[] = Object.freeze(Object.keys(icons).sort());
export const senangShapeCatalog = Object.freeze(catalog.shapes.map((shape) => Object.freeze({
  name: shape.slug,
  label: shape.name,
  category: shape.category,
  variants: Object.freeze([...shape.variants]) as readonly SenangShapeVariant[],
  defaultVariant: shape.defaultVariant as SenangShapeVariant
})));

function resolvedColor(value: string): string {
  const components = parseColor(value);
  if (components.some((component) => !Number.isFinite(component) || component < 0 || component > 1)) {
    throw new Error(`SenangStart requires a finite CSS color: ${value}`);
  }
  const [red, green, blue, alpha] = components;
  return `rgba(${Math.round(red * 255)},${Math.round(green * 255)},${Math.round(blue * 255)},${alpha})`;
}

function imageSource(svg: string, options: SenangShapeOptions): string {
  const color = resolvedColor(options.color ?? '#111827');
  const primary = resolvedColor(options.primary ?? options.color ?? '#2563eb');
  const secondary = resolvedColor(options.secondary ?? '#dbeafe');
  let resolved = svg.replace(/currentColor/gi, color)
    .replace(/var\(--ss-shape-primary\s*,[^)]+\)/g, primary)
    .replace(/var\(--ss-shape-secondary\s*,[^)]+\)/g, secondary);
  resolved = resolved.replace(/<svg\b([^>]*)>/, (match, attributes: string) => {
    const viewBox = /viewBox="([^"]+)"/.exec(attributes)?.[1].trim().split(/[\s,]+/).map(Number);
    if (!viewBox || viewBox.length !== 4) throw new Error('SenangStart SVG requires a viewBox.');
    const width = /(?:^|\s)width\s*=/.test(attributes) ? '' : ` width="${viewBox[2]}"`;
    const height = /(?:^|\s)height\s*=/.test(attributes) ? '' : ` height="${viewBox[3]}"`;
    return match.slice(0, -1) + width + height + '>';
  });
  if (options.thickness !== undefined) {
    if (!Number.isFinite(options.thickness) || options.thickness <= 0) throw new Error('SenangStart thickness must be finite and positive.');
    resolved = resolved.replace(/stroke-width="[^"]*"/g, `stroke-width="${options.thickness}"`);
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(resolved)}`;
}

export function senangIcon(name: string, options: SenangIconOptions = {}): string {
  if (!Object.hasOwn(icons, name)) throw new Error(`Unknown SenangStart icon "${name}". Choose a name from senangIconNames.`);
  return imageSource(icons[name], options);
}

export function senangShape(name: string, options: SenangShapeOptions = {}): string {
  const shape = shapeIndex.get(name);
  if (!shape) throw new Error(`Unknown SenangStart shape "${name}". Choose a name from senangShapeCatalog.`);
  const variant = options.variant ?? shape.defaultVariant;
  if (!Object.hasOwn(shape.assets, variant)) throw new Error(`SenangStart shape "${name}" has no "${variant}" variant. Available: ${shape.variants.join(', ')}.`);
  return imageSource(shapes[shape.assets[variant]], options);
}
