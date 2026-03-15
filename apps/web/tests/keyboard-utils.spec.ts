import { expect, test } from '@playwright/test';
import { isBlocklyShortcutTarget, isTextEntryTarget } from '../src/utils/keyboard';

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
});
