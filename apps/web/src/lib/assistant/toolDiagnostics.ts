import {
  findUnsupportedBlocklyBlockTypes,
  normalizeBlocklyXml,
  validateBlocklyXmlStructure,
} from '../../../../../packages/ui-shared/src/blocklyXml';

function truncateDiagnosticText(text: string, maxLength = 180): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 3))}...`;
}

function collectBlocklyBlockTypes(blocklyXml: string): string[] {
  const blockTypes: string[] = [];
  const seen = new Set<string>();
  const pattern = /type=(["'])([^"']+)\1/g;
  const ignoredBlockTypes = new Set(['logic_boolean', 'math_number', 'text']);

  for (let match = pattern.exec(blocklyXml); match; match = pattern.exec(blocklyXml)) {
    const blockType = match[2];
    if (!blockType || ignoredBlockTypes.has(blockType) || seen.has(blockType)) continue;
    seen.add(blockType);
    blockTypes.push(blockType);
  }

  return blockTypes;
}

function formatBlockTypeList(blockTypes: readonly string[], maxCount = 6): string {
  if (blockTypes.length === 0) {
    return 'none';
  }

  const visible = blockTypes.slice(0, maxCount);
  const suffix = blockTypes.length > maxCount
    ? `,+${blockTypes.length - maxCount} more`
    : '';
  return `${visible.join(',')}${suffix}`;
}

function summarizeBlocklyXmlForDiagnostics(blocklyXml: string): string {
  const rawBlockTypes = collectBlocklyBlockTypes(blocklyXml);
  const rawStructureIssue = validateBlocklyXmlStructure(blocklyXml);
  const normalizedBlocklyXml = normalizeBlocklyXml(blocklyXml);
  const normalizedBlockTypes = collectBlocklyBlockTypes(normalizedBlocklyXml);
  const unsupportedBlockTypes = findUnsupportedBlocklyBlockTypes(normalizedBlocklyXml);

  const parts = [`blocks=${formatBlockTypeList(rawBlockTypes)}`];

  if (normalizedBlocklyXml !== blocklyXml) {
    parts.push(`normalized=${formatBlockTypeList(normalizedBlockTypes)}`);
  }

  if (rawStructureIssue) {
    parts.push(`rawInvalid=${truncateDiagnosticText(rawStructureIssue, 72)}`);
  }

  if (unsupportedBlockTypes.length > 0) {
    parts.push(`unsupported=${formatBlockTypeList(unsupportedBlockTypes)}`);
  }

  return truncateDiagnosticText(
    `Blockly XML (${blocklyXml.length} chars; ${parts.join('; ')})`,
    260,
  );
}

export function formatDiagnosticValue(value: unknown): string {
  if (typeof value === 'string') {
    if (value.includes('<xml')) {
      return summarizeBlocklyXmlForDiagnostics(value);
    }
    return truncateDiagnosticText(JSON.stringify(value), 96);
  }

  if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
    return String(value);
  }

  if (Array.isArray(value)) {
    return truncateDiagnosticText(JSON.stringify(value), 140);
  }

  if (typeof value === 'object' && value) {
    return truncateDiagnosticText(JSON.stringify(value), 180);
  }

  return String(value);
}

export function summarizeToolArgs(args: Record<string, unknown> | null): string | null {
  if (!args) return null;
  const entries = Object.entries(args);
  if (entries.length === 0) return null;
  return entries
    .map(([key, value]) => `${key}=${formatDiagnosticValue(value)}`)
    .join(' | ');
}

export function summarizeToolDiagnostics(result: Record<string, unknown> | null): string | null {
  if (!result) return null;

  if (result.ok === false) {
    const error = result.error as Record<string, unknown> | undefined;
    const diagnostics: string[] = [];
    if (typeof error?.code === 'string' && error.code.trim()) {
      diagnostics.push(`code=${error.code}`);
    }
    if (error && 'details' in error && error.details !== null && error.details !== undefined) {
      diagnostics.push(`details=${formatDiagnosticValue(error.details)}`);
    }
    return diagnostics.length > 0 ? diagnostics.join(' | ') : null;
  }

  const diagnostics: string[] = [];
  const operation = result.operation as Record<string, unknown> | undefined;
  if (typeof operation?.blocklyXml === 'string') {
    diagnostics.push(`blocklyXml=${formatDiagnosticValue(operation.blocklyXml)}`);
  }

  const createdEntities = Array.isArray(result.createdEntities)
    ? result.createdEntities as Array<Record<string, unknown>>
    : [];
  if (createdEntities.length > 0) {
    diagnostics.push(
      createdEntities
        .map((entity) => `${String(entity.type ?? 'entity')}:${String(entity.id ?? 'unknown')}`)
        .join(', '),
    );
  }

  const validationIssues = Array.isArray(result.validationIssues)
    ? result.validationIssues as Array<Record<string, unknown>>
    : [];
  if (validationIssues.length > 0) {
    diagnostics.push(
      validationIssues
        .map((issue) => String(issue.message ?? issue.code ?? 'validation issue'))
        .join(' | '),
    );
  }

  const stateSummary = result.stateSummary as Record<string, unknown> | undefined;
  if (stateSummary) {
    const scenes = typeof stateSummary.sceneCount === 'number' ? `scenes=${stateSummary.sceneCount}` : null;
    const objects = typeof stateSummary.objectCount === 'number' ? `objects=${stateSummary.objectCount}` : null;
    const summary = [scenes, objects].filter(Boolean).join(' | ');
    if (summary) {
      diagnostics.push(summary);
    }
  }

  return diagnostics.length > 0 ? diagnostics.join(' | ') : null;
}
