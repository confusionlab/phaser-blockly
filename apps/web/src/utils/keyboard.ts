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

const TEXT_ENTRY_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[contenteditable="plaintext-only"]',
  '[role="textbox"]',
  '[data-hotkeys="ignore"]',
].join(', ');

const BLOCKLY_SELECTOR = '[data-blockly-editor], .blocklyWidgetDiv, .blocklyDropDownDiv';
const SCENE_OBJECT_SHORTCUT_SURFACE_SELECTOR = '[data-editor-shortcut-surface="scene-objects"]';
let activeGlobalKeyboardCaptureCount = 0;

type ClosestCapableTarget = EventTarget & {
  closest?: (selector: string) => Element | null;
  tagName?: string;
  isContentEditable?: boolean;
};

type FocusableElement = HTMLElement & {
  focus: (options?: FocusOptions) => void;
};

function asClosestCapableTarget(target: EventTarget | null): ClosestCapableTarget | null {
  if (!target || typeof target !== 'object') {
    return null;
  }

  return target as ClosestCapableTarget;
}

function asFocusableElement(target: EventTarget | null): FocusableElement | null {
  if (!target || typeof target !== 'object') {
    return null;
  }

  const element = target as Partial<FocusableElement>;
  return typeof element.focus === 'function' ? element as FocusableElement : null;
}

export function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = asClosestCapableTarget(target);
  if (!element) {
    return false;
  }

  const tagName = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  if (tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT') {
    return true;
  }

  if (element.isContentEditable) {
    return true;
  }

  return typeof element.closest === 'function' && !!element.closest(TEXT_ENTRY_SELECTOR);
}

export function isBlocklyShortcutTarget(target: EventTarget | null): boolean {
  const element = asClosestCapableTarget(target);
  return typeof element?.closest === 'function' && !!element.closest(BLOCKLY_SELECTOR);
}

export function isSceneObjectShortcutSurfaceTarget(target: EventTarget | null): boolean {
  const element = asClosestCapableTarget(target);
  return typeof element?.closest === 'function' && !!element.closest(SCENE_OBJECT_SHORTCUT_SURFACE_SELECTOR);
}

export function focusKeyboardSurface(target: EventTarget | null): void {
  const element = asFocusableElement(target);
  if (!element) {
    return;
  }

  if (typeof document !== 'undefined' && document.activeElement === element) {
    return;
  }

  try {
    element.focus({ preventScroll: true });
  } catch {
    element.focus();
  }
}

export function acquireGlobalKeyboardCapture(): () => void {
  activeGlobalKeyboardCaptureCount += 1;

  let released = false;
  return () => {
    if (released) {
      return;
    }
    released = true;
    activeGlobalKeyboardCaptureCount = Math.max(0, activeGlobalKeyboardCaptureCount - 1);
  };
}

function hasActiveGlobalKeyboardCapture(): boolean {
  return activeGlobalKeyboardCaptureCount > 0;
}

function getActiveElementTarget(): EventTarget | null {
  if (typeof document === 'undefined') {
    return null;
  }

  return document.activeElement;
}

export function shouldIgnoreGlobalKeyboardEvent(event: KeyboardEvent): boolean {
  return (
    event.defaultPrevented
    || event.isComposing
    || hasActiveGlobalKeyboardCapture()
    || isTextEntryTarget(event.target)
    || isTextEntryTarget(getActiveElementTarget())
  );
}

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
