import { expect, test } from '@playwright/test';
import {
  acquireGlobalKeyboardCapture,
  getSelectionNudgeDelta,
  isBlocklyShortcutTarget,
  isTextEntryTarget,
  shouldIgnoreGlobalKeyboardEvent,
} from '../src/utils/keyboard';

function createTarget(options: {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => Element | null;
} = {}): EventTarget {
  return {
    tagName: options.tagName,
    isContentEditable: options.isContentEditable,
    closest: options.closest,
  } as EventTarget;
}

test.describe('keyboard target guards', () => {
  test('treats native text controls as text entry targets', () => {
    expect(isTextEntryTarget(createTarget({ tagName: 'input' }))).toBe(true);
    expect(isTextEntryTarget(createTarget({ tagName: 'textarea' }))).toBe(true);
    expect(isTextEntryTarget(createTarget({ tagName: 'select' }))).toBe(true);
  });

  test('treats contenteditable and opt-out containers as text entry targets', () => {
    expect(isTextEntryTarget(createTarget({ isContentEditable: true }))).toBe(true);
    expect(isTextEntryTarget(createTarget({
      closest: (selector) => (selector.includes('[data-hotkeys="ignore"]') ? ({} as Element) : null),
    }))).toBe(true);
  });

  test('detects blockly shortcut targets through ancestors', () => {
    expect(isBlocklyShortcutTarget(createTarget({
      closest: (selector) => (selector.includes('.blocklyWidgetDiv') ? ({} as Element) : null),
    }))).toBe(true);
    expect(isBlocklyShortcutTarget(createTarget())).toBe(false);
  });

  test('global shortcut guard ignores typing and composition states', () => {
    const inputTarget = createTarget({ tagName: 'input' });
    expect(shouldIgnoreGlobalKeyboardEvent({
      defaultPrevented: false,
      isComposing: false,
      target: inputTarget,
    } as KeyboardEvent)).toBe(true);

    expect(shouldIgnoreGlobalKeyboardEvent({
      defaultPrevented: false,
      isComposing: true,
      target: createTarget(),
    } as KeyboardEvent)).toBe(true);

    expect(shouldIgnoreGlobalKeyboardEvent({
      defaultPrevented: true,
      isComposing: false,
      target: createTarget(),
    } as KeyboardEvent)).toBe(true);

    expect(shouldIgnoreGlobalKeyboardEvent({
      defaultPrevented: false,
      isComposing: false,
      target: createTarget(),
    } as KeyboardEvent)).toBe(false);
  });

  test('global shortcut guard ignores active keyboard capture sessions', () => {
    const release = acquireGlobalKeyboardCapture();
    try {
      expect(shouldIgnoreGlobalKeyboardEvent({
        defaultPrevented: false,
        isComposing: false,
        target: createTarget(),
      } as KeyboardEvent)).toBe(true);
    } finally {
      release();
    }

    expect(shouldIgnoreGlobalKeyboardEvent({
      defaultPrevented: false,
      isComposing: false,
      target: createTarget(),
    } as KeyboardEvent)).toBe(false);
  });

  test('resolves arrow keys into 1px nudges by default', () => {
    expect(getSelectionNudgeDelta({
      key: 'ArrowLeft',
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({ x: -1, y: 0 });

    expect(getSelectionNudgeDelta({
      key: 'ArrowUp',
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({ x: 0, y: -1 });
  });

  test('resolves shift+arrow keys into larger nudges', () => {
    expect(getSelectionNudgeDelta({
      key: 'ArrowRight',
      shiftKey: true,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    } as KeyboardEvent)).toEqual({ x: 10, y: 0 });
  });

  test('ignores non-arrow or modified selection nudge keys', () => {
    expect(getSelectionNudgeDelta({
      key: 'a',
      shiftKey: false,
      metaKey: false,
      ctrlKey: false,
      altKey: false,
    } as KeyboardEvent)).toBeNull();

    expect(getSelectionNudgeDelta({
      key: 'ArrowDown',
      shiftKey: false,
      metaKey: false,
      ctrlKey: true,
      altKey: false,
    } as KeyboardEvent)).toBeNull();
  });
});
