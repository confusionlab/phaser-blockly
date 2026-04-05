import { expect, test } from '@playwright/test';
import { applyVectorStyleUpdatesToSelection } from '../src/components/editors/costume/costumeCanvasVectorRuntime';

type FakeCenterPoint = { x: number; y: number };

type FakeVectorObject = {
  center: FakeCenterPoint;
  fill: string;
  group?: { offset: FakeCenterPoint };
  noScaleCache: boolean;
  positionByOriginCalls: FakeCenterPoint[];
  set: (props: Record<string, unknown>) => void;
  setCoords: () => void;
  setCoordsCalls: number;
  setXYCalls: FakeCenterPoint[];
  stroke: string;
  strokeUniform: boolean;
  strokeWidth: number;
  type: string;
  vectorFillColor: string;
  vectorFillOpacity: number;
  vectorFillTextureId: 'solid';
  vectorStrokeBrushId: 'solid';
  vectorStrokeColor: string;
  vectorStrokeOpacity: number;
  getCenterPoint: () => FakeCenterPoint;
  setPositionByOrigin: (point: FakeCenterPoint) => void;
  setXY?: (point: FakeCenterPoint) => void;
};

function createFakeVectorObject(): FakeVectorObject {
  return {
    center: { x: 120, y: 90 },
    fill: 'rgba(255, 0, 0, 1)',
    noScaleCache: false,
    positionByOriginCalls: [],
    setXYCalls: [],
    set(props) {
      if (typeof props.strokeWidth === 'number' && Number.isFinite(props.strokeWidth)) {
        const delta = props.strokeWidth - this.strokeWidth;
        if (delta !== 0) {
          this.center = {
            x: this.center.x + delta * 0.5,
            y: this.center.y + delta * 0.5,
          };
        }
      }
      Object.assign(this, props);
    },
    setCoords() {
      this.setCoordsCalls += 1;
    },
    setCoordsCalls: 0,
    stroke: 'rgba(0, 0, 0, 1)',
    strokeUniform: true,
    strokeWidth: 8,
    type: 'rect',
    vectorFillColor: '#ff0000',
    vectorFillOpacity: 1,
    vectorFillTextureId: 'solid',
    vectorStrokeBrushId: 'solid',
    vectorStrokeColor: '#000000',
    vectorStrokeOpacity: 1,
    getCenterPoint() {
      return { ...this.center };
    },
    setPositionByOrigin(point) {
      this.positionByOriginCalls.push({ ...point });
      this.center = { ...point };
    },
  };
}

test.describe('vector style selection runtime', () => {
  test('preserves object center when stroke width changes', () => {
    const target = createFakeVectorObject();
    const initialCenter = target.getCenterPoint();

    const didChange = applyVectorStyleUpdatesToSelection(target, {
      strokeStyle: { strokeWidth: 24 },
    });

    expect(didChange).toBe(true);
    expect(target.strokeWidth).toBe(24);
    expect(target.center).toEqual(initialCenter);
    expect(target.positionByOriginCalls).toEqual([initialCenter]);
    expect(target.setCoordsCalls).toBe(1);
  });

  test('preserves grouped object scene center when stroke width changes', () => {
    const target = createFakeVectorObject();
    target.group = { offset: { x: 300, y: 180 } };
    target.center = {
      x: target.group.offset.x + 120,
      y: target.group.offset.y + 90,
    };
    target.setXY = (point) => {
      target.setXYCalls.push({ ...point });
      target.center = { ...point };
    };
    target.setPositionByOrigin = (point) => {
      target.positionByOriginCalls.push({ ...point });
      target.center = {
        x: target.group!.offset.x + point.x,
        y: target.group!.offset.y + point.y,
      };
    };

    const initialCenter = target.getCenterPoint();

    const didChange = applyVectorStyleUpdatesToSelection(target, {
      strokeStyle: { strokeWidth: 24 },
    });

    expect(didChange).toBe(true);
    expect(target.strokeWidth).toBe(24);
    expect(target.center).toEqual(initialCenter);
    expect(target.setXYCalls).toEqual([initialCenter]);
    expect(target.positionByOriginCalls).toEqual([]);
    expect(target.setCoordsCalls).toBe(1);
  });
});
