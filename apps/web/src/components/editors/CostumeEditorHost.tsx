import { useEffect, useState } from 'react';
import { useCostumeEditorProvider } from '@/lib/appVariant';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { getEffectiveObjectProps } from '@/types';
import { CostumeEditor } from './CostumeEditor';
import { TriangleAlert } from '@/components/ui/icons';

type ScratchPaintEditorComponent = typeof import('./scratch/ScratchPaintCostumeEditor').ScratchPaintCostumeEditor;

function ScratchPaintCostumeEditorLoader() {
  const [ScratchPaintCostumeEditor, setScratchPaintCostumeEditor] = useState<ScratchPaintEditorComponent | null>(null);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import('./scratch/ScratchPaintCostumeEditor').then((module) => {
      if (!cancelled) {
        setScratchPaintCostumeEditor(() => module.ScratchPaintCostumeEditor);
      }
    }).catch((error) => {
      console.error('Failed to load Scratch Paint costume editor.', error);
      if (!cancelled) {
        setLoadError(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (ScratchPaintCostumeEditor) {
    return <ScratchPaintCostumeEditor />;
  }

  if (loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-card p-6 text-center text-sm text-muted-foreground">
        <TriangleAlert className="size-8 text-destructive" />
        <p>Scratch Paint could not be loaded.</p>
      </div>
    );
  }

  return <div className="flex-1 bg-card" />;
}

export function CostumeEditorHost() {
  const defaultProvider = useCostumeEditorProvider();
  const { project } = useProjectStore();
  const {
    selectedSceneId,
    selectedObjectId,
    selectedComponentId,
  } = useEditorStore();
  const scene = project?.scenes.find((candidate) => candidate.id === selectedSceneId);
  const object = scene?.objects.find((candidate) => candidate.id === selectedObjectId);
  const component = (project?.components || []).find((candidate) => candidate.id === selectedComponentId);
  const effectiveProps = object && project ? getEffectiveObjectProps(object, project.components || []) : null;
  const costumes = component?.costumes ?? effectiveProps?.costumes ?? [];
  const currentCostumeIndex = component?.currentCostumeIndex ?? effectiveProps?.currentCostumeIndex ?? 0;
  const currentCostume = costumes[currentCostumeIndex] ?? costumes[0] ?? null;
  const provider = currentCostume?.kind === 'static' && currentCostume.editorSource?.engine === 'scratch-paint'
    ? 'scratch'
    : defaultProvider;

  if (provider !== 'scratch') {
    return <CostumeEditor />;
  }

  return <ScratchPaintCostumeEditorLoader />;
}
