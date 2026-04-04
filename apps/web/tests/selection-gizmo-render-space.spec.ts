import { expect, test } from '@playwright/test';
import { syncCanvasSelectionGizmoAppearance } from '../src/components/editors/costume/costumeCanvasSelectionGizmo';

function createMockObject() {
  return {
    borderColor: '',
    borderScaleFactor: 0,
    borderOpacityWhenMoving: 0,
    controls: {},
    cornerColor: '',
    cornerSize: 0,
    cornerStrokeColor: '',
    cornerStyle: '',
    padding: 0,
    selectionBackgroundColor: '',
    setCoordsCalled: 0,
    touchCornerSize: 0,
    transparentCorners: false,
    setCoords() {
      this.setCoordsCalled += 1;
    },
  };
}

test.describe('selection gizmo render space', () => {
  test('keeps external-scale compensation for costume canvas', () => {
    const object = createMockObject();
    let renderGuideCalls = 0;

    syncCanvasSelectionGizmoAppearance({
      fabricCanvas: {
        forEachObject(callback: (obj: unknown) => void) {
          callback(object);
        },
        getActiveObject() {
          return object;
        },
        requestRenderAll() {},
      } as any,
      getZoomInvariantMetric: (metric, zoom = 1) => metric / zoom,
      pointEditingTarget: null,
      renderVectorPointEditingGuide: () => {
        renderGuideCalls += 1;
      },
      zoom: 0.5,
    });

    expect(object.padding).toBe(4);
    expect(object.cornerSize).toBe(24);
    expect(object.borderScaleFactor).toBe(4);
    expect(object.touchCornerSize).toBe(92);
    expect(renderGuideCalls).toBe(1);
  });

  test('uses raw metrics for fabric viewport rendering', () => {
    const object = createMockObject();

    syncCanvasSelectionGizmoAppearance({
      fabricCanvas: {
        forEachObject(callback: (obj: unknown) => void) {
          callback(object);
        },
        getActiveObject() {
          return object;
        },
        requestRenderAll() {},
      } as any,
      getZoomInvariantMetric: (metric, zoom = 1) => metric / zoom,
      pointEditingTarget: null,
      renderSpace: 'fabric-viewport',
      renderVectorPointEditingGuide: () => undefined,
      zoom: 0.5,
    });

    expect(object.padding).toBe(2);
    expect(object.cornerSize).toBe(12);
    expect(object.borderScaleFactor).toBe(2);
    expect(object.touchCornerSize).toBe(46);
  });
});
