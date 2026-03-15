import { expect, test } from '@playwright/test';
import { attachTextEditingContainer } from '../src/components/editors/costume/costumeTextCommands';

test.describe('costume text editing container', () => {
  test('attaches a local hidden textarea container to text objects', () => {
    const host = {} as HTMLElement;
    const textObject: { hiddenTextareaContainer?: HTMLElement | null } = {};

    attachTextEditingContainer(textObject, host);

    expect(textObject.hiddenTextareaContainer).toBe(host);
  });
});
