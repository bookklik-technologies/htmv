/**
 * Element and attribute grammar tables (spec 4.2–4.6).
 */
export interface ElementSchema {
  name: string;
  kind: 'structural' | 'declaration' | 'visual-container' | 'visual-leaf' | 'media' | 'host';
  timing: boolean; // accepts start/duration
  required: readonly string[];
  optional: readonly string[];
  childContract: 'none' | 'timelines-visual' | 'series-items' | 'animation-keyframes' | 'cues' | 'assets' | 'any';
}

export const HV_ELEMENTS: Record<string, ElementSchema> = {
  'hv-composition': {
    name: 'hv-composition',
    kind: 'structural',
    timing: false,
    required: ['id', 'width', 'height', 'fps', 'duration'],
    optional: ['background', 'sample-rate', 'channels', 'seed'],
    childContract: 'timelines-visual'
  },
  'hv-assets': { name: 'hv-assets', kind: 'declaration', timing: false, required: [], optional: [], childContract: 'assets' },
  'hv-asset': {
    name: 'hv-asset',
    kind: 'declaration',
    timing: false,
    required: ['id', 'kind', 'src'],
    optional: ['family', 'weight', 'font-style', 'integrity'],
    childContract: 'none'
  },
  'hv-scene': { name: 'hv-scene', kind: 'structural', timing: true, required: [], optional: ['start', 'duration'], childContract: 'timelines-visual' },
  'hv-sequence': { name: 'hv-sequence', kind: 'structural', timing: true, required: [], optional: ['start', 'duration'], childContract: 'timelines-visual' },
  'hv-series': { name: 'hv-series', kind: 'structural', timing: false, required: [], optional: ['start'], childContract: 'series-items' },
  'hv-transition': {
    name: 'hv-transition',
    kind: 'declaration',
    timing: false,
    required: ['duration'],
    optional: ['type', 'direction'],
    childContract: 'none'
  },
  'hv-loop': { name: 'hv-loop', kind: 'structural', timing: false, required: ['iteration-duration', 'count'], optional: ['start'], childContract: 'timelines-visual' },
  'hv-freeze': { name: 'hv-freeze', kind: 'structural', timing: false, required: ['at', 'duration'], optional: ['start'], childContract: 'timelines-visual' },
  'hv-video': {
    name: 'hv-video',
    kind: 'media',
    timing: true,
    required: ['src'],
    optional: ['trim-in', 'trim-out', 'rate', 'audio', 'gain', 'fit', 'position', 'end-behavior', 'track', 'audio-track', 'class', 'id'],
    childContract: 'none'
  },
  'hv-audio': {
    name: 'hv-audio',
    kind: 'media',
    timing: true,
    required: ['src'],
    optional: ['trim-in', 'trim-out', 'rate', 'gain', 'repeat', 'fade-in', 'fade-out', 'track', 'class', 'id'],
    childContract: 'none'
  },
  'hv-animation': {
    name: 'hv-animation',
    kind: 'declaration',
    timing: true,
    required: ['target', 'property', 'duration'],
    optional: ['start', 'from', 'to', 'easing', 'fill', 'mode'],
    childContract: 'animation-keyframes'
  },
  'hv-keyframe': {
    name: 'hv-keyframe',
    kind: 'declaration',
    timing: false,
    required: ['offset', 'value'],
    optional: ['easing'],
    childContract: 'none'
  },
  'hv-captions': { name: 'hv-captions', kind: 'visual-container', timing: true, required: [], optional: ['start', 'duration', 'class', 'id', 'src'], childContract: 'cues' },
  'hv-cue': { name: 'hv-cue', kind: 'declaration', timing: false, required: ['start', 'end'], optional: [], childContract: 'none' },
  'hv-use': {
    name: 'hv-use',
    kind: 'structural',
    timing: true,
    required: ['template'],
    optional: ['start', 'duration', 'props', 'class', 'id'],
    childContract: 'none'
  },
  'hv-player': { name: 'hv-player', kind: 'host', timing: false, required: ['for'], optional: ['controls', 'loop', 'fit'], childContract: 'any' }
};

export const HV_TIMING_WRAPPERS = new Set(['hv-sequence', 'hv-series', 'hv-loop', 'hv-freeze', 'hv-use']);
export const HV_DECLARATION_NODES = new Set(['hv-animation', 'hv-keyframe', 'hv-cue', 'hv-asset', 'hv-transition', 'hv-assets']);

/** Supported visual HTML elements (spec 8.2). */
export const VISUAL_CONTAINERS = new Set(['div', 'section', 'article', 'header', 'footer', 'main', 'aside']);
export const TEXT_LEAVES = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'label']);
export const IMAGE_ELEMENTS = new Set(['img']);
export const DECLARATION_ELEMENTS = new Set(['template', 'style', 'script']);

/** Animatable properties (spec 6.3). */
export const ANIMATABLE_PROPERTIES = new Set([
  'opacity',
  'translate-x',
  'translate-y',
  'rotate',
  'scale-x',
  'scale-y',
  'color',
  'background-color',
  'width',
  'height',
  'left',
  'top',
  'gain',
  'text-number'
]);

/** Targets that accept animations (spec 4.6): visual boxes/leaves, hv-scene, hv-video/hv-audio gain, captions, plugins. */
export const ANIMATION_TARGET_KINDS = new Set(['scene', 'box', 'text', 'image', 'video', 'audio', 'captions', 'plugin']);

/** Generic data-hv timing attributes for ordinary HTML (spec 2.2). */
export const DATA_HV_TIMING = new Set(['data-hv-start', 'data-hv-duration']);

export const DATA_HV_BINDING = new Set([
  'data-hv-text',
  'data-hv-src',
  'data-hv-each',
  'data-hv-as',
  'data-hv-key',
  'data-hv-if',
  'data-hv-component',
  'data-hv-schema',
  'data-hv-props',
  'data-hv-plugin',
  'data-hv-plugin-props'
]);

export const DATA_HV_ATTR_PREFIX = 'data-hv-attr-';
export const DATA_HV_STYLE_PREFIX = 'data-hv-style-';

/** Enumerated attributes accepting exactly true/false (spec 4.5). */
export const ENUMERATED_BOOLEAN: Record<string, readonly string[]> = {
  audio: ['include', 'mute'],
  repeat: ['true', 'false'],
  fit: ['cover', 'contain', 'fill'],
  'end-behavior': ['error', 'hold'],
  fill: ['none', 'backwards', 'forwards', 'both'],
  mode: ['replace'],
  type: ['crossfade', 'slide', 'wipe'],
  direction: ['left', 'right', 'up', 'down']
};

/** Native-style boolean attributes only on host elements (spec 4.5). */
export const NATIVE_BOOLEAN_ATTRS = new Set(['controls', 'loop']);
