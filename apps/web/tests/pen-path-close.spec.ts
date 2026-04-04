import { expect, test } from '@playwright/test';
import { Point } from 'fabric';
import {
  HANDLE_SIZE,
  buildPenDraftPathData,
  createPenDraftAnchor,
  getPenToolCloseHitRadiusPx,
} from '../src/components/editors/costume/costumeCanvasShared';

test.describe('pen path close serialization', () => {
  test('closed linear pen paths do not duplicate the starting anchor before Z', () => {
    const anchors = [
      createPenDraftAnchor(new Point(10, 10)),
      createPenDraftAnchor(new Point(30, 10)),
      createPenDraftAnchor(new Point(30, 30)),
    ];

    expect(buildPenDraftPathData(anchors, true)).toBe('M 10 10 L 30 10 L 30 30 Z');
  });

  test('closed curved pen paths keep their explicit closing bezier segment', () => {
    const anchors = [
      createPenDraftAnchor(new Point(10, 10)),
      createPenDraftAnchor(new Point(30, 10)),
      createPenDraftAnchor(new Point(30, 30)),
    ];
    anchors[0]!.incoming = new Point(0, 12);
    anchors[2]!.outgoing = new Point(22, 38);

    expect(buildPenDraftPathData(anchors, true)).toBe(
      'M 10 10 L 30 10 L 30 30 C 22 38 0 12 10 10 Z',
    );
  });

  test('pen close hit target is at least as large as the visible anchor handle footprint', () => {
    expect(getPenToolCloseHitRadiusPx()).toBeGreaterThanOrEqual(HANDLE_SIZE);
  });
});
