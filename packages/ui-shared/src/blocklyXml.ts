function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const BLOCK_TYPE_ALIASES: Readonly<Record<string, string>> = {
  control_forever: 'event_forever',
  controls_forever: 'event_forever',
  event_whenflagclicked: 'event_game_start',
  event_whenkeypressed: 'event_key_pressed',
  event_whenthisspriteclicked: 'event_clicked',
  keyboard_is_key_pressed: 'sensing_key_pressed',
  sensing_keypressed: 'sensing_key_pressed',
};

const STATEMENT_NAME_ALIASES: ReadonlyArray<{
  blockType: string;
  from: string;
  to: string;
}> = [
  { blockType: 'event_game_start', from: 'SUBSTACK', to: 'NEXT' },
  { blockType: 'event_key_pressed', from: 'SUBSTACK', to: 'NEXT' },
  { blockType: 'event_clicked', from: 'SUBSTACK', to: 'NEXT' },
  { blockType: 'event_forever', from: 'SUBSTACK', to: 'DO' },
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
    tagName: 'field' | 'statement';
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

  return normalized;
}
