function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BLOCK_TYPE_ALIASES: Readonly<Record<string, string>> = {
  control_forever: 'event_forever',
  controls_forever: 'event_forever',
  when_run: 'event_game_start',
  event_whenstart: 'event_game_start',
  event_whenflagclicked: 'event_game_start',
  event_whenkeypressed: 'event_key_pressed',
  event_whenthisspriteclicked: 'event_clicked',
  key_pressed: 'sensing_key_pressed',
  keyboard_is_key_pressed: 'sensing_key_pressed',
  sensing_keypressed: 'sensing_key_pressed',
  change_x_by: 'motion_change_x',
  change_y_by: 'motion_change_y',
  controls_if_else: 'controls_if',
};

const STATEMENT_NAME_ALIASES: ReadonlyArray<{
  blockType: string;
  from: string;
  to: string;
}> = [
  { blockType: 'event_game_start', from: 'SUBSTACK', to: 'NEXT' },
  { blockType: 'event_game_start', from: 'STACK', to: 'NEXT' },
  { blockType: 'event_key_pressed', from: 'SUBSTACK', to: 'NEXT' },
  { blockType: 'event_key_pressed', from: 'STACK', to: 'NEXT' },
  { blockType: 'event_clicked', from: 'SUBSTACK', to: 'NEXT' },
  { blockType: 'event_forever', from: 'SUBSTACK', to: 'DO' },
  { blockType: 'event_forever', from: 'STACK', to: 'DO' },
];

const FIELD_NAME_ALIASES: ReadonlyArray<{
  blockType: string;
  from: string;
  to: string;
}> = [
  { blockType: 'event_key_pressed', from: 'KEY_OPTION', to: 'KEY' },
  { blockType: 'event_key_pressed', from: 'KEY_NAME', to: 'KEY' },
  { blockType: 'sensing_key_pressed', from: 'KEY_OPTION', to: 'KEY' },
  { blockType: 'sensing_key_pressed', from: 'KEY_NAME', to: 'KEY' },
];

const VALUE_NAME_ALIASES: ReadonlyArray<{
  blockType: string;
  from: string;
  to: string;
}> = [
  { blockType: 'motion_change_x', from: 'NUM', to: 'VALUE' },
  { blockType: 'motion_change_x', from: 'DELTA', to: 'VALUE' },
  { blockType: 'motion_change_y', from: 'NUM', to: 'VALUE' },
  { blockType: 'motion_change_y', from: 'DELTA', to: 'VALUE' },
];

function rewriteBlockType(xml: string, from: string, to: string): string {
  const pattern = new RegExp(`type=(["'])${escapeRegExp(from)}\\1`, 'g');
  return xml.replace(pattern, (_match, quote: string) => `type=${quote}${to}${quote}`);
}

function rewriteDirectChildName(
  xml: string,
  {
    blockType,
    tagName,
    from,
    to,
  }: {
    blockType: string;
    tagName: 'field' | 'statement' | 'value';
    from: string;
    to: string;
  },
): string {
  const pattern = new RegExp(
    `(<(?:block|shadow)[^>]*type=(["'])${escapeRegExp(blockType)}\\2[\\s\\S]*?<${tagName} name=(["']))${escapeRegExp(from)}\\3`,
    'g',
  );
  return xml.replace(pattern, (_match, prefix: string, _typeQuote: string, nameQuote: string) => `${prefix}${to}${nameQuote}`);
}

function rewriteMotionDirectionNumber(
  xml: string,
  {
    blockType,
    direction,
    multiplier,
  }: {
    blockType: 'motion_change_x' | 'motion_change_y';
    direction: 'LEFT' | 'RIGHT' | 'UP' | 'DOWN';
    multiplier: 1 | -1;
  },
): string {
  const pattern = new RegExp(
    `(<(?:block|shadow)[^>]*type=(["'])${escapeRegExp(blockType)}\\2[\\s\\S]*?<field name=(["'])DIR\\3>${direction}</field>[\\s\\S]*?<field name=(["'])NUM\\4>)(-?\\d+(?:\\.\\d+)?)(</field>)`,
    'g',
  );

  return xml.replace(pattern, (_match, prefix: string, _typeQuote: string, _fieldQuote: string, _numQuote: string, rawValue: string, suffix: string) => {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) {
      return `${prefix}${rawValue}${suffix}`;
    }
    const normalizedValue = multiplier > 0 ? Math.abs(parsed) : -Math.abs(parsed);
    return `${prefix}${normalizedValue}${suffix}`;
  });
}

function normalizeConfiguredKeyValue(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed.length === 1 && /[a-z0-9]/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  const upper = trimmed.toUpperCase();
  switch (upper) {
    case ' ':
    case 'SPACEBAR':
      return 'SPACE';
    case 'ESC':
      return 'ESCAPE';
    case 'RETURN':
      return 'ENTER';
    case 'ARROWUP':
      return 'UP';
    case 'ARROWDOWN':
      return 'DOWN';
    case 'ARROWLEFT':
      return 'LEFT';
    case 'ARROWRIGHT':
      return 'RIGHT';
    case 'CONTROL':
      return 'CTRL';
    case 'COMMAND':
    case 'CMD':
      return 'META';
    default:
      return upper;
  }
}

function findScopedBlockEnd(xml: string, startIndex: number): number | null {
  const tagPattern = /<\/?(block|shadow)\b[^>]*>/g;
  tagPattern.lastIndex = startIndex;

  let depth = 0;
  let sawRoot = false;

  for (let match = tagPattern.exec(xml); match; match = tagPattern.exec(xml)) {
    const tag = match[0];
    const isClosing = tag.startsWith('</');

    if (isClosing) {
      depth -= 1;
      if (sawRoot && depth === 0) {
        return match.index + tag.length;
      }
      continue;
    }

    sawRoot = true;
    depth += 1;
  }

  return null;
}

function applyMotionDirection(
  blockType: 'motion_change_x' | 'motion_change_y',
  direction: string | null,
  rawValue: string,
): string {
  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed)) {
    return rawValue;
  }

  const axisMultiplier =
    blockType === 'motion_change_x'
      ? direction === 'LEFT'
        ? -1
        : direction === 'RIGHT'
          ? 1
          : null
      : direction === 'DOWN'
        ? -1
        : direction === 'UP'
          ? 1
          : null;

  if (axisMultiplier === null) {
    return String(parsed);
  }

  return String(axisMultiplier > 0 ? Math.abs(parsed) : -Math.abs(parsed));
}

function normalizeMotionBlockSnippet(
  snippet: string,
  blockType: 'motion_change_x' | 'motion_change_y',
): string {
  const openTagMatch = snippet.match(/^<(block|shadow)\b[^>]*>/);
  if (!openTagMatch) {
    return snippet;
  }

  const openTag = openTagMatch[0];
  const closeTag = `</${openTagMatch[1]}>`;
  if (!snippet.endsWith(closeTag)) {
    return snippet;
  }

  const inner = snippet.slice(openTag.length, snippet.length - closeTag.length);
  const directionMatch = inner.match(/<field name=(["'])DIR\1>(LEFT|RIGHT|UP|DOWN)<\/field>/);
  const direction = directionMatch?.[2] ?? null;
  const innerWithoutDirection = inner.replace(
    /<field name=(["'])DIR\1>(LEFT|RIGHT|UP|DOWN)<\/field>\s*/,
    '',
  );
  const directNumberFieldMatch = innerWithoutDirection.match(
    /^\s*<field name=(["'])(?:VALUE|NUM|DELTA)\1>(-?\d+(?:\.\d+)?)<\/field>([\s\S]*)$/,
  );

  if (!directNumberFieldMatch) {
    return `${openTag}${innerWithoutDirection}${closeTag}`;
  }

  const numericValue = applyMotionDirection(
    blockType,
    direction,
    directNumberFieldMatch[2],
  );
  const suffix = directNumberFieldMatch[3];

  return `${openTag}<value name="VALUE"><block type="math_number"><field name="NUM">${numericValue}</field></block></value>${suffix}${closeTag}`;
}

function normalizeMotionBlocks(xml: string): string {
  const blockPattern = /<(block|shadow)\b[^>]*type=(["'])(motion_change_x|motion_change_y)\2[^>]*>/g;

  let normalized = '';
  let lastIndex = 0;

  for (let match = blockPattern.exec(xml); match; match = blockPattern.exec(xml)) {
    const startIndex = match.index;
    const endIndex = findScopedBlockEnd(xml, startIndex);
    if (endIndex === null) {
      break;
    }

    normalized += xml.slice(lastIndex, startIndex);
    normalized += normalizeMotionBlockSnippet(
      xml.slice(startIndex, endIndex),
      match[3] as 'motion_change_x' | 'motion_change_y',
    );
    lastIndex = endIndex;
    blockPattern.lastIndex = endIndex;
  }

  normalized += xml.slice(lastIndex);
  return normalized;
}

function normalizeKeyBlockSnippet(snippet: string): string {
  return snippet.replace(
    /(<field name=(["'])KEY\2>)([^<]+)(<\/field>)/,
    (_match, prefix: string, _quote: string, rawValue: string, suffix: string) =>
      `${prefix}${normalizeConfiguredKeyValue(rawValue)}${suffix}`,
  );
}

function normalizeKeyBlocks(xml: string): string {
  const blockPattern = /<(block|shadow)\b[^>]*type=(["'])(event_key_pressed|sensing_key_pressed)\2[^>]*>/g;

  let normalized = '';
  let lastIndex = 0;

  for (let match = blockPattern.exec(xml); match; match = blockPattern.exec(xml)) {
    const startIndex = match.index;
    const endIndex = findScopedBlockEnd(xml, startIndex);
    if (endIndex === null) {
      break;
    }

    normalized += xml.slice(lastIndex, startIndex);
    normalized += normalizeKeyBlockSnippet(xml.slice(startIndex, endIndex));
    lastIndex = endIndex;
    blockPattern.lastIndex = endIndex;
  }

  normalized += xml.slice(lastIndex);
  return normalized;
}

function normalizeControlsIfSnippet(snippet: string): string {
  const openTagMatch = snippet.match(/^<(block|shadow)\b[^>]*>/);
  if (!openTagMatch) {
    return snippet;
  }

  const openTag = openTagMatch[0];
  const closeTag = `</${openTagMatch[1]}>`;
  if (!snippet.endsWith(closeTag)) {
    return snippet;
  }
  const inner = snippet.slice(openTag.length, snippet.length - closeTag.length);
  const normalizedInner = normalizeControlsIfBlocks(inner);
  if (snippet.includes('<mutation')) {
    return `${openTag}${normalizedInner}${closeTag}`;
  }

  const elseIfMatches = Array.from(normalizedInner.matchAll(/<value name=(["'])IF([1-9]\d*)\1>/g));
  const elseIfCount = elseIfMatches.reduce((count, match) => {
    const index = Number(match[2]);
    return Number.isFinite(index) ? Math.max(count, index) : count;
  }, 0);
  const hasElse = /<statement name=(["'])ELSE\1>/.test(normalizedInner);

  if (elseIfCount === 0 && !hasElse) {
    return `${openTag}${normalizedInner}${closeTag}`;
  }

  const mutationAttributes: string[] = [];
  if (elseIfCount > 0) {
    mutationAttributes.push(`elseif="${elseIfCount}"`);
  }
  if (hasElse) {
    mutationAttributes.push('else="1"');
  }

  return `${openTag}<mutation ${mutationAttributes.join(' ')}></mutation>${normalizedInner}${closeTag}`;
}

function normalizeControlsIfBlocks(xml: string): string {
  const blockPattern = /<(block|shadow)\b[^>]*type=(["'])controls_if\2[^>]*>/g;

  let normalized = '';
  let lastIndex = 0;

  for (let match = blockPattern.exec(xml); match; match = blockPattern.exec(xml)) {
    const startIndex = match.index;
    const endIndex = findScopedBlockEnd(xml, startIndex);
    if (endIndex === null) {
      break;
    }

    normalized += xml.slice(lastIndex, startIndex);
    normalized += normalizeControlsIfSnippet(xml.slice(startIndex, endIndex));
    lastIndex = endIndex;
    blockPattern.lastIndex = endIndex;
  }

  normalized += xml.slice(lastIndex);
  return normalized;
}

function collectBlocklyBlockTypes(blocklyXml: string): string[] {
  const blockTypes: string[] = [];
  const seen = new Set<string>();
  const pattern = /<(?:block|shadow)\b[^>]*type=(["'])([^"']+)\1/gi;

  for (let match = pattern.exec(blocklyXml); match; match = pattern.exec(blocklyXml)) {
    const blockType = match[2]?.trim();
    if (!blockType || seen.has(blockType)) continue;
    seen.add(blockType);
    blockTypes.push(blockType);
  }

  return blockTypes;
}

const UNSUPPORTED_BLOCK_TYPE_PATTERNS: ReadonlyArray<RegExp> = [
  /^keyboard_/i,
  /^when_key_pressed$/i,
  /^events_whenkey(?:pressed|released)$/i,
  /^event_when_key_pressed$/i,
  /^event_send_message$/i,
  /^set_physics_velocity$/i,
  /^apply_physics_impulse$/i,
  /^if_on_ground$/i,
  /^wait_for_frame$/i,
  /^physics_is_on_ground$/i,
  /^object_jump$/i,
  /^motion_jump$/i,
  /^jump_if_on_floor$/i,
  /^is_on_ground$/i,
  /^event_set_velocity_y$/i,
  /^physics_jump$/i,
  /^object_set_velocity_[xy]$/i,
  /^setVelocity$/i,
  /^whenKeyPressed$/i,
  /^waitUntilKeyReleased$/i,
  /^isTouchingGround$/i,
  /^change_velocity$/i,
  /^jump$/i,
  /^variables_set_velocity_x(?:_to)?$/i,
  /^variables_set_velocity_y(?:_to)?$/i,
  /^variables_set_physics_jump$/i,
];

export function findUnsupportedBlocklyBlockTypes(blocklyXml: string): string[] {
  return collectBlocklyBlockTypes(blocklyXml).filter((blockType) =>
    UNSUPPORTED_BLOCK_TYPE_PATTERNS.some((pattern) => pattern.test(blockType)),
  );
}

export function validateBlocklyXmlStructure(blocklyXml: string): string | null {
  const trimmed = blocklyXml.trim();
  if (!trimmed) {
    return null;
  }

  if (!trimmed.startsWith('<xml')) {
    return 'Expected <xml> root element.';
  }

  if (/<parsererror\b/i.test(trimmed)) {
    return 'XML contains parsererror nodes.';
  }

  const tagPattern = /<[^>]+>/g;
  const stack: string[] = [];

  for (let match = tagPattern.exec(trimmed); match; match = tagPattern.exec(trimmed)) {
    const tag = match[0];
    if (tag.startsWith('<?') || tag.startsWith('<!')) {
      continue;
    }

    const closingMatch = tag.match(/^<\/([A-Za-z_][\w:.-]*)\s*>$/);
    if (closingMatch) {
      const expectedTag = stack.pop();
      if (!expectedTag) {
        return `Unexpected closing tag </${closingMatch[1]}>.`;
      }
      if (expectedTag !== closingMatch[1]) {
        return `Opening and ending tag mismatch: <${expectedTag}> and </${closingMatch[1]}>.`;
      }
      continue;
    }

    const openingMatch = tag.match(/^<([A-Za-z_][\w:.-]*)(?:\s[^<>]*?)?\/?>$/);
    if (!openingMatch) {
      return `Malformed tag: ${tag}`;
    }

    if (tag.endsWith('/>')) {
      continue;
    }

    stack.push(openingMatch[1]);
  }

  if (stack.length > 0) {
    return `Unclosed tag <${stack[stack.length - 1]}>.`;
  }

  return null;
}

export function normalizeBlocklyXml(blocklyXml: string): string {
  let normalized = blocklyXml;

  for (const [from, to] of Object.entries(BLOCK_TYPE_ALIASES)) {
    normalized = rewriteBlockType(normalized, from, to);
  }

  for (const alias of STATEMENT_NAME_ALIASES) {
    normalized = rewriteDirectChildName(normalized, {
      blockType: alias.blockType,
      tagName: 'statement',
      from: alias.from,
      to: alias.to,
    });
  }

  for (const alias of FIELD_NAME_ALIASES) {
    normalized = rewriteDirectChildName(normalized, {
      blockType: alias.blockType,
      tagName: 'field',
      from: alias.from,
      to: alias.to,
    });
  }

  for (const alias of VALUE_NAME_ALIASES) {
    normalized = rewriteDirectChildName(normalized, {
      blockType: alias.blockType,
      tagName: 'value',
      from: alias.from,
      to: alias.to,
    });
  }

  normalized = rewriteMotionDirectionNumber(normalized, {
    blockType: 'motion_change_x',
    direction: 'LEFT',
    multiplier: -1,
  });
  normalized = rewriteMotionDirectionNumber(normalized, {
    blockType: 'motion_change_x',
    direction: 'RIGHT',
    multiplier: 1,
  });
  normalized = rewriteMotionDirectionNumber(normalized, {
    blockType: 'motion_change_y',
    direction: 'DOWN',
    multiplier: -1,
  });
  normalized = rewriteMotionDirectionNumber(normalized, {
    blockType: 'motion_change_y',
    direction: 'UP',
    multiplier: 1,
  });
  normalized = normalizeKeyBlocks(normalized);
  normalized = normalizeControlsIfBlocks(normalized);
  normalized = normalizeMotionBlocks(normalized);

  return normalized;
}
