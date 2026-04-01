import { useEffect, type MutableRefObject } from 'react';
import type { Canvas as FabricCanvas } from 'fabric';
import type { CostumeEditorMode } from '@/types';
import type { DrawingTool } from './CostumeToolbar';
import type { MirroredPathAnchorDragSession } from './costumeCanvasShared';

interface UseCostumeCanvasMirroredPathHotkeysOptions {
  activeToolRef: MutableRefObject<DrawingTool>;
  editorModeRef: MutableRefObject<CostumeEditorMode>;
  fabricCanvasRef: MutableRefObject<FabricCanvas | null>;
  mirroredPathAnchorDragModifierStateRef: MutableRefObject<{ space: boolean }>;
  mirroredPathAnchorDragSessionRef: MutableRefObject<MirroredPathAnchorDragSession | null>;
  setMirroredPathAnchorDragSessionMoveMode: (
    session: MirroredPathAnchorDragSession | null,
    enabled: boolean,
  ) => boolean;
}

export function useCostumeCanvasMirroredPathHotkeys({
  activeToolRef,
  editorModeRef,
  fabricCanvasRef,
  mirroredPathAnchorDragModifierStateRef,
  mirroredPathAnchorDragSessionRef,
  setMirroredPathAnchorDragSessionMoveMode,
}: UseCostumeCanvasMirroredPathHotkeysOptions) {
  useEffect(() => {
    const isSpaceKeyEvent = (event: KeyboardEvent) => (
      event.key === ' ' ||
      event.key === 'Space' ||
      event.key === 'Spacebar' ||
      event.code === 'Space'
    );

    const shouldIgnoreShortcutTarget = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      if (target.isContentEditable) return true;
      const tagName = target.tagName.toLowerCase();
      return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (editorModeRef.current !== 'vector' || activeToolRef.current !== 'select') {
        return;
      }
      if (shouldIgnoreShortcutTarget(event.target)) {
        return;
      }
      if (!isSpaceKeyEvent(event) || !mirroredPathAnchorDragSessionRef.current) {
        return;
      }

      event.preventDefault();
      if (mirroredPathAnchorDragModifierStateRef.current.space) {
        return;
      }
      mirroredPathAnchorDragModifierStateRef.current.space = true;
      if (setMirroredPathAnchorDragSessionMoveMode(mirroredPathAnchorDragSessionRef.current, true)) {
        fabricCanvasRef.current?.requestRenderAll();
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (editorModeRef.current !== 'vector' || activeToolRef.current !== 'select') {
        return;
      }
      if (!isSpaceKeyEvent(event)) {
        return;
      }
      if (!mirroredPathAnchorDragModifierStateRef.current.space) {
        return;
      }

      event.preventDefault();
      mirroredPathAnchorDragModifierStateRef.current.space = false;
      if (setMirroredPathAnchorDragSessionMoveMode(mirroredPathAnchorDragSessionRef.current, false)) {
        fabricCanvasRef.current?.requestRenderAll();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('keyup', handleKeyUp, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('keyup', handleKeyUp, true);
    };
  }, [
    activeToolRef,
    editorModeRef,
    fabricCanvasRef,
    mirroredPathAnchorDragModifierStateRef,
    mirroredPathAnchorDragSessionRef,
    setMirroredPathAnchorDragSessionMoveMode,
  ]);
}
