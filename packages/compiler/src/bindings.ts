/**
 * Safe binding path resolution (spec 7.2):
 * identifiers separated by dots, optional nonnegative integer array indexes.
 * Roots: props, item, index, parentProps.
 * Rejects __proto__, prototype, constructor. No calls/arith/optional chaining.
 */
import { JsonValue } from '@htmv/core';

const FORBIDDEN = new Set(['__proto__', 'prototype', 'constructor']);
const ROOTS = new Set(['props', 'item', 'index', 'parentProps']);

export interface BindingPath {
  root: string;
  segments: (string | number)[];
}

export function parseBindingPath(text: string): BindingPath | null {
  const s = text.trim();
  if (!s) return null;
  const parts: (string | number)[] = [];
  const isNameStart = (c: string) => /[A-Za-z_$]/.test(c);
  const isNameChar = (c: string) => /[A-Za-z0-9_$]/.test(c);
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '.') {
      i++;
      continue;
    }
    const bm = /^\[(\d+)\]/.exec(s.slice(i));
    if (bm) {
      if (parts.length === 0) return null;
      parts.push(parseInt(bm[1], 10));
      i += bm[0].length;
      continue;
    }
    if (isNameStart(ch)) {
      let j = i + 1;
      while (j < s.length && isNameChar(s[j])) j++;
      const name = s.slice(i, j);
      if (FORBIDDEN.has(name)) return null;
      parts.push(name);
      i = j;
      continue;
    }
    if (/\d/.test(ch) && parts.length > 0) {
      // dotted numeric segment counts as an array index (spec 7.2)
      const dm = /^(\d+)(?=$|[.\[])/.exec(s.slice(i));
      if (!dm) return null;
      parts.push(parseInt(dm[1], 10));
      i += dm[1].length;
      continue;
    }
    return null;
  }
  if (parts.length === 0 || typeof parts[0] !== 'string' || !ROOTS.has(parts[0])) return null;
  return { root: parts[0], segments: parts.slice(1) };
}

export function resolveBindingPath(path: BindingPath, scope: BindingScope): JsonValue | undefined {
  let current: JsonValue;
  switch (path.root) {
    case 'props': current = scope.props; break;
    case 'item': current = scope.item ?? null; break;
    case 'index': current = scope.index ?? null; break;
    case 'parentProps': current = scope.parentProps ?? null; break;
    default: return undefined;
  }
  for (const seg of path.segments) {
    if (current === null || current === undefined) return undefined;
    if (typeof seg === 'number') {
      if (!Array.isArray(current)) return undefined;
      current = current[seg];
    } else {
      if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined;
      current = (current as { [key: string]: JsonValue })[seg];
    }
  }
  return current;
}

export interface BindingScope {
  props: JsonValue;
  item?: JsonValue;
  index?: number;
  parentProps?: JsonValue;
}

/** Deterministic conversion for text bindings (spec 7.6). */
export function bindingText(value: JsonValue): string | null {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return String(value);
  }
  if (typeof value === 'boolean') return String(value);
  return null; // object/array rejected unless formatted upstream
}
