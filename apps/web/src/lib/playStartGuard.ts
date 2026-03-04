import { useEditorStore } from '@/store/editorStore';
import { useProjectStore } from '@/store/projectStore';
import { validateProjectBeforePlay } from '@/lib/playValidation';

export function tryStartPlaying(): boolean {
  const project = useProjectStore.getState().project;
  if (!project) return false;

  const issues = validateProjectBeforePlay(project);
  const editorState = useEditorStore.getState();

  if (issues.length > 0) {
    editorState.setPlayValidationIssues(issues);
    editorState.setShowPlayValidationDialog(true);
    return false;
  }

  editorState.setPlayValidationIssues([]);
  editorState.setShowPlayValidationDialog(false);
  editorState.startPlaying();
  return true;
}
