import type { StageEditorViewport, StageViewMode } from '@/lib/stageViewport';
import type { Project } from '@/types';

export type ScenePasteTargetCenter = {
  x: number;
  y: number;
};

type GetScenePasteTargetCenterArgs = {
  project: Project | null | undefined;
  sceneId: string | null | undefined;
  viewMode: StageViewMode;
  editorViewport: StageEditorViewport | null | undefined;
};

export function getScenePasteTargetCenter({
  project,
  sceneId,
  viewMode,
  editorViewport,
}: GetScenePasteTargetCenterArgs): ScenePasteTargetCenter | null {
  if (!project || !sceneId) {
    return null;
  }

  if (viewMode === 'editor' && editorViewport) {
    return {
      x: editorViewport.centerX,
      y: editorViewport.centerY,
    };
  }

  return {
    x: project.settings.canvasWidth / 2,
    y: project.settings.canvasHeight / 2,
  };
}
