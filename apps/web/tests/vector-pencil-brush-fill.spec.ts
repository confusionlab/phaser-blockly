import { expect, test } from '@playwright/test';
import {
  getVectorStyleSelectionSnapshot,
  VectorPencilBrush,
} from '../src/components/editors/costume/costumeCanvasVectorRuntime';

test.describe('vector pencil brush fill metadata', () => {
  test('creates paths with transparent fill metadata mirrored from the stroke brush', () => {
    const brush = new VectorPencilBrush({
      clearContext() {},
      contextTop: {},
      getZoom() {
        return 1;
      },
      renderAll() {},
      requestRenderAll() {},
    } as any, {
      strokeBrushId: 'crayon',
      strokeColor: '#7c3aed',
      strokeOpacity: 0.6,
      strokeWidth: 8,
      strokeWiggle: 0.24,
    });

    const path = brush.createPath('M 0 0 Q 12 12 24 24');
    const snapshot = getVectorStyleSelectionSnapshot(path);

    expect((path as any).vectorFillTextureId).toBe('crayon');
    expect((path as any).vectorFillColor).toBe('#7c3aed');
    expect((path as any).vectorFillOpacity).toBe(0);

    expect(snapshot?.style.fillTextureId).toBe('crayon');
    expect(snapshot?.style.fillColor?.toLowerCase()).toBe('#7c3aed');
    expect(snapshot?.style.fillOpacity).toBe(0);
    expect(snapshot?.style.strokeBrushId).toBe('crayon');
  });
});
