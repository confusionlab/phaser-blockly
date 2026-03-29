import { create } from 'zustand';
import {
  cloneCostumeEditorPersistedState,
  type CostumeEditorPersistedState,
  type CostumeEditorTarget,
} from '@/lib/editor/costumeEditorSession';
import { cloneCostumeAssetFrame } from '@/lib/costume/costumeAssetFrame';
import type { CostumeAssetFrame, CostumeBounds } from '@/types';

export interface CostumeRuntimePreviewEntry extends CostumeEditorTarget {
  assetFrame: CostumeAssetFrame | null;
  bounds: CostumeBounds | null;
  revision: number;
  sourceCanvas: HTMLCanvasElement;
}

export interface CostumePresentationEntry extends CostumeEditorTarget {
  preview: CostumeRuntimePreviewEntry | null;
  revision: number;
  state: CostumeEditorPersistedState;
}

interface CostumeRuntimePreviewStore {
  presentations: Record<string, CostumePresentationEntry>;
  previews: Record<string, CostumeRuntimePreviewEntry>;
  version: number;
  clearPreview: (targetOrKey: CostumeEditorTarget | string) => void;
  publishPresentation: (entry: CostumePresentationEntry) => void;
  publishPreview: (entry: CostumeRuntimePreviewEntry) => void;
}

function getCostumeRuntimePreviewKey(target: CostumeEditorTarget): string {
  return `${target.sceneId}:${target.objectId}:${target.costumeId}`;
}

function cloneRuntimePreviewEntry(
  entry: CostumeRuntimePreviewEntry,
): CostumeRuntimePreviewEntry {
  return {
    sceneId: entry.sceneId,
    objectId: entry.objectId,
    costumeId: entry.costumeId,
    revision: entry.revision,
    sourceCanvas: entry.sourceCanvas,
    assetFrame: cloneCostumeAssetFrame(entry.assetFrame),
    bounds: entry.bounds ? { ...entry.bounds } : null,
  };
}

function clonePresentationEntry(
  entry: CostumePresentationEntry,
): CostumePresentationEntry | null {
  const nextState = cloneCostumeEditorPersistedState(entry.state);
  if (!nextState) {
    return null;
  }

  return {
    sceneId: entry.sceneId,
    objectId: entry.objectId,
    costumeId: entry.costumeId,
    revision: entry.revision,
    state: nextState,
    preview: entry.preview ? cloneRuntimePreviewEntry(entry.preview) : null,
  };
}

export const useCostumeRuntimePreviewStore = create<CostumeRuntimePreviewStore>((set) => ({
  presentations: {},
  previews: {},
  version: 0,
  publishPresentation: (entry) => {
    const key = getCostumeRuntimePreviewKey(entry);
    const nextEntry = clonePresentationEntry(entry);
    if (!nextEntry) {
      return;
    }

    set((state) => {
      const nextPreviews = { ...state.previews };
      if (nextEntry.preview) {
        nextPreviews[key] = nextEntry.preview;
      } else {
        delete nextPreviews[key];
      }

      return {
        presentations: {
          ...state.presentations,
          [key]: nextEntry,
        },
        previews: nextPreviews,
        version: state.version + 1,
      };
    });
  },
  publishPreview: (entry) => {
    const key = getCostumeRuntimePreviewKey(entry);
    const nextPreview = cloneRuntimePreviewEntry(entry);
    set((state) => ({
      presentations: state.presentations[key]
        ? {
            ...state.presentations,
            [key]: {
              ...state.presentations[key],
              preview: nextPreview,
              revision: nextPreview.revision,
            },
          }
        : state.presentations,
      previews: {
        ...state.previews,
        [key]: nextPreview,
      },
      version: state.version + 1,
    }));
  },
  clearPreview: (targetOrKey) => {
    const key = typeof targetOrKey === 'string'
      ? targetOrKey
      : getCostumeRuntimePreviewKey(targetOrKey);
    set((state) => {
      const hasPreview = key in state.previews;
      const hasPresentation = key in state.presentations;
      if (!hasPreview && !hasPresentation) {
        return state;
      }

      const nextPreviews = { ...state.previews };
      const nextPresentations = { ...state.presentations };
      delete nextPreviews[key];
      delete nextPresentations[key];
      return {
        presentations: nextPresentations,
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

export function publishCostumePresentation(entry: CostumePresentationEntry): void {
  useCostumeRuntimePreviewStore.getState().publishPresentation(entry);
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

  const entry = useCostumeRuntimePreviewStore.getState().previews[getCostumeRuntimePreviewKey(target)];
  return entry ? cloneRuntimePreviewEntry(entry) : null;
}

export function getCostumePresentation(
  target: CostumeEditorTarget | null | undefined,
): CostumePresentationEntry | null {
  if (!target) {
    return null;
  }

  const entry = useCostumeRuntimePreviewStore.getState().presentations[getCostumeRuntimePreviewKey(target)];
  return entry ? clonePresentationEntry(entry) : null;
}
