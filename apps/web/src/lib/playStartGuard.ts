import { useEditorStore } from '@/store/editorStore';
import { useProjectStore } from '@/store/projectStore';
import { validateProjectBeforePlay } from '@/lib/playValidation';

export async function tryStartPlaying(): Promise<boolean> {
  const editorState = useEditorStore.getState();

  try {
    await editorState.prepareForPlay();
  } catch (error) {
    console.error('Failed to prepare editor state before playing.', error);
    return false;
  }

  const project = useProjectStore.getState().project;
  if (!project) return false;

  const issues = validateProjectBeforePlay(project);

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
