import { expect, test } from '@playwright/test';
import { beginTextEditing, isTextEditableObject } from '../src/components/editors/costume/costumeTextCommands';

type FakeTextObject = {
  type?: string;
  isEditing?: boolean;
  events: unknown[];
  enterEditing: (event?: unknown) => void;
  selectAll: () => void;
};

function createTextObject(type: string, isEditing = false): FakeTextObject {
  return {
    type,
    isEditing,
    events: [],
    enterEditing(event?: unknown) {
      this.events.push(['enterEditing', event]);
      this.isEditing = true;
    },
    selectAll() {
      this.events.push(['selectAll']);
    },
  };
}

test.describe('costume text commands', () => {
  test('recognizes fabric text objects', () => {
    expect(isTextEditableObject({ type: 'i-text' })).toBe(true);
    expect(isTextEditableObject({ type: 'activeSelection' })).toBe(false);
    expect(isTextEditableObject(null)).toBe(false);
  });

  test('new text editing selects the default placeholder text', () => {
    const textObject = createTextObject('i-text');
    const operations: string[] = [];
    const canvas = {
      setActiveObject() {
        operations.push('setActiveObject');
      },
      requestRenderAll() {
        operations.push('requestRenderAll');
      },
    };

    beginTextEditing(canvas, textObject, { selectAll: true });

    expect(operations).toEqual(['setActiveObject', 'requestRenderAll']);
    expect(textObject.events).toEqual([
      ['enterEditing', undefined],
      ['selectAll'],
    ]);
  });

  test('existing text enters editing without selecting all text', () => {
    const pointerEvent = { kind: 'pointer' };
    const textObject = createTextObject('text');
    const operations: string[] = [];
    const canvas = {
      setActiveObject() {
        operations.push('setActiveObject');
      },
      requestRenderAll() {
        operations.push('requestRenderAll');
      },
    };

    beginTextEditing(canvas, textObject, { event: pointerEvent, selectAll: false });

    expect(operations).toEqual(['setActiveObject', 'requestRenderAll']);
    expect(textObject.events).toEqual([
      ['enterEditing', pointerEvent],
    ]);
  });
});
