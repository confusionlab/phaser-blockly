import { expect, test } from '@playwright/test';

const APP_URL = process.env.POCHA_E2E_BASE_URL ?? '/';

test.describe('costume vector style clone', () => {
  test('duplicated textured styles keep the metadata needed to switch back to visible solid fill and stroke', async ({ page }) => {
    await page.goto(APP_URL);
    await page.waitForLoadState('networkidle');

    const result = await page.evaluate(async () => {
      const {
        applyVectorFillStyleToObject,
        applyVectorStrokeStyleToObject,
        cloneFabricObjectWithVectorStyle,
      } = await import('/src/components/editors/costume/costumeCanvasVectorRuntime.ts');

      type CloneableVectorObject = {
        type: string;
        fill: string;
        stroke: string;
        strokeWidth: number;
        opacity: number;
        noScaleCache: boolean;
        strokeUniform: boolean;
        vectorFillTextureId?: string;
        vectorFillColor?: string;
        vectorFillOpacity?: number;
        vectorStrokeBrushId?: string;
        vectorStrokeColor?: string;
        vectorStrokeOpacity?: number;
        vectorStrokeWiggle?: number;
        set: (updates: Record<string, unknown>) => void;
        clone: (propertiesToInclude?: string[]) => Promise<CloneableVectorObject>;
      };

      const createCloneableVectorObject = (
        state: Partial<Omit<CloneableVectorObject, 'set' | 'clone'>>,
      ): CloneableVectorObject => {
        const target = {
          type: state.type ?? 'rect',
          fill: state.fill ?? 'rgba(0, 0, 0, 0)',
          stroke: state.stroke ?? 'rgba(0, 0, 0, 0)',
          strokeWidth: state.strokeWidth ?? 12,
          opacity: state.opacity ?? 1,
          noScaleCache: state.noScaleCache ?? false,
          strokeUniform: state.strokeUniform ?? true,
          vectorFillTextureId: state.vectorFillTextureId,
          vectorFillColor: state.vectorFillColor,
          vectorFillOpacity: state.vectorFillOpacity,
          vectorStrokeBrushId: state.vectorStrokeBrushId,
          vectorStrokeColor: state.vectorStrokeColor,
          vectorStrokeOpacity: state.vectorStrokeOpacity,
          vectorStrokeWiggle: state.vectorStrokeWiggle,
          set(updates: Record<string, unknown>) {
            Object.assign(target, updates);
          },
          async clone(propertiesToInclude?: string[]) {
            const base: Partial<CloneableVectorObject> = {
              type: target.type,
              fill: target.fill,
              stroke: target.stroke,
              strokeWidth: target.strokeWidth,
              opacity: target.opacity,
              noScaleCache: target.noScaleCache,
              strokeUniform: target.strokeUniform,
            };
            for (const key of propertiesToInclude ?? []) {
              if (key in target) {
                (base as Record<string, unknown>)[key] = (target as Record<string, unknown>)[key];
              }
            }
            return createCloneableVectorObject(base);
          },
        } satisfies CloneableVectorObject;

        return target;
      };

      const texturedFillSource = createCloneableVectorObject({
        fill: 'rgba(239, 68, 68, 0)',
        stroke: '#2563eb',
        vectorFillTextureId: 'crayon',
        vectorFillColor: '#ef4444',
        vectorFillOpacity: 1,
        vectorStrokeBrushId: 'solid',
        vectorStrokeColor: '#2563eb',
        vectorStrokeOpacity: 1,
      });
      const texturedFillClone = await cloneFabricObjectWithVectorStyle(texturedFillSource);
      applyVectorFillStyleToObject(texturedFillClone, {
        fillTextureId: 'solid',
      });

      const texturedStrokeSource = createCloneableVectorObject({
        fill: '#22c55e',
        stroke: 'rgba(37, 99, 235, 0)',
        vectorFillTextureId: 'solid',
        vectorFillColor: '#22c55e',
        vectorFillOpacity: 1,
        vectorStrokeBrushId: 'crayon',
        vectorStrokeColor: '#2563eb',
        vectorStrokeOpacity: 1,
        vectorStrokeWiggle: 0.4,
      });
      const texturedStrokeClone = await cloneFabricObjectWithVectorStyle(texturedStrokeSource);
      applyVectorStrokeStyleToObject(texturedStrokeClone, {
        strokeBrushId: 'solid',
      });

      return {
        fillClone: {
          vectorFillTextureId: texturedFillClone.vectorFillTextureId ?? null,
          vectorFillOpacity: texturedFillClone.vectorFillOpacity ?? null,
          fill: texturedFillClone.fill,
        },
        strokeClone: {
          vectorStrokeBrushId: texturedStrokeClone.vectorStrokeBrushId ?? null,
          vectorStrokeOpacity: texturedStrokeClone.vectorStrokeOpacity ?? null,
          vectorStrokeWiggle: texturedStrokeClone.vectorStrokeWiggle ?? null,
          stroke: texturedStrokeClone.stroke,
        },
      };
    });

    expect(result.fillClone.vectorFillTextureId).toBe('solid');
    expect(result.fillClone.vectorFillOpacity).toBe(1);
    expect(result.fillClone.fill).not.toBe('rgba(239, 68, 68, 0)');

    expect(result.strokeClone.vectorStrokeBrushId).toBe('solid');
    expect(result.strokeClone.vectorStrokeOpacity).toBe(1);
    expect(result.strokeClone.vectorStrokeWiggle).toBe(0.4);
    expect(result.strokeClone.stroke).not.toBe('rgba(37, 99, 235, 0)');
  });
});
