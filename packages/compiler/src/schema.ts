/**
 * JSON Schema subset validator (spec 7.1):
 * object, array, string, number, integer, boolean, null;
 * properties, required, additionalProperties, items, enum,
 * minimum/maximum, minLength/maxLength, minItems/maxItems.
 * Other keywords produce a diagnostic rather than being silently ignored.
 */
import { JsonValue, JsonObject } from '@htmv/core';
import { Diagnostic, warning } from '@htmv/core';

const ADMITTED = new Set([
  'type',
  'properties',
  'required',
  'additionalProperties',
  'items',
  'enum',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems'
]);

const ADMITTED_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean', 'null']);

function typeName(v: JsonValue): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (Number.isInteger(v)) return 'integer-or-number';
  return typeof v;
}

function matchesType(v: JsonValue, t: string): boolean {
  if (t === 'number') return typeof v === 'number' && Number.isFinite(v);
  if (t === 'integer') return typeof v === 'number' && Number.isInteger(v);
  if (t === 'string') return typeof v === 'string';
  if (t === 'boolean') return typeof v === 'boolean';
  if (t === 'null') return v === null;
  if (t === 'object') return typeof v === 'object' && v !== null && !Array.isArray(v);
  if (t === 'array') return Array.isArray(v);
  return false;
}

function validateValue(v: JsonValue, schema: JsonValue, path: string, diags: Diagnostic[], unknownKeywords: string[]): boolean {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) {
    diags.push(warning('E_SCHEMA', `Schema at ${path || '/'} is not an object; ignored.`));
    return true;
  }
  const s = schema as JsonObject;
  for (const key of Object.keys(s)) {
    if (!ADMITTED.has(key)) unknownKeywords.push(`${path}/${key}`);
  }
  let ok = true;
  const type = s['type'];
  if (type !== undefined) {
    const types = Array.isArray(type) ? type.map(String) : [String(type)];
    if (types.some((t) => !ADMITTED_TYPES.has(t))) {
      unknownKeywords.push(`${path}/type`);
    } else if (!types.some((t) => matchesType(v, t))) {
      diags.push({
        severity: 'error',
        code: 'E_SCHEMA_TYPE',
        message: `Value at ${path || '/'} does not match schema type ${types.join('|')} (got ${typeName(v)}).`,
        attribute: path,
        recoverable: false
      });
      ok = false;
    }
  }
  if (s['enum'] !== undefined && Array.isArray(s['enum'])) {
    if (!s['enum'].some((e) => JSON.stringify(e) === JSON.stringify(v))) {
      diags.push({
        severity: 'error',
        code: 'E_SCHEMA_ENUM',
        message: `Value at ${path || '/'} is not in the enum.`,
        attribute: path,
        recoverable: false
      });
      ok = false;
    }
  }
  if (typeof v === 'number') {
    if (s['minimum'] !== undefined && typeof s['minimum'] === 'number' && v < s['minimum']) {
      diags.push({ severity: 'error', code: 'E_SCHEMA_MIN', message: `Value at ${path || '/'} below minimum.`, attribute: path, recoverable: false });
      ok = false;
    }
    if (s['maximum'] !== undefined && typeof s['maximum'] === 'number' && v > s['maximum']) {
      diags.push({ severity: 'error', code: 'E_SCHEMA_MAX', message: `Value at ${path || '/'} above maximum.`, attribute: path, recoverable: false });
      ok = false;
    }
  }
  if (typeof v === 'string') {
    if (s['minLength'] !== undefined && typeof s['minLength'] === 'number' && v.length < s['minLength']) {
      diags.push({ severity: 'error', code: 'E_SCHEMA_MINLENGTH', message: `String at ${path || '/'} shorter than minLength.`, attribute: path, recoverable: false });
      ok = false;
    }
    if (s['maxLength'] !== undefined && typeof s['maxLength'] === 'number' && v.length > s['maxLength']) {
      diags.push({ severity: 'error', code: 'E_SCHEMA_MAXLENGTH', message: `String at ${path || '/'} longer than maxLength.`, attribute: path, recoverable: false });
      ok = false;
    }
  }
  if (Array.isArray(v)) {
    const items = s['minItems'];
    if (items !== undefined && typeof items === 'number' && v.length < items) {
      diags.push({ severity: 'error', code: 'E_SCHEMA_MINITEMS', message: `Array at ${path || '/'} below minItems.`, attribute: path, recoverable: false });
      ok = false;
    }
    const maxItems = s['maxItems'];
    if (maxItems !== undefined && typeof maxItems === 'number' && v.length > maxItems) {
      diags.push({ severity: 'error', code: 'E_SCHEMA_MAXITEMS', message: `Array at ${path || '/'} above maxItems.`, attribute: path, recoverable: false });
      ok = false;
    }
    const itemSchema = s['items'];
    if (itemSchema !== undefined) {
      v.forEach((entry, i) => {
        if (!validateValue(entry, itemSchema, `${path}/${i}`, diags, unknownKeywords)) ok = false;
      });
    }
  }
  if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
    const obj = v as JsonObject;
    if (s['required'] !== undefined && Array.isArray(s['required'])) {
      for (const req of s['required']) {
        if (typeof req === 'string' && !(req in obj)) {
          diags.push({
            severity: 'error',
            code: 'E_SCHEMA_REQUIRED',
            message: `Missing required property "${req}" at ${path || '/'}.`,
            attribute: path,
            recoverable: false
          });
          ok = false;
        }
      }
    }
    if (s['properties'] !== undefined && typeof s['properties'] === 'object' && !Array.isArray(s['properties'])) {
      const props = s['properties'] as JsonObject;
      for (const key of Object.keys(obj)) {
        if (key in props) {
          if (!validateValue(obj[key], props[key], `${path}/${key}`, diags, unknownKeywords)) ok = false;
        } else if (s['additionalProperties'] === false) {
          diags.push({
            severity: 'error',
            code: 'E_SCHEMA_ADDITIONAL',
            message: `Additional property "${key}" at ${path || '/'} not allowed.`,
            attribute: path,
            recoverable: false
          });
          ok = false;
        }
      }
    }
  }
  return ok;
}

export interface SchemaResult {
  diagnostics: Diagnostic[];
  valid: boolean;
}

export function validateSchemaSubset(value: JsonValue, schema: JsonValue | undefined): SchemaResult {
  const diagnostics: Diagnostic[] = [];
  const unknownKeywords: string[] = [];
  if (schema === undefined) return { diagnostics, valid: true };
  const valid = validateValue(value, schema, '', diagnostics, unknownKeywords);
  for (const kw of unknownKeywords) {
    diagnostics.push(warning('E_SCHEMA_KEYWORD', `Schema keyword "${kw}" is outside the admitted subset; it is diagnosed, not silently ignored.`));
  }
  return { diagnostics, valid };
}
