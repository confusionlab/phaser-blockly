import { expect, test } from '@playwright/test';
import {
  normalizeVectorObjectRendering,
  pathCommandsDescribeClosedShape,
  stripRedundantTerminalCloseCommand,
} from '../src/components/editors/costume/costumeCanvasVectorRuntime';

function clonePath(path: any[]) {
  return path.map((command) => (Array.isArray(command) ? [...command] : command));
}

function createVectorPathCandidate(path: any[]) {
  return {
    type: 'path',
    path: clonePath(path),
    nodeHandleTypes: {
      '0': 'symmetric',
      '1': 'symmetric',
      '2': 'symmetric',
      '3': 'symmetric',
    },
    strokeUniform: true,
    noScaleCache: false,
    fill: '#000000',
    stroke: '#000000',
    strokeWidth: 2,
    vectorFillTextureId: 'solid',
    vectorFillColor: '#000000',
    vectorFillOpacity: 1,
    vectorStrokeBrushId: 'solid',
    vectorStrokeColor: '#000000',
    vectorStrokeOpacity: 1,
    vectorStrokeWiggle: 0,
    set(props: Record<string, unknown>) {
      Object.assign(this, props);
    },
    setCoords() {},
    setDimensions() {},
  };
}

const rectanglePath = [
  ['M', 0, 0],
  ['L', 120, 0],
  ['L', 120, 80],
  ['L', 0, 80],
  ['Z'],
];

const trianglePath = [
  ['M', 60, 0],
  ['L', 120, 120],
  ['L', 0, 120],
  ['Z'],
];

const starPath = [
  ['M', 50, 0],
  ['L', 61, 35],
  ['L', 98, 35],
  ['L', 68, 57],
  ['L', 79, 91],
  ['L', 50, 70],
  ['L', 21, 91],
  ['L', 32, 57],
  ['L', 2, 35],
  ['L', 39, 35],
  ['Z'],
];

const circlePath = [
  ['M', 70, 0],
  ['C', 70, 38.66, 38.66, 70, 0, 70],
  ['C', -38.66, 70, -70, 38.66, -70, 0],
  ['C', -70, -38.66, -38.66, -70, 0, -70],
  ['C', 38.66, -70, 70, -38.66, 70, 0],
  ['Z'],
];

test.describe('vector closed shape path normalization', () => {
  test('preserves explicit closure for rectangle, triangle, and star paths', () => {
    expect(stripRedundantTerminalCloseCommand(rectanglePath)).toBeNull();
    expect(stripRedundantTerminalCloseCommand(trianglePath)).toBeNull();
    expect(stripRedundantTerminalCloseCommand(starPath)).toBeNull();

    expect(pathCommandsDescribeClosedShape(rectanglePath)).toBe(true);
    expect(pathCommandsDescribeClosedShape(trianglePath)).toBe(true);
    expect(pathCommandsDescribeClosedShape(starPath)).toBe(true);
  });

  test('drops only the redundant terminal close command from circle-style paths', () => {
    const normalized = stripRedundantTerminalCloseCommand(circlePath);

    expect(normalized).not.toBeNull();
    expect(normalized?.[normalized.length - 1]?.[0]).toBe('C');
    expect(pathCommandsDescribeClosedShape(normalized)).toBe(true);
  });

  test('normalizes circle node handle metadata without introducing a duplicate closing anchor', () => {
    const candidate = createVectorPathCandidate(circlePath);

    const changed = normalizeVectorObjectRendering(candidate);

    expect(changed).toBe(true);
    expect(candidate.path[candidate.path.length - 1]?.[0]).toBe('C');
    expect(pathCommandsDescribeClosedShape(candidate.path)).toBe(true);
    expect(candidate.nodeHandleTypes).toEqual({
      '0': 'symmetric',
      '1': 'symmetric',
      '2': 'symmetric',
      '3': 'symmetric',
    });
  });
});
