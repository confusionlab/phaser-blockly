import { useEffect, type MutableRefObject } from 'react';
import type { Canvas as FabricCanvas } from 'fabric';
import type { CostumeEditorMode } from '@/types';
import type { DrawingTool } from './CostumeToolbar';

interface UseCostumeCanvasPenHotkeysOptions {
  activeToolRef: MutableRefObject<DrawingTool>;
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  finalizePenDraft: () => boolean;
  penAnchorPlacementSessionRef: MutableRefObject<any>;
  penDraftRef: MutableRefObject<any>;
  penModifierStateRef: MutableRefObject<{ alt: boolean; space: boolean }>;
  removeLastPenDraftAnchor: () => void;
  setPenAnchorMoveMode: (enabled: boolean) => boolean;
  syncPenPlacementToAltModifier: (enabled: boolean) => boolean;
}

export function useCostumeCanvasPenHotkeys({
  activeToolRef,
  editorModeRef,
  fabricCanvasRef,
  finalizePenDraft,
  penAnchorPlacementSessionRef,
  penDraftRef,
  penModifierStateRef,
  removeLastPenDraftAnchor,
  setPenAnchorMoveMode,
  syncPenPlacementToAltModifier,
}: UseCostumeCanvasPenHotkeysOptions) {
  useEffect(() => {
    const shouldIgnorePenShortcutTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tagName = target.tagName.toLowerCase();
      return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (editorModeRef.current !== 'vector' || activeToolRef.current !== 'pen') {
        return;
      }
      if (shouldIgnorePenShortcutTarget(event.target)) {
        return;
      }

      if (event.key === ' ' && penAnchorPlacementSessionRef.current) {
        event.preventDefault();
        if (!penModifierStateRef.current.space) {
          penModifierStateRef.current.space = true;
          if (setPenAnchorMoveMode(true)) {
            fabricCanvasRef.current?.requestRenderAll();
          }
        }
        return;
      }

      if (event.key === 'Alt' && penAnchorPlacementSessionRef.current) {
        event.preventDefault();
        if (!penModifierStateRef.current.alt) {
          penModifierStateRef.current.alt = true;
          if (syncPenPlacementToAltModifier(true)) {
            fabricCanvasRef.current?.requestRenderAll();
          }
        }
        return;
      }

      if (!penDraftRef.current) {
        return;
      }

      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        finalizePenDraft();
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        event.preventDefault();
        removeLastPenDraftAnchor();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (editorModeRef.current !== 'vector' || activeToolRef.current !== 'pen') {
        return;
      }

      if (event.key === ' ') {
        if (!penModifierStateRef.current.space) {
          return;
        }
        event.preventDefault();
        penModifierStateRef.current.space = false;
        if (setPenAnchorMoveMode(false)) {
          fabricCanvasRef.current?.requestRenderAll();
        }
        return;
      }

      if (event.key === 'Alt') {
        if (!penModifierStateRef.current.alt) {
          return;
        }
        penModifierStateRef.current.alt = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [
    activeToolRef,
    editorModeRef,
    fabricCanvasRef,
    finalizePenDraft,
    penAnchorPlacementSessionRef,
    penDraftRef,
    penModifierStateRef,
    removeLastPenDraftAnchor,
    setPenAnchorMoveMode,
    syncPenPlacementToAltModifier,
  ]);
}
