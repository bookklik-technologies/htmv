/**
 * Isolated layout document (spec 8.1/8.7): a same-origin, library-owned iframe
 * at the composition's logical size, with a versioned neutral reset and
 * border-box sizing. Source scripts cannot run there; only admitted styles are
 * copied. This is layout isolation, not a sandbox against hostile host JS.
 */
export const RESET_CSS = `
  :root { font-size: 16px; }
  html, body { margin: 0; padding: 0; border: 0; background: transparent; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  h1,h2,h3,h4,h5,h6,p,span,label,div,section,article,header,footer,main,aside {
    /* Neutralized UA defaults (spec 8.7): no automatic heading boldness/margins */
    font-weight: inherit; font-style: inherit; font-family: inherit;
    font-size: 16px; line-height: 1.2; color: inherit; text-align: start;
    text-decoration: none;
  }
  body { font-family: sans-serif; color: black; }
  img, video, canvas { display: block; }
  h1,h2,h3,h4,h5,h6,p,span,label { display: block; }
  *, *::before, *::after { animation: none !important; transition: none !important; }
`;

export interface LayoutEnvironment {
  width: number;
  height: number;
  fontFaces: FontFace[];
  styles: { selector: string; declarations: [string, string][] }[];
  inlineStyles: Map<string, [string, string][]>; // by node id
}

export type FontFace2 = FontFace;

export interface LayoutBox {
  id: string; // stable node id
  tag: string;
  kind: 'box' | 'text' | 'image' | 'video' | 'captions' | 'plugin' | 'scene';
  x: number;
  y: number;
  width: number;
  height: number;
  children: LayoutBox[];
  computed: ComputedStyleSubset;
  display: boolean; // false when display:none removes subtree
  visibility: 'visible' | 'hidden';
  text?: string;
  lines?: TextLine[]; // text layout result
  overflowHidden: boolean;
  borderRadiusPx: [number, number, number, number];
  transform?: { fn: string; args: number[] }[];
  transformOrigin?: [number, number];
}

export interface TextLine {
  text: string;
  x: number; // box-local
  y: number; // baseline box-local
  width: number;
}

export interface ComputedStyleSubset {
  color: string;
  backgroundColor: string;
  backgroundImage: string | null;
  backgroundSize: string;
  backgroundPosition: string;
  backgroundRepeat: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  lineHeight: number; // px
  textAlign: string;
  direction: string;
  whiteSpace: string;
  overflowWrap: string;
  textTransform: string;
  textDecorationLine: string;
  borderTopWidth: number;
  borderRightWidth: number;
  borderBottomWidth: number;
  borderLeftWidth: number;
  borderColor: string;
  borderStyle: string;
  objectFit: string;
  objectPosition: string;
  opacity: number;
  visibility: string;
}

export interface LayoutSnapshot {
  width: number;
  height: number;
  boxes: LayoutBox[]; // paint order roots
  dispose(): void;
}

/**
 * Admitted declaration names that are captured into ComputedStyleSubset.
 */
const ADMISSION_ORDER = [
  'color', 'background-color', 'background-image', 'background-size', 'background-position', 'background-repeat',
  'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
  'text-align', 'direction', 'white-space', 'overflow-wrap', 'text-transform', 'text-decoration-line',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-color', 'border-style', 'object-fit', 'object-position', 'opacity'
];

export function applyAdmittedDeclarations(el: HTMLElement, declarations: [string, string][]): void {
  for (const [prop, value] of declarations) {
    try {
      el.style.setProperty(prop, value);
    } catch {
      // unsupported declaration names are rejected by the CSS validator before reaching layout
    }
  }
  // Reflow once at the end of a batch (not per declaration).
  void (el.ownerDocument ?? document);
}

export function collectComputedStyle(el: Element): ComputedStyleSubset {
  const cs = el.ownerDocument.defaultView!.getComputedStyle(el);
  const num = (prop: string): number => parseFloat(cs.getPropertyValue(prop)) || 0;
  return {
    color: cs.color,
    backgroundColor: cs.backgroundColor,
    backgroundImage: cs.backgroundImage === 'none' ? null : cs.backgroundImage,
    backgroundSize: cs.backgroundSize,
    backgroundPosition: cs.backgroundPosition,
    backgroundRepeat: cs.backgroundRepeat,
    fontFamily: cs.fontFamily,
    fontSize: num('font-size'),
    fontWeight: cs.fontWeight,
    fontStyle: cs.fontStyle,
    lineHeight: cs.lineHeight === 'normal' ? num('font-size') * 1.2 : parseFloat(cs.lineHeight),
    textAlign: cs.textAlign,
    direction: cs.direction,
    whiteSpace: cs.whiteSpace,
    overflowWrap: cs.overflowWrap,
    textTransform: cs.textTransform,
    textDecorationLine: cs.textDecorationLine,
    borderTopWidth: num('border-top-width'),
    borderRightWidth: num('border-right-width'),
    borderBottomWidth: num('border-bottom-width'),
    borderLeftWidth: num('border-left-width'),
    borderColor: cs.borderTopColor,
    borderStyle: cs.borderTopStyle,
    objectFit: cs.objectFit,
    objectPosition: cs.objectPosition,
    opacity: Number(cs.opacity),
    visibility: cs.visibility
  };
}
