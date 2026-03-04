const KEY_CODE_TO_RUNTIME_KEY: Record<string, string> = {
  Space: 'SPACE',
  Enter: 'ENTER',
  NumpadEnter: 'ENTER',
  Tab: 'TAB',
  Escape: 'ESCAPE',
  Backspace: 'BACKSPACE',
  Delete: 'DELETE',
  ArrowUp: 'UP',
  ArrowDown: 'DOWN',
  ArrowLeft: 'LEFT',
  ArrowRight: 'RIGHT',
  ShiftLeft: 'SHIFT',
  ShiftRight: 'SHIFT',
  ControlLeft: 'CTRL',
  ControlRight: 'CTRL',
  AltLeft: 'ALT',
  AltRight: 'ALT',
  MetaLeft: 'META',
  MetaRight: 'META',
  Minus: 'MINUS',
  Equal: 'EQUALS',
  BracketLeft: 'LEFT_BRACKET',
  BracketRight: 'RIGHT_BRACKET',
  Backslash: 'BACKSLASH',
  Semicolon: 'SEMICOLON',
  Quote: 'QUOTE',
  Comma: 'COMMA',
  Period: 'PERIOD',
  Slash: 'SLASH',
  Backquote: 'BACKQUOTE',
};

const RUNTIME_KEY_ALIASES: Record<string, string> = {
  ' ': 'SPACE',
  SPACEBAR: 'SPACE',
  ESC: 'ESCAPE',
  RETURN: 'ENTER',
  ARROWUP: 'UP',
  ARROWDOWN: 'DOWN',
  ARROWLEFT: 'LEFT',
  ARROWRIGHT: 'RIGHT',
  CONTROL: 'CTRL',
  COMMAND: 'META',
  CMD: 'META',
};

export const KEY_DROPDOWN_OPTIONS: ReadonlyArray<[string, string]> = [
  ['space', 'SPACE'],
  ['enter', 'ENTER'],
  ['tab', 'TAB'],
  ['escape', 'ESCAPE'],
  ['backspace', 'BACKSPACE'],
  ['delete', 'DELETE'],
  ['up arrow', 'UP'],
  ['down arrow', 'DOWN'],
  ['left arrow', 'LEFT'],
  ['right arrow', 'RIGHT'],
  ['shift', 'SHIFT'],
  ['ctrl', 'CTRL'],
  ['alt', 'ALT'],
  ['meta', 'META'],
  ['a', 'A'],
  ['b', 'B'],
  ['c', 'C'],
  ['d', 'D'],
  ['e', 'E'],
  ['f', 'F'],
  ['g', 'G'],
  ['h', 'H'],
  ['i', 'I'],
  ['j', 'J'],
  ['k', 'K'],
  ['l', 'L'],
  ['m', 'M'],
  ['n', 'N'],
  ['o', 'O'],
  ['p', 'P'],
  ['q', 'Q'],
  ['r', 'R'],
  ['s', 'S'],
  ['t', 'T'],
  ['u', 'U'],
  ['v', 'V'],
  ['w', 'W'],
  ['x', 'X'],
  ['y', 'Y'],
  ['z', 'Z'],
  ['0', '0'],
  ['1', '1'],
  ['2', '2'],
  ['3', '3'],
  ['4', '4'],
  ['5', '5'],
  ['6', '6'],
  ['7', '7'],
  ['8', '8'],
  ['9', '9'],
  ['-', 'MINUS'],
  ['=', 'EQUALS'],
  ['[', 'LEFT_BRACKET'],
  [']', 'RIGHT_BRACKET'],
  ['\\', 'BACKSLASH'],
  [';', 'SEMICOLON'],
  ["'", 'QUOTE'],
  [',', 'COMMA'],
  ['.', 'PERIOD'],
  ['/', 'SLASH'],
  ['`', 'BACKQUOTE'],
];

export function normalizeKeyboardCode(code: string): string {
  if (/^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }

  if (/^Digit[0-9]$/.test(code)) {
    return code.slice(5);
  }

  if (/^Numpad[0-9]$/.test(code)) {
    return code.slice(6);
  }

  return KEY_CODE_TO_RUNTIME_KEY[code] || code.toUpperCase();
}

export function normalizeConfiguredKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) {
    return '';
  }

  if (/^Key[A-Z]$/.test(trimmed) || /^Digit[0-9]$/.test(trimmed) || /^Numpad[0-9]$/.test(trimmed)) {
    return normalizeKeyboardCode(trimmed);
  }

  if (trimmed.length === 1 && /[a-z0-9]/i.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  const upper = trimmed.toUpperCase();
  return RUNTIME_KEY_ALIASES[upper] || upper;
}
