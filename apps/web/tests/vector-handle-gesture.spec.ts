import { expect, test } from '@playwright/test';
import { resolvePathNodeHandleTypeForControlDrag } from '../src/components/editors/costume/costumeCanvasShared';

test.describe('vector handle gestures', () => {
  test('alt-dragging a bezier handle resolves the node to no-mirror corner mode', () => {
    expect(resolvePathNodeHandleTypeForControlDrag({
      breakMirroring: true,
      changed: 'incoming',
      currentType: 'symmetric',
      fallbackType: 'smooth',
    })).toBe('corner');

    expect(resolvePathNodeHandleTypeForControlDrag({
      breakMirroring: true,
      changed: 'outgoing',
      currentType: 'smooth',
      fallbackType: 'symmetric',
    })).toBe('corner');
  });

  test('non-handle drags keep the current or fallback node handle mode', () => {
    expect(resolvePathNodeHandleTypeForControlDrag({
      breakMirroring: true,
      changed: 'anchor',
      currentType: 'symmetric',
      fallbackType: 'corner',
    })).toBe('symmetric');

    expect(resolvePathNodeHandleTypeForControlDrag({
      breakMirroring: false,
      changed: 'incoming',
      currentType: null,
      fallbackType: 'smooth',
    })).toBe('smooth');
  });
});
