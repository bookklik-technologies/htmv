/**
 * Timing resolution and structural validation (spec 3, 4.4, 4.6, 5, 6).
 */
import {
  Rational,
  parseTimeAttribute,
  parseFps,
  framesForSeconds,
  Diagnostic,
  error,
  warning,
  computeSeriesSchedule,
  ClockTransform
  ,CompilationError, PROPERTY_REGISTRY, parseEasing, parseColor
} from '@htmv/core';
import { CNode } from './parse.js';
import { selectAll } from 'css-select';
import { Element, Document } from 'domhandler';
import { HV_ELEMENTS, VISUAL_CONTAINERS, TEXT_LEAVES, IMAGE_ELEMENTS, DATA_HV_TIMING, ENUMERATED_BOOLEAN, ANIMATABLE_PROPERTIES, ANIMATION_TARGET_KINDS } from './grammar.js';

export type ResolvedDuration = Rational | 'auto' | 'remainder';

export interface MediaTiming {
  trimIn: Rational;
  trimOut: Rational | null; // null => source extent
  rate: Rational;
  audio?: 'include' | 'mute';
  gain?: string;
  fit?: string;
  position?: string;
  endBehavior?: 'error' | 'hold';
  track?: number;
  audioTrack?: number;
  repeat?: boolean;
  fadeIn?: Rational;
  fadeOut?: Rational;
  fadeOffset?: Rational;
  fadeDuration?: Rational;
}

export interface ResolvedNode {
  id: string;
  nodeId: string;
  kind: 'composition' | 'scene' | 'sequence' | 'series' | 'loop' | 'freeze' | 'box' | 'text' | 'image' | 'video' | 'audio' | 'captions' | 'plugin' | 'declaration';
  tag: string;
  parentId: string | null;
  childIds: string[];
  start: Rational;
  /** start relative to the parent's start; used for local clock mapping (spec 3.3) */
  relativeStart: Rational;
  duration: ResolvedDuration;
  clock?: ClockTransform;
  attributes: Record<string, string>;
  text?: string;
  media?: MediaTiming;
  transition?: { type: string; direction: string; duration: Rational };
  /** hv-transition declared directly after this series item (spec 5.2) */
  transitionAfter?: { type: string; direction: string; duration: Rational };
  captions?: { cues: { start: Rational; end: Rational; text: string }[] };
  isDirectSeriesItem?: boolean;
  keyframes?: { offset: number; value: string; easing?: string }[];
  childrenResolved?: boolean;
}

export interface TimingResult {
  nodes: Map<string, ResolvedNode>;
  animations: ResolvedAnimation[];
  diagnostics: Diagnostic[];
  order: string[];
}

export interface ResolvedAnimation {
  id: string;
  targetSelector: string;
  property: string;
  start: Rational;
  duration: Rational;
  from?: string;
  to?: string;
  easing: string;
  fill: 'none' | 'backwards' | 'forwards' | 'both';
  mode: 'replace';
  keyframes?: { offset: number; value: string; easing?: string }[];
  clockScopeId: string; // nearest structural clock ancestor
  instanceKey?: string;
  /** Optional inclusive scope-clock sampling bounds, used for held still-layer handles. */
  sampleStart?: Rational;
  sampleEnd?: Rational;
}

export interface MediaExtentResolver {
  /** Returns playable extent seconds for a media src (asset id or URL). */
  getExtent(src: string, kind: 'video' | 'audio'): { videoExtent?: Rational; audioExtent?: Rational } | undefined;
}

export class TimingResolver {
  nodes = new Map<string, ResolvedNode>();
  animations: ResolvedAnimation[] = [];
  diagnostics: Diagnostic[] = [];
  order: string[] = [];
  private idCounts = new Map<string, number>();
  private seenIds = new Set<string>();
  private counter = 0;

  constructor(
    private fps: Rational,
    private rootDurationFrames: bigint,
    private mediaExtents: MediaExtentResolver | null
  ) {}

  resolveTree(root: CNode): void {
    const comp = root.kind === 'element' && root.tag === 'hv-composition' ? root : root.children.find((c) => c.kind === 'element' && c.tag === 'hv-composition');
    if (!comp) return;
    this.resolveElement(comp, null, Rational.zero(), this.rootDuration());
  }

  private rootDuration(): Rational {
    return Rational.of(this.rootDurationFrames).div(this.fps);
  }

  private resolveChildren(parent: CNode, parentId: string | null, start: Rational, available: Rational): void {
    let seriesItems: { node: ResolvedNode; transition: { type: string; direction: string; duration: Rational } | null }[] = [];
    const isSeries = parent.tag === 'hv-series';
    let firstItemSeen = false;

    for (const child of parent.children) {
      if (child.kind === 'text') {
        if (child.text.trim() === '') continue;
        if (VISUAL_CONTAINERS.has(parent.tag)) {
          this.resolveVisualHtml({ ...child, kind: 'element', tag: 'span', attributes: {}, children: [child] }, parentId, start, available, 'text');
        }
        continue;
      }
      if (child.tag === 'hv-transition') {
        if (!isSeries) {
          this.diag(error('E_TRANSITION_PARENT', 'hv-transition is only valid between direct series items.', { attribute: 'hv-transition' }));
          continue;
        }
        if (seriesItems.length === 0) {
          this.diag(error('E_TRANSITION_PARENT', 'hv-transition must follow a direct series item.'));
          continue;
        }
        const d = this.parseTime(child.attributes['duration'] ?? '', child);
        seriesItems[seriesItems.length - 1].transition = {
          type: child.attributes['type'] ?? 'crossfade',
          direction: child.attributes['direction'] ?? 'left',
          duration: d ?? Rational.zero()
        };
        continue;
      }
      if (child.tag === 'hv-animation' || child.tag === 'hv-keyframe' || child.tag === 'hv-cue' || child.tag === 'hv-asset' || child.tag === 'hv-assets' || child.tag === 'style' || child.tag === 'script' || child.tag === 'template') {
        if (child.tag === 'hv-animation') {
          let scope = parentId ? this.nodes.get(parentId) : undefined;
          while (scope && ['box', 'text', 'image'].includes(scope.kind)) scope = scope.parentId ? this.nodes.get(scope.parentId) : undefined;
          this.resolveAnimation(child, scope?.id ?? '');
        }
        continue;
      }
      const node = this.resolveElement(child, parentId, start, available, isSeries ? 'item' : undefined);
      if (!node) continue;
      if (isSeries) {
        seriesItems.push({ node, transition: null });
        firstItemSeen = true;
      }
    }

    if (isSeries && seriesItems.length > 0) {
      this.finalizeSeries(parentId, seriesItems);
    }
  }

  private finalizeSeries(parentId: string | null, items: { node: ResolvedNode; transition: { type: string; direction: string; duration: Rational } | null }[]): void {
    for (const item of items) {
      if (item.node.duration === 'auto') item.node.duration = this.resolveMediaAuto(item.node);
      if (item.node.duration === 'remainder') { this.diag(error('E_DURATION_CYCLE', 'Series items require independently resolved lengths.')); return; }
    }
    // Validate overlaps
    for (let i = 0; i < items.length - 1; i++) {
      const t = items[i].transition;
      if (!t) continue;
      if (t.duration.lte(Rational.zero())) {
        this.diag(error('E_TRANSITION', 'Transition overlap must be positive.', { attribute: 'duration' }));
        continue;
      }
      const incoming = items[i + 1].node;
      if (t.duration.gte(items[i].node.duration as Rational) || t.duration.gte(incoming.duration as Rational)) {
        this.diag(error('E_TRANSITION', 'Each overlap must be strictly less than each neighboring item\'s length.', { attribute: 'duration' }));
      }
      // three-way overlap: incoming-overlap + outgoing-overlap must not exceed any middle item
      if (i > 0 && items[i - 1].transition) {
        const sum = items[i - 1].transition!.duration.add(t.duration);
        if (sum.gt(items[i].node.duration as Rational)) {
          this.diag(error('E_TRANSITION', 'Three-way overlap: incoming-overlap + outgoing-overlap must not exceed a middle item\'s length.'));
        }
      }
    }
    // Resolve item durations now (series items need finite lengths)
    const scheduleInput = items.map((it) => {
      let d = it.node.duration;
      if (d === 'remainder') {
        this.diag(error('E_DURATION_CYCLE', 'Series item length must be independently resolvable; parent-remainder inheritance inside a series is a cycle.', { nodeId: it.node.id }));
        return { duration: Rational.zero(), overlapAfter: Rational.zero() };
      }
      if (d === 'auto') {
        d = this.resolveMediaAuto(it.node);
      }
      return { duration: d as Rational, overlapAfter: it.transition?.duration ?? Rational.zero() };
    });
    const { starts, total } = computeSeriesSchedule(scheduleInput);
    // series length
    const seriesNode = this.nodes.get(parentId ?? '');
    if (seriesNode) {
      seriesNode.duration = total;
    }
    items.forEach((it, i) => {
      const oldStart = it.node.start;
      it.node.start = starts[i].add(this.nodes.get(parentId ?? '')?.start ?? Rational.zero());
      const shift = it.node.start.sub(oldStart);
      const shiftChildren = (n: ResolvedNode): void => {
        for (const cid of n.childIds) {
          const child = this.nodes.get(cid)!;
          child.start = child.start.add(shift);
          shiftChildren(child);
        }
      };
      shiftChildren(it.node);
      it.node.relativeStart = starts[i];
      it.node.duration = scheduleInput[i].duration;
      if (it.transition && scheduleInput[i].overlapAfter.gt(Rational.zero())) {
        it.node.transitionAfter = { type: it.transition.type, direction: it.transition.direction, duration: it.transition.duration };
      }
    });
  }

  private resolveMediaAuto(node: ResolvedNode): Rational {
    if (!node.media || !this.mediaExtents) return Rational.zero();
    const ext = this.mediaExtents.getExtent(node.attributes['src'] ?? '', node.kind === 'video' ? 'video' : 'audio');
    if (!ext) {
      this.diag(error('E_ASSET_FETCH', `Source metadata for "${node.attributes['src']}" could not be inspected; duration=auto cannot resolve.`));
      return Rational.zero();
    }
    const extent = node.kind === 'video' ? ext.videoExtent : ext.audioExtent;
    if (extent === undefined) {
      this.diag(error('E_CODEC_DECODE', `No playable ${node.kind} extent for "${node.attributes['src']}".`));
      return Rational.zero();
    }
    const trimOut = node.media.trimOut ?? extent;
    return trimOut.sub(node.media.trimIn).div(node.media.rate);
  }

  private nextId(node: CNode): string {
    this.counter++;
    const authorId = node.attributes['id'];
    if (authorId) {
      if (this.seenIds.has(authorId)) {
        this.diag(error('E_ELEMENT_UNSUPPORTED', `Duplicate author id ${authorId} in the expanded composition.`));
        // duplicated after expansion -> instance-local rewrite (spec 4.1)
        const n = (this.idCounts.get(authorId) ?? 0) + 1;
        this.idCounts.set(authorId, n);
        return `${authorId}__hv${n}`;
      }
      this.seenIds.add(authorId);
      return authorId;
    }
    return `hv-n${this.counter}`;
  }

  private diag(d: Diagnostic): void {
    this.diagnostics.push(d);
  }

  parseTime(text: string | undefined, node: CNode, attribute = 'start'): Rational | undefined {
    if (text === undefined || text === '') return undefined;
    if (text === 'auto') {
      this.diag(error('E_TIME_UNIT', `Attribute "${attribute}" does not accept "auto".`, { attribute, nodeId: node.attributes['id'] }));
      return undefined;
    }
    try {
      const parsed = parseTimeAttribute(text);
      if (parsed.kind === 'frames') {
        // Frame counts use the composition output frame rate (spec 3.1): n frames = n/fps seconds
        return parsed.value.div(this.fps);
      }
      // seconds/ms: exact rational
      return parsed.value;
    } catch (e) {
      const errors = e instanceof CompilationError ? e.diagnostics : [e as Diagnostic];
      for (const d of errors) this.diag({ ...d, nodeId: node.attributes.id, attribute });
      return undefined;
    }
  }

  parseDuration(text: string | undefined, node: CNode, attribute = 'duration'): ResolvedDuration {
    if (text === undefined || text === '') return 'remainder';
    if (text === 'auto') return 'auto';
    const t = this.parseTime(text, node, attribute);
    if (t === undefined) return 'remainder';
    if (t.lte(Rational.zero())) {
      this.diag(error('E_DURATION', `Negative explicit duration is always invalid; received "${text}".`, { attribute, nodeId: node.attributes['id'] }));
      return 'remainder';
    }
    return t;
  }

  private resolveElement(node: CNode, parentId: string | null, start: Rational, available: Rational, seriesItem?: 'item'): ResolvedNode | null {
    if (node.tag === 'hv-composition' && parentId) { this.diag(error('E_ROOT', 'Nested compositions are invalid.')); return null; }
    if (seriesItem === 'item' && 'start' in node.attributes) {
      this.diag(error('E_SERIES_START', 'An explicit start on a direct series item is invalid; series timing is structural.'));
      return null;
    }
    const schema = HV_ELEMENTS[node.tag];
    if (!schema) {
      // ordinary HTML: check supported visual element
      if (VISUAL_CONTAINERS.has(node.tag) || TEXT_LEAVES.has(node.tag)) {
        return this.resolveVisualHtml(node, parentId, start, available, VISUAL_CONTAINERS.has(node.tag) ? 'box' : 'text');
      }
      if (IMAGE_ELEMENTS.has(node.tag)) {
        return this.resolveVisualHtml(node, parentId, start, available, 'image');
      }
      if (node.tag === 'canvas' && node.attributes['data-hv-plugin']) return this.resolveVisualHtml(node, parentId, start, available, 'plugin');
      if (node.tag === 'br') {
        return null;
      }
      this.diag(error('E_ELEMENT_UNSUPPORTED', `Element <${node.tag}> is not supported in HTMV compositions.`));
      return null;
    }

    const id = this.nextId(node);
    for (const required of schema.required) if (!node.attributes[required]) this.diag(error('E_UNKNOWN_ATTR', `${node.tag} requires ${required}.`, { attribute: required, nodeId: id }));
    const allowed = new Set([...schema.required, ...schema.optional, ...(schema.timing ? ['start', 'duration'] : []), 'id', 'class', 'style', 'lang', 'dir']);
    for (const attr of Object.keys(node.attributes)) if (!allowed.has(attr) && !attr.startsWith('data-') && !attr.startsWith('aria-') && !attr.startsWith('hv-')) this.diag(error('E_UNKNOWN_ATTR', `${node.tag} does not accept ${attr}.`, { attribute: attr, nodeId: id }));
    const kind = this.kindFor(node.tag);
    const resolved: ResolvedNode = {
      id,
      nodeId: id,
      kind,
      tag: node.tag,
      parentId,
      childIds: [],
      start,
      relativeStart: start,
      duration: 'remainder',
      attributes: { ...node.attributes },
      text: node.text
    };
    this.nodes.set(id, resolved);
    this.order.push(id);

    switch (node.tag) {
      case 'hv-composition':
        resolved.start = Rational.zero();
        resolved.duration = this.rootDuration();
        this.resolveChildren(node, id, Rational.zero(), this.rootDuration());
        break;
      case 'hv-scene':
      case 'hv-sequence': {
        const s = this.parseTime(node.attributes['start'] ?? '0', node) ?? Rational.zero();
        resolved.start = start.add(s); // negative starts allowed for scene/sequence (spec 4.6)
        resolved.clock = resolved.clock ?? { kind: 'offset', start: resolved.start };
        resolved.duration = this.parseDuration(node.attributes['duration'], node);
        break;
      }
      case 'hv-series': {
        const s = this.parseTime(node.attributes['start'] ?? '0', node) ?? Rational.zero();
        resolved.start = start.add(s);
        resolved.clock = { kind: 'offset', start: resolved.start };
        if (node.attributes['duration'] !== undefined) {
          this.diag(error('E_DURATION_CYCLE', 'hv-series rejects an author duration; its length is structural.'));
        }
        break;
      }
      case 'hv-loop': {
        const s = this.parseTime(node.attributes['start'] ?? '0', node) ?? Rational.zero();
        resolved.start = start.add(s);
        resolved.clock = { kind: 'offset', start: resolved.start };
        if (node.attributes['duration'] !== undefined) {
          this.diag(error('E_DURATION_CYCLE', 'hv-loop rejects an author duration; its length is structural.'));
        }
        const iterDur = this.parseTime(node.attributes['iteration-duration'], node, 'iteration-duration');
        const count = Number(node.attributes['count'] ?? '');
        if (iterDur === undefined || iterDur.lte(Rational.zero())) {
          this.diag(error('E_TIME_UNIT', 'hv-loop iteration-duration must be a positive time value.', { attribute: 'iteration-duration' }));
          resolved.duration = Rational.zero();
          break;
        }
        if (!Number.isSafeInteger(count) || count < 1) {
          this.diag(error('E_TIME_UNIT', 'hv-loop count must be an integer >= 1.', { attribute: 'count' }));
          resolved.duration = Rational.zero();
          break;
        }
        // Resolve children with iteration length (children resolved here; skipped post-switch)
        const childAvailable = iterDur;
        resolved.childrenResolved = true;
        this.resolveChildren(node, id, resolved.start, childAvailable);
        // child durations: children with remainder inherit iteration length
        for (const cid of resolved.childIds) {
          const c = this.nodes.get(cid);
          if (c && c.duration === 'remainder') {
            c.duration = iterDur;
          }
          // advance starts per iteration handled at evaluation time via loop clock
        }
        resolved.duration = iterDur.mul(Rational.fromInteger(BigInt(count)));
        resolved.clock = { kind: 'loop', iterationDuration: iterDur };
        break;
      }
      case 'hv-freeze': {
        resolved.duration = this.parseTime(node.attributes['duration'], node, 'duration') ?? Rational.zero();
        const at = this.parseTime(node.attributes['at'], node, 'at');
        if (at === undefined) {
          this.diag(error('E_TIME_UNIT', 'hv-freeze requires an explicit positive duration and an at value.'));
          break;
        }
        resolved.start = start.add(this.parseTime(node.attributes['start'] ?? '0', node) ?? Rational.zero());
        const extent = resolved.duration as Rational;
        if (at.gte(extent) || at.lt(Rational.zero())) {
          this.diag(error('E_TIME_UNIT', `freeze at must lie in [0, duration); received at=${at.toString()} with duration=${extent.toString()}.`));
        }
        resolved.clock = { kind: 'freeze', at };
        // children resolve inside the frozen extent
        resolved.childrenResolved = true;
        this.resolveChildren(node, id, resolved.start, extent);
        // children: use freeze's declared duration as extent
        for (const cid of resolved.childIds) {
          const c = this.nodes.get(cid);
          if (c && c.duration === 'remainder') c.duration = extent;
        }
        this.checkNoAudioUnderFreeze(id);
        break;
      }
      case 'hv-video':
      case 'hv-audio': {
        resolved.start = start.add(this.parseTime(node.attributes['start'] ?? '0', node) ?? Rational.zero());
        resolved.duration = this.parseDuration(node.attributes['duration'], node);
        const src = node.attributes['src'] ?? '';
        resolved.attributes['src'] = src;
        const trimIn = this.parseTime(node.attributes['trim-in'] ?? '0', node, 'trim-in') ?? Rational.zero();
        if (trimIn.lt(Rational.zero())) {
          this.diag(error('E_DURATION', 'Source trims are nonnegative.', { attribute: 'trim-in', nodeId: id }));
        }
        const trimOut = node.attributes['trim-out'] !== undefined ? this.parseTime(node.attributes['trim-out'], node, 'trim-out') : undefined;
        const rateText = node.attributes['rate'] ?? '1';
        let rate = Rational.of(1n);
        try {
          rate = Rational.fromDecimalString(rateText);
        } catch {
          this.diag(error('E_TIME_UNIT', `Invalid rate "${rateText}".`, { attribute: 'rate', nodeId: id }));
        }
        if (rate.lt(Rational.of(1n, 4n)) || rate.gt(Rational.of(4n))) {
          this.diag(error('E_TIME_UNIT', `Rate must be in 0.25–4; received ${rateText}.`, { attribute: 'rate', nodeId: id }));
        }
        const media: MediaTiming = {
          trimIn,
          trimOut: trimOut === undefined ? null : trimOut,
          rate,
          audio: node.tag === 'hv-video' ? ((node.attributes['audio'] as 'include' | 'mute') ?? 'include') : undefined,
          gain: node.attributes['gain'],
          fit: node.attributes['fit'],
          position: node.attributes['position'],
          endBehavior: (node.attributes['end-behavior'] as 'error' | 'hold') ?? 'error',
          track: node.attributes['track'] !== undefined ? Number(node.attributes['track']) : undefined,
          audioTrack: node.attributes['audio-track'] !== undefined ? Number(node.attributes['audio-track']) : undefined,
          repeat: node.tag === 'hv-audio' ? node.attributes['repeat'] === 'true' : undefined,
          fadeIn: node.attributes['fade-in'] !== undefined ? (this.parseTime(node.attributes['fade-in'], node, 'fade-in') ?? Rational.zero()) : Rational.zero(),
          fadeOut: node.attributes['fade-out'] !== undefined ? (this.parseTime(node.attributes['fade-out'], node, 'fade-out') ?? Rational.zero()) : Rational.zero(),
          fadeOffset: node.attributes['fade-offset'] !== undefined ? this.parseTime(node.attributes['fade-offset'], node, 'fade-offset') : undefined,
          fadeDuration: node.attributes['fade-duration'] !== undefined ? this.parseTime(node.attributes['fade-duration'], node, 'fade-duration') : undefined
        };
        if (media.fadeDuration?.lte(Rational.zero()) || media.fadeIn?.lt(Rational.zero()) || media.fadeOut?.lt(Rational.zero())) this.diag(error('E_TIME_UNIT', 'Fade duration must be positive and fade lengths nonnegative.', { nodeId: id }));
        if (node.attributes['repeat'] !== undefined && !['true', 'false'].includes(node.attributes['repeat'])) {
          this.diag(error('E_ENUM', `repeat accepts only the exact strings true and false; received "${node.attributes['repeat']}".`, { attribute: 'repeat', nodeId: id }));
        }
        resolved.media = media;
        if (node.tag === 'hv-audio' && node.attributes['audio'] !== undefined) {
          this.diag(error('E_UNKNOWN_ATTR', 'hv-audio does not accept audio/fit/position/end-behavior attributes.', { attribute: 'audio', nodeId: id }));
        }
        break;
      }
      case 'hv-captions': {
        resolved.start = start.add(this.parseTime(node.attributes['start'] ?? '0', node) ?? Rational.zero());
        resolved.duration = this.parseDuration(node.attributes['duration'], node);
        const cues: { start: Rational; end: Rational; text: string }[] = [];
        for (const cue of node.children) {
          if (cue.kind === 'text' && cue.text.trim() === '') continue;
          if (cue.kind !== 'element' || cue.tag !== 'hv-cue') continue;
          const cs = this.parseTime(cue.attributes['start'], cue, 'start');
          const ce = this.parseTime(cue.attributes['end'], cue, 'end');
          if (cs === undefined || ce === undefined) continue;
          if (ce.lte(cs)) {
            this.diag(error('E_TIME_UNIT', 'hv-cue end must be greater than start.', { nodeId: cue.attributes['id'] }));
            continue;
          }
          const text = cue.children.map((c) => (c.kind === 'text' ? c.text : '')).join('').trim();
          cues.push({ start: cs, end: ce, text });
        }
        resolved.captions = { cues };
        break;
      }
      default:
        this.diag(error('E_ELEMENT_UNSUPPORTED', `Element <${node.tag}> is not supported here.`));
        return null;
    }

    // effective start beyond parent's end -> empty interval warning (spec 3.2)
    const parent = parentId ? this.nodes.get(parentId) : undefined;
    resolved.relativeStart = parent ? resolved.start.sub(parent.start) : resolved.start;
    if (!['scene', 'sequence', 'composition'].includes(resolved.kind) && resolved.relativeStart.lt(Rational.zero())) this.diag(error('E_TIME_UNIT', 'Only scenes and sequences admit negative starts.', { nodeId: id }));
    if (['sequence', 'series', 'loop', 'freeze'].includes(resolved.kind) && node.attributes.style) this.diag(error('E_STYLE_UNSUPPORTED', 'Transparent timeline wrappers cannot have authored styles.', { nodeId: id }));
    if (resolved.duration === 'auto' && resolved.media) resolved.duration = this.resolveMediaAuto(resolved);
    if (resolved.duration === 'remainder' && !seriesItem) {
      const remaining = available.sub(resolved.start.sub(start));
      resolved.duration = remaining.gt(Rational.zero()) ? remaining : Rational.zero();
    }
    if (parent && parent.duration !== 'remainder' && parent.duration !== 'auto') {
      if (resolved.start.gte(parent.start.add(parent.duration as Rational))) {
        this.diag(warning('W_EMPTY_INTERVAL', `Node ${resolved.id} starts beyond its parent's end; it has an empty effective interval.`));
      }
    }

    if (parentId) {
      const p = this.nodes.get(parentId);
      if (p) {
        p.childIds.push(id);
        resolved.relativeStart = resolved.start.sub(p.start);
      }
    }
    if (resolved.kind !== 'composition' && !resolved.childrenResolved) {
      const childAvail = resolved.duration === 'remainder' ? available : resolved.duration === 'auto' ? available : (resolved.duration as Rational);
      this.resolveChildren(node, id, resolved.start, childAvail);
    }
    return resolved;
  }

  private resolveVisualHtml(node: CNode, parentId: string | null, start: Rational, available: Rational, kind: 'box' | 'text' | 'image' | 'plugin'): ResolvedNode {
    const id = this.nextId(node);
    const resolved: ResolvedNode = {
      id,
      nodeId: id,
      kind,
      tag: node.tag,
      parentId,
      childIds: [],
      start,
      relativeStart: start,
      duration: 'remainder',
      attributes: { ...node.attributes },
      text: node.text
    };
    this.nodes.set(id, resolved);
    this.order.push(id);

    // data-hv-start / data-hv-duration (spec 2.2)
    if ('data-hv-start' in node.attributes || 'data-hv-duration' in node.attributes) {
      const s = node.attributes['data-hv-start'] !== undefined ? (this.parseTime(node.attributes['data-hv-start'], node, 'data-hv-start') ?? Rational.zero()) : Rational.zero();
      if (s.lt(Rational.zero())) {
        this.diag(error('E_TIME_UNIT', 'data-hv-start uses nonnegative starts in v1.', { attribute: 'data-hv-start', nodeId: id }));
      }
      resolved.start = start.add(s);
      resolved.duration = node.attributes['data-hv-duration'] !== undefined ? this.parseDuration(node.attributes['data-hv-duration'], node) : 'remainder';
      if (resolved.duration === 'remainder') resolved.duration = available.sub(s).gt(Rational.zero()) ? available.sub(s) : Rational.zero();
    } else {
      resolved.start = start;
      resolved.duration = available; // inherits containing scene's active interval
    }

    if (parentId) {
      const p = this.nodes.get(parentId);
      if (p) {
        p.childIds.push(id);
        resolved.relativeStart = resolved.start.sub(p.start);
      }
    }
    if (kind === 'box') {
      const childAvail = typeof resolved.duration === 'string' ? available : resolved.duration;
      this.resolveChildren(node, id, resolved.start, childAvail);
    } else {
      // text/image leaves: text content only
      const textContent = node.children.map((c) => c.kind === 'text' ? c.text : c.tag === 'br' ? '\u2028' : '').join('');
      if (textContent.trim()) resolved.text = textContent;
      if (kind === 'text' && node.children.some((c) => c.kind === 'element' && c.tag !== 'br')) this.diag(error('E_ELEMENT_UNSUPPORTED', 'Text leaves admit only text and br children.', { nodeId: id }));
    }
    return resolved;
  }

  private checkNoAudioUnderFreeze(freezeId: string): void {
    const stack = [...(this.nodes.get(freezeId)?.childIds ?? [])];
    while (stack.length) {
      const nid = stack.pop() as string;
      const n = this.nodes.get(nid);
      if (!n) continue;
      if (n.kind === 'audio' || (n.kind === 'video' && n.media?.audio === 'include')) {
        this.diag(error('E_FREEZE_AUDIO', 'Audio anywhere under freeze is rejected, including implicitly included video audio; set audio="mute" or move sound outside the freeze.', { nodeId: nid }));
      }
      stack.push(...n.childIds);
    }
  }

  private resolveAnimation(node: CNode, scopeId: string): void {
    const id = this.nextId(node);
    const target = node.attributes['target'] ?? '';
    const property = node.attributes['property'] ?? '';
    const duration = this.parseTime(node.attributes['duration'], node, 'duration');
    const start = this.parseTime(node.attributes['start'] ?? '0', node) ?? Rational.zero();
    const fill = (node.attributes['fill'] as ResolvedAnimation['fill']) ?? 'none';
    const sampleStart = node.attributes['sample-start'] === undefined ? undefined : this.parseTime(node.attributes['sample-start'], node, 'sample-start');
    const sampleEnd = node.attributes['sample-end'] === undefined ? undefined : this.parseTime(node.attributes['sample-end'], node, 'sample-end');
    if (sampleStart?.lt(Rational.zero()) || sampleEnd?.lt(Rational.zero()) || sampleStart && sampleEnd && sampleEnd.lt(sampleStart)) {
      this.diag(error('E_ANIMATION', 'Animation sampling bounds must be nonnegative and ordered.', { nodeId: id })); return;
    }
    if (duration === undefined || duration.lte(Rational.zero())) {
      this.diag(error('E_DURATION', 'Animation requires an explicit positive duration.', { attribute: 'duration', nodeId: id }));
      return;
    }
    if (!ANIMATABLE_PROPERTIES.has(property)) {
      this.diag(error('E_ANIMATION', `Unknown animation property "${property}".`, { attribute: 'property', nodeId: id }));
      return;
    }
    const keyframes = node.children
      .filter((c) => c.kind === 'element' && c.tag === 'hv-keyframe')
      .map((c) => ({
        offset: Number(c.attributes['offset']),
        value: c.attributes['value'] ?? '',
        easing: c.attributes['easing']
      }));
    const hasFromTo = 'from' in node.attributes || 'to' in node.attributes;
    if (hasFromTo && (!node.attributes['from'] || !node.attributes['to'])) {
      this.diag(error('E_ANIMATION', 'from/to requires both endpoints after bindings resolve.', { nodeId: id }));
      return;
    }
    if (keyframes.length > 0 && hasFromTo) {
      this.diag(error('E_ANIMATION', 'Either from/to OR keyframes; never both.', { nodeId: id }));
      return;
    }
    if (keyframes.length > 0 && 'easing' in node.attributes) {
      this.diag(error('E_ANIMATION', 'With keyframe children the element-level easing must be omitted; supplying it is a validation error.', { attribute: 'easing', nodeId: id }));
      return;
    }
    if (keyframes.length > 0) {
      let prev = -1;
      for (const kf of keyframes) {
        if (!Number.isFinite(kf.offset) || kf.offset < 0 || kf.offset > 1) {
          this.diag(error('E_ANIMATION', `Keyframe offset must be a number 0–1; received ${kf.offset}.`, { nodeId: id }));
          return;
        }
        if (kf.offset <= prev) {
          this.diag(error('E_ANIMATION', 'Keyframe offsets must be strictly increasing.', { nodeId: id }));
          return;
        }
        prev = kf.offset;
      }
      if (keyframes[0].offset !== 0 || keyframes[keyframes.length - 1].offset !== 1) {
        this.diag(error('E_ANIMATION', 'Keyframes include offsets 0 and 1.', { nodeId: id }));
        return;
      }
    }
    const anim: ResolvedAnimation = {
      id,
      targetSelector: target,
      property,
      start,
      duration,
      from: node.attributes['from'],
      to: node.attributes['to'],
      easing: node.attributes['easing'] ?? 'linear',
      fill,
      mode: 'replace',
      keyframes: keyframes.length > 0 ? keyframes : undefined,
      clockScopeId: scopeId
      ,instanceKey: node.attributes['hv-instance-key']
      ,sampleStart, sampleEnd
    };
    this.animations.push(anim);
  }

  private kindFor(tag: string): ResolvedNode['kind'] {
    switch (tag) {
      case 'hv-composition': return 'composition';
      case 'hv-scene': return 'scene';
      case 'hv-sequence': return 'sequence';
      case 'hv-series': return 'series';
      case 'hv-loop': return 'loop';
      case 'hv-freeze': return 'freeze';
      case 'hv-video': return 'video';
      case 'hv-audio': return 'audio';
      case 'hv-captions': return 'captions';
      default: return 'box';
    }
  }

  /** Validate enumerated attributes and animation target existence/conflicts. */
  validateAll(): void {
    for (const node of this.nodes.values()) {
      // trim validation against playable extents (spec 4.4, 9.7)
      if ((node.kind === 'video' || node.kind === 'audio') && node.media && this.mediaExtents) {
        const ext = this.mediaExtents.getExtent(node.attributes['src'] ?? '', node.kind === 'video' ? 'video' : 'audio');
        if (ext) {
          const extent = node.kind === 'video' ? ext.videoExtent : ext.audioExtent;
          if (extent && node.media.trimOut === null) node.media.trimOut = extent;
          if (extent !== undefined && node.media.trimOut !== null && node.media.trimOut.gt(extent)) {
            this.diag(error('E_DURATION', `trim-out ${node.media.trimOut.toString()}s exceeds the playable ${node.kind} extent ${extent.toString()}s of "${node.attributes['src']}".`, { attribute: 'trim-out', nodeId: node.id }));
          }
          if (node.media.trimOut !== null && node.media.trimOut.lte(node.media.trimIn)) {
            this.diag(error('E_DURATION', 'trim-in < trim-out is required.', { attribute: 'trim-out', nodeId: node.id }));
          }
        }
      }
      if (node.media) {
        if (node.media.trimOut?.lte(node.media.trimIn)) this.diag(error('E_DURATION', 'trim-in must be less than trim-out.', { nodeId: node.id }));
        const gain = Number(node.media.gain ?? '1');
        if (!Number.isFinite(gain) || gain < 0 || gain > 4) this.diag(error('E_ANIMATION', 'Media gain must be finite and within 0–4.', { nodeId: node.id }));
        for (const value of [node.media.track, node.media.audioTrack]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) this.diag(error('E_CODEC_DECODE', 'Track indices must be nonnegative safe integers.', { nodeId: node.id }));
        if (typeof node.duration === 'object') for (const fade of [node.media.fadeIn, node.media.fadeOut]) if (fade && (fade.lt(Rational.zero()) || fade.gt(node.media.fadeDuration ?? node.duration))) this.diag(error('E_DURATION', 'Audio fades must lie within their envelope duration.', { nodeId: node.id }));
      }
      for (const [attr, value] of Object.entries(node.attributes)) {
        const allowed = ENUMERATED_BOOLEAN[attr];
        if (allowed && !allowed.includes(value)) {
          this.diag(error('E_ENUM', `Attribute "${attr}" accepts only ${allowed.join('/')}; received "${value}".`, { attribute: attr, nodeId: node.id }));
        }
      }
      if (node.kind === 'video' && node.attributes['duration'] === 'auto') {
        // auto allowed on media leaves
      } else if (node.kind !== 'video' && node.kind !== 'audio' && node.attributes['duration'] === 'auto') {
        this.diag(error('E_DURATION', 'duration="auto" is accepted only on media leaves.', { attribute: 'duration', nodeId: node.id }));
      }
    }
    // Resolve static CSS target sets once against the expanded composition.
    const selectorElements = new Map<string, Element>();
    const domRoot = new Document([]);
    for (const node of this.nodes.values()) selectorElements.set(node.id, new Element(node.tag, { ...node.attributes, id: node.id }, []));
    for (const node of this.nodes.values()) {
      const el = selectorElements.get(node.id)!;
      const parent = node.parentId ? selectorElements.get(node.parentId)! : domRoot;
      el.parent = parent; const previous = parent.children[parent.children.length - 1];
      if (previous) { previous.next = el; el.prev = previous; } parent.children.push(el);
    }
    const targetAnimations: ResolvedAnimation[] = [];
    for (const anim of this.animations) {
      const sel = anim.targetSelector;
      let matches: Element[] = [];
      try { matches = selectAll(sel, domRoot.children).filter((el): el is Element => el instanceof Element); }
      catch { this.diag(error('E_SELECTOR', `Invalid or dynamic animation selector ${sel}.`, { nodeId: anim.id })); }
      if (anim.instanceKey) matches = matches.filter((el) => this.nodes.get(el.attribs.id)?.attributes['hv-instance-key'] === anim.instanceKey);
      if (!matches.length) {
        this.diag(error('E_SELECTOR', `Animation target "${sel}" matches nothing; no matches is an error.`, { nodeId: anim.id }));
        continue;
      }
      for (const el of matches) {
      const target = this.nodes.get(el.attribs.id)!;
      if (!ANIMATION_TARGET_KINDS.has(target.kind)) {
        this.diag(error('E_SELECTOR', `Structural wrappers and declaration nodes cannot be animated ("${sel}").`, { nodeId: anim.id }));
        continue;
      }
      targetAnimations.push({ ...anim, id: matches.length > 1 ? `${anim.id}:${target.id}` : anim.id, targetSelector: `#${target.id}` });
      }
    }
    this.animations = targetAnimations;
    for (const anim of this.animations) {
      const target = this.nodes.get(anim.targetSelector.slice(1))!;
      const registry = PROPERTY_REGISTRY[anim.property];
      if (!registry?.targets.includes(target.kind)) this.diag(error('E_ANIMATION', `${anim.property} cannot target ${target.kind}.`, { nodeId: anim.id }));
      try { parseEasing(anim.easing, anim.duration.toNumber()); } catch (e) { this.diag(error('E_ANIMATION', (e as Error).message)); }
      if (!anim.keyframes && (anim.from === undefined || anim.to === undefined)) this.diag(error('E_ANIMATION', 'Animation requires both from/to endpoints or keyframes.'));
      const values = anim.keyframes?.map((k) => k.value) ?? [anim.from ?? '', anim.to ?? ''];
      const units = new Set<string>();
      for (const value of values) {
        let valid = true;
        if (registry?.kind === 'color') { try { parseColor(value); } catch { valid = false; } }
        else if (anim.property === 'rotate') valid = /^-?\d+(?:\.\d+)?deg$/.test(value);
        else if (registry?.kind === 'length') {
          const m = /^-?\d+(?:\.\d+)?(px|%)$/.exec(value); valid = !!m;
          if (m) { units.add(m[1]); if (['width', 'height', 'left', 'top'].includes(anim.property) && m[1] !== 'px') valid = false; }
        } else valid = value.trim() !== '' && Number.isFinite(Number(value));
        if (anim.property.startsWith('scale-') && Number(value) <= 0) valid = false;
        if (!valid) this.diag(error('E_ANIMATION', `Invalid ${anim.property} endpoint ${value}.`, { nodeId: anim.id }));
      }
      if (units.size > 1) this.diag(error('E_ANIMATION', 'Animation endpoint units must match.', { nodeId: anim.id }));
    }
    // conflict detection: more than one contributing animation on one target/property overlapping in time
    const byTargetProp = new Map<string, ResolvedAnimation[]>();
    for (const anim of this.animations) {
      if (!this.nodes.has(anim.targetSelector.slice(1))) continue;
      const key = `${anim.targetSelector}|${anim.property}`;
      const list = byTargetProp.get(key) ?? [];
      list.push(anim);
      byTargetProp.set(key, list);
    }
    for (const [, list] of byTargetProp) {
      if (list.length < 2) continue;
      const scopeOf = (a: ResolvedAnimation) => a.clockScopeId;
      const sameScope = list.every((a) => scopeOf(a) === scopeOf(list[0]));
      if (!sameScope) continue;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i];
          const b = list[j];
          const aEnd = a.start.add(a.duration);
          const bEnd = b.start.add(b.duration);
          const overlap = a.start.lt(bEnd) && b.start.lt(aEnd);
          const aFillExtends = a.fill === 'forwards' || a.fill === 'both';
          const bFillExtends = b.fill === 'forwards' || b.fill === 'both';
          const aStartsBefore = a.start.lte(b.start) && (aFillExtends || aEnd.gt(b.start));
          const bStartsBefore = b.start.lte(a.start) && (bFillExtends || bEnd.gt(a.start));
          if (overlap || (aFillExtends && bStartsBefore) || (bFillExtends && aStartsBefore)) {
            this.diag(error('E_ANIMATION_CONFLICT', `Multiple contributing animations on ${a.targetSelector} property "${a.property}" overlap in time (including fill); use one multi-keyframe declaration or shorten fill.`));
            i = list.length;
            break;
          }
        }
      }
    }
    // animation targeting loop descendant from outside the loop is invalid (spec 6.1)
    for (const anim of this.animations) {
      const target = this.nodes.get(anim.targetSelector.slice(1));
      if (!target) continue;
      const inLoop = (n: ResolvedNode): boolean => (n.kind === 'loop' ? true : n.parentId ? inLoop(this.nodes.get(n.parentId) as ResolvedNode) : false);
      if (inLoop(target) && !inLoop(this.nodes.get(anim.clockScopeId) ?? ({} as ResolvedNode))) {
        this.diag(error('E_ANIMATION', 'An animation outside a loop targeting a loop descendant is invalid; put the animation inside that loop.', { nodeId: anim.id }));
      }
    }
    // root frame alignment of hv-composition duration
    const root = [...this.nodes.values()].find((n) => n.kind === 'composition');
    if (root && root.duration !== 'remainder' && root.duration !== 'auto') {
      const secs = root.duration as Rational;
      const { exact } = framesForSeconds(secs, this.fps);
      if (!exact) {
        this.diag(error('E_ROOT_FRAME_ALIGNMENT', `Root duration ${secs.toString()}s is not an exact number of output frames at ${this.fps.toString()} fps.`, {
          suggestion: `Use an explicit frame count such as ${(framesForSeconds(secs, this.fps).frames + 1n).toString()}f or adjust fps.`
        }));
      }
    }
  }
}



