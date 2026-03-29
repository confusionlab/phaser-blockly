import { create } from 'zustand';
import type { CostumeEditorTarget } from '@/lib/editor/costumeEditorSession';
import type { CostumeAssetFrame, CostumeBounds } from '@/types';

export interface CostumeRuntimePreviewEntry extends CostumeEditorTarget {
  assetFrame: CostumeAssetFrame | null;
  bounds: CostumeBounds | null;
  revision: number;
  sourceCanvas: HTMLCanvasElement;
}

interface CostumeRuntimePreviewStore {
  previews: Record<string, CostumeRuntimePreviewEntry>;
  version: number;
  clearPreview: (targetOrKey: CostumeEditorTarget | string) => void;
  publishPreview: (entry: CostumeRuntimePreviewEntry) => void;
}

function getCostumeRuntimePreviewKey(target: CostumeEditorTarget): string {
  return `${target.sceneId}:${target.objectId}:${target.costumeId}`;
}

export const useCostumeRuntimePreviewStore = create<CostumeRuntimePreviewStore>((set) => ({
  previews: {},
  version: 0,
  publishPreview: (entry) => {
    const key = getCostumeRuntimePreviewKey(entry);
    set((state) => ({
      previews: {
        ...state.previews,
        [key]: entry,
      },
      version: state.version + 1,
    }));
  },
  clearPreview: (targetOrKey) => {
    const key = typeof targetOrKey === 'string'
      ? targetOrKey
      : getCostumeRuntimePreviewKey(targetOrKey);
    set((state) => {
      if (!(key in state.previews)) {
        return state;
      }

      const nextPreviews = { ...state.previews };
      delete nextPreviews[key];
      return {
        previews: nextPreviews,
        version: state.version + 1,
      };
    });
  },
}));

export function getCostumeRuntimePreviewKeyForTarget(target: CostumeEditorTarget): string {
  return getCostumeRuntimePreviewKey(target);
}

export function publishCostumeRuntimePreview(entry: CostumeRuntimePreviewEntry): void {
  useCostumeRuntimePreviewStore.getState().publishPreview(entry);
}

export function clearCostumeRuntimePreview(targetOrKey: CostumeEditorTarget | string | null | undefined): void {
  if (!targetOrKey) {
    return;
  }
  useCostumeRuntimePreviewStore.getState().clearPreview(targetOrKey);
}

export function getCostumeRuntimePreview(
  target: CostumeEditorTarget | null | undefined,
): CostumeRuntimePreviewEntry | null {
  if (!target) {
    return null;
  }

  return useCostumeRuntimePreviewStore.getState().previews[getCostumeRuntimePreviewKey(target)] ?? null;
}
