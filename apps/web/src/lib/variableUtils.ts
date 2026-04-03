import type {
  ComponentDefinition,
  GameObject,
  Variable,
  VariableCardinality,
  VariableScalarValue,
  VariableType,
  VariableValue,
} from '@/types';
import { VARIABLE_REFERENCE_BLOCKS } from '@/lib/blocklyReferenceMaps';

export interface VariableDefinitionSnapshot {
  id: string;
  name: string;
  type: VariableType;
  cardinality: VariableCardinality;
  scope: 'global' | 'local';
  defaultValue: VariableValue;
}

export interface VariableDefinitionConflict {
  id: string;
  existing: VariableDefinitionSnapshot;
  incoming: VariableDefinitionSnapshot;
  existingSource: string;
  incomingSource: string;
}

interface IndexedVariableDefinition extends VariableDefinitionSnapshot {
  source: string;
}

interface NormalizeVariableOptions {
  scope: 'global' | 'local';
  objectId?: string | null;
}

export interface VariableDefinitionIndexResult {
  byId: Map<string, VariableDefinitionSnapshot>;
  conflicts: VariableDefinitionConflict[];
}

function safeVariableId(id: unknown): string {
  if (typeof id === 'string' && id.trim().length > 0) {
    return id.trim();
  }
  return crypto.randomUUID();
}

export function normalizeVariableName(name: unknown): string {
  if (typeof name !== 'string') return '';
  return name.trim();
}

export function isValidVariableName(name: string): boolean {
  return normalizeVariableName(name).length > 0;
}

export function normalizeVariableType(type: unknown): VariableType {
  switch (type) {
    case 'string':
    case 'number':
    case 'boolean':
      return type;
    default:
      return 'number';
  }
}

export function normalizeVariableCardinality(cardinality: unknown): VariableCardinality {
  return cardinality === 'array' ? 'array' : 'single';
}

export function coerceScalarDefaultValue(
  type: VariableType,
  value: unknown,
): VariableScalarValue {
  switch (type) {
    case 'number': {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : 0;
    }
    case 'string':
      return typeof value === 'string' ? value : String(value ?? '');
    case 'boolean':
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') return true;
        if (normalized === 'false' || normalized === '0' || normalized === '') return false;
      }
      return Boolean(value);
  }
}

export function coerceDefaultValue(
  type: VariableType,
  cardinality: VariableCardinality,
  value: unknown,
): VariableValue {
  if (cardinality === 'array') {
    if (Array.isArray(value)) {
      return value.map((entry) => coerceScalarDefaultValue(type, entry));
    }
    if (value === null || value === undefined) {
      return [];
    }
    return [coerceScalarDefaultValue(type, value)];
  }

  return coerceScalarDefaultValue(type, value);
}

export function getDefaultVariableValue(
  type: VariableType,
  cardinality: VariableCardinality,
): VariableValue {
  return coerceDefaultValue(type, cardinality, cardinality === 'array' ? [] : undefined);
}

export function cloneVariableValue(value: VariableValue): VariableValue {
  return Array.isArray(value) ? [...value] : value;
}

export function cloneVariableDefinition(variable: Variable): Variable {
  return {
    ...variable,
    defaultValue: cloneVariableValue(variable.defaultValue),
  };
}

export function cloneVariableDefinitions(variables: Variable[] | undefined): Variable[] {
  return (variables || []).map((variable) => cloneVariableDefinition(variable));
}

export function normalizeVariableDefinition(
  variable: Variable,
  { scope, objectId }: NormalizeVariableOptions,
): Variable {
  const type = normalizeVariableType(variable.type);
  const cardinality = normalizeVariableCardinality(variable.cardinality);
  const normalizedName = normalizeVariableName(variable.name) || 'variable';
  const defaultValue = coerceDefaultValue(type, cardinality, variable.defaultValue);
  const normalized: Variable = {
    id: safeVariableId(variable.id),
    name: normalizedName,
    type,
    cardinality,
    defaultValue,
    scope,
  };
  if (scope === 'local' && objectId) {
    normalized.objectId = objectId;
  }
  return normalized;
}

export function normalizeVariableDefinitions(
  variables: Variable[] | undefined,
  options: NormalizeVariableOptions,
): Variable[] {
  const source = Array.isArray(variables) ? variables : [];
  const seenIds = new Set<string>();
  const normalized: Variable[] = [];
  for (const variable of source) {
    const next = normalizeVariableDefinition(variable, options);
    if (seenIds.has(next.id)) continue;
    seenIds.add(next.id);
    normalized.push(next);
  }
  return normalized;
}

function normalizeVariableSnapshot(
  variable: Variable,
  options: NormalizeVariableOptions,
): VariableDefinitionSnapshot {
  const normalized = normalizeVariableDefinition(variable, options);
  return {
    id: normalized.id,
    name: normalized.name,
    type: normalized.type,
    cardinality: normalizeVariableCardinality(normalized.cardinality),
    scope: normalized.scope,
    defaultValue: cloneVariableValue(normalized.defaultValue),
  };
}

export function areVariableValuesEqual(left: VariableValue, right: VariableValue): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      return false;
    }
    if (left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => Object.is(value, right[index]));
  }

  return Object.is(left, right);
}

function sameDefinition(
  left: VariableDefinitionSnapshot,
  right: VariableDefinitionSnapshot,
): boolean {
  return (
    left.id === right.id &&
    left.name === right.name &&
    left.type === right.type &&
    left.cardinality === right.cardinality &&
    left.scope === right.scope &&
    areVariableValuesEqual(left.defaultValue, right.defaultValue)
  );
}

function pushDefinition(
  byId: Map<string, IndexedVariableDefinition>,
  conflicts: VariableDefinitionConflict[],
  incoming: VariableDefinitionSnapshot,
  source: string,
): void {
  const existing = byId.get(incoming.id);
  if (!existing) {
    byId.set(incoming.id, { ...incoming, source });
    return;
  }

  if (sameDefinition(existing, incoming)) return;

  conflicts.push({
    id: incoming.id,
    existing: {
      id: existing.id,
      name: existing.name,
      type: existing.type,
      cardinality: existing.cardinality,
      scope: existing.scope,
      defaultValue: cloneVariableValue(existing.defaultValue),
    },
    incoming,
    existingSource: existing.source,
    incomingSource: source,
  });
}

export function buildVariableDefinitionIndex(
  globalVariables: Variable[],
  components: ComponentDefinition[],
  allObjects: GameObject[],
): VariableDefinitionIndexResult {
  const indexed = new Map<string, IndexedVariableDefinition>();
  const conflicts: VariableDefinitionConflict[] = [];

  for (const variable of globalVariables || []) {
    pushDefinition(
      indexed,
      conflicts,
      normalizeVariableSnapshot(variable, { scope: 'global' }),
      `global:${variable.id}`,
    );
  }

  const componentsById = new Map((components || []).map((component) => [component.id, component]));

  for (const component of components || []) {
    for (const variable of component.localVariables || []) {
      pushDefinition(
        indexed,
        conflicts,
        normalizeVariableSnapshot(variable, { scope: 'local' }),
        `component:${component.id}`,
      );
    }
  }

  for (const object of allObjects || []) {
    if (object.componentId) {
      const componentLocalVariables = componentsById.get(object.componentId)?.localVariables || [];
      if (componentLocalVariables.length > 0) {
        const componentIds = new Set(componentLocalVariables.map((variable) => variable.id));
        for (const variable of object.localVariables || []) {
          if (componentIds.has(variable.id)) continue;
          pushDefinition(
            indexed,
            conflicts,
            normalizeVariableSnapshot(variable, { scope: 'local' }),
            `object:${object.id}`,
          );
        }
      } else {
        for (const variable of object.localVariables || []) {
          pushDefinition(
            indexed,
            conflicts,
            normalizeVariableSnapshot(variable, { scope: 'local' }),
            `object:${object.id}`,
          );
        }
      }
      continue;
    }

    for (const variable of object.localVariables || []) {
      pushDefinition(
        indexed,
        conflicts,
        normalizeVariableSnapshot(variable, { scope: 'local', objectId: object.id }),
        `object:${object.id}`,
      );
    }
  }

  const byId = new Map<string, VariableDefinitionSnapshot>();
  for (const [id, variable] of indexed.entries()) {
    byId.set(id, {
      id,
      name: variable.name,
      type: variable.type,
      cardinality: variable.cardinality,
      scope: variable.scope,
      defaultValue: cloneVariableValue(variable.defaultValue),
    });
  }

  return { byId, conflicts };
}

export function hasVariableNameConflict(
  variables: Variable[],
  name: string,
  excludeId?: string,
): boolean {
  const normalized = normalizeVariableName(name).toLowerCase();
  if (!normalized) return false;

  return variables.some((variable) => {
    if (excludeId && variable.id === excludeId) return false;
    return normalizeVariableName(variable.name).toLowerCase() === normalized;
  });
}

export interface VariableDisplayLabelOptions {
  globalContextLabel?: string;
  localContextLabel?: string;
}

export function buildVariableDisplayLabelMap<T extends Pick<Variable, 'id' | 'name' | 'scope'>>(
  variables: readonly T[],
  options: VariableDisplayLabelOptions = {},
): Map<string, string> {
  const globalContextLabel = normalizeVariableName(options.globalContextLabel) || 'project';
  const localContextLabel = normalizeVariableName(options.localContextLabel) || 'here';
  const nameCounts = new Map<string, number>();

  for (const variable of variables) {
    const normalizedName = normalizeVariableName(variable.name).toLowerCase();
    if (!normalizedName) continue;
    nameCounts.set(normalizedName, (nameCounts.get(normalizedName) || 0) + 1);
  }

  const labelCounts = new Map<string, number>();
  const labels = new Map<string, string>();

  for (const variable of variables) {
    const baseName = normalizeVariableName(variable.name) || 'variable';
    const normalizedName = baseName.toLowerCase();
    const needsDisambiguation = (nameCounts.get(normalizedName) || 0) > 1;
    const contextLabel = variable.scope === 'local' ? localContextLabel : globalContextLabel;
    const baseLabel = needsDisambiguation ? `${baseName} (${contextLabel})` : baseName;
    const duplicateLabelCount = (labelCounts.get(baseLabel) || 0) + 1;
    labelCounts.set(baseLabel, duplicateLabelCount);
    labels.set(
      variable.id,
      duplicateLabelCount > 1 ? `${baseLabel} ${duplicateLabelCount}` : baseLabel,
    );
  }

  return labels;
}

export function remapVariableIdsInBlocklyXml(
  blocklyXml: string,
  variableIdMap: Map<string, string>,
): string {
  if (!blocklyXml.trim() || variableIdMap.size === 0) return blocklyXml;

  const fallbackRemap = () =>
    blocklyXml.replace(
      /(<field\b[^>]*\bname=["']VAR["'][^>]*>)([^<]+)(<\/field>)/g,
      (fullMatch, start, rawValue, end) => {
        const value = String(rawValue ?? '').trim();
        const remapped = variableIdMap.get(value);
        if (!remapped || remapped === value) return fullMatch;
        return `${start}${remapped}${end}`;
      },
    );

  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return fallbackRemap();
  }

  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(blocklyXml, 'text/xml');
    if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
      return fallbackRemap();
    }

    let changed = false;
    const blocks = Array.from(xmlDoc.getElementsByTagName('block'));
    for (const block of blocks) {
      const blockType = block.getAttribute('type') || '';
      const variableFieldName = VARIABLE_REFERENCE_BLOCKS[blockType];
      if (!variableFieldName) continue;

      const fields = Array.from(block.children).filter(
        (child): child is Element =>
          child.tagName.toLowerCase() === 'field' && child.getAttribute('name') === variableFieldName,
      );

      for (const field of fields) {
        const rawValue = field.textContent || '';
        const value = rawValue.trim();
        const remapped = variableIdMap.get(value);
        if (remapped && remapped !== value) {
          field.textContent = remapped;
          changed = true;
        }
      }
    }

    if (!changed || !xmlDoc.documentElement) {
      return blocklyXml;
    }

    return new XMLSerializer().serializeToString(xmlDoc.documentElement);
  } catch {
    return fallbackRemap();
  }
}
