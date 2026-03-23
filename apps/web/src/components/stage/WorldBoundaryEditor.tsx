import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useProjectStore } from '@/store/projectStore';
import { useEditorStore } from '@/store/editorStore';
import { runInHistoryTransaction } from '@/store/universalHistory';
import type { WorldPoint } from '@/types';

function userToCanvas(point: WorldPoint, canvasWidth: number, canvasHeight: number) {
  return {
    x: point.x + canvasWidth / 2,
    y: canvasHeight / 2 - point.y,
  };
}

function canvasToUser(x: number, y: number, canvasWidth: number, canvasHeight: number): WorldPoint {
  return {
    x: x - canvasWidth / 2,
    y: canvasHeight / 2 - y,
  };
}

export function WorldBoundaryEditor() {
  const { project, updateScene } = useProjectStore();
  const { worldBoundaryEditorSceneId, selectedSceneId, closeWorldBoundaryEditor } = useEditorStore();
  const scene = useMemo(() => {
    const sceneId = worldBoundaryEditorSceneId ?? selectedSceneId;
    if (!project || !sceneId) return null;
    return project.scenes.find((candidate) => candidate.id === sceneId) ?? null;
  }, [project, selectedSceneId, worldBoundaryEditorSceneId]);

  const canvasWidth = project?.settings.canvasWidth ?? 800;
  const canvasHeight = project?.settings.canvasHeight ?? 600;

  const [enabled, setEnabled] = useState(false);
  const [points, setPoints] = useState<WorldPoint[]>([]);
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    if (!scene) return;
    setEnabled(!!scene.worldBoundary?.enabled);
    setPoints((scene.worldBoundary?.points || []).map((point) => ({ ...point })));
  }, [scene]);

  useEffect(() => {
    if (dragIndex === null) return;

    const handlePointerMove = (event: PointerEvent) => {
      const stage = document.getElementById('world-boundary-editor-stage');
      if (!stage) return;
      const rect = stage.getBoundingClientRect();
      const scaleX = canvasWidth / rect.width;
      const scaleY = canvasHeight / rect.height;
      const nextX = Math.max(0, Math.min(canvasWidth, (event.clientX - rect.left) * scaleX));
      const nextY = Math.max(0, Math.min(canvasHeight, (event.clientY - rect.top) * scaleY));
      setPoints((current) => current.map((point, index) => (
        index === dragIndex ? canvasToUser(nextX, nextY, canvasWidth, canvasHeight) : point
      )));
    };

    const handlePointerUp = () => {
      setDragIndex(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [canvasHeight, canvasWidth, dragIndex]);

  if (!scene) {
    return null;
  }

  const polygonPoints = points
    .map((point) => {
      const canvasPoint = userToCanvas(point, canvasWidth, canvasHeight);
      return `${canvasPoint.x},${canvasPoint.y}`;
    })
    .join(' ');

  const handleStageClick = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragIndex !== null) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const scaleX = canvasWidth / rect.width;
    const scaleY = canvasHeight / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    setPoints((current) => [...current, canvasToUser(x, y, canvasWidth, canvasHeight)]);
  };

  const handleSave = () => {
    runInHistoryTransaction('scene:world-boundary', () => {
      updateScene(scene.id, {
        worldBoundary: {
          enabled,
          points,
        },
      });
    });
    closeWorldBoundaryEditor();
  };

  const aspectRatio = `${canvasWidth} / ${canvasHeight}`;

  return (
    <div className="fixed inset-0 z-[100001] bg-background flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b bg-card">
        <div>
          <div className="text-sm font-medium">World Boundary</div>
          <div className="text-xs text-muted-foreground">
            Click to add points. Drag points to move them.
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Checkbox
              id="world-boundary-enabled"
              checked={enabled}
              onCheckedChange={(checked) => setEnabled(!!checked)}
            />
            <Label htmlFor="world-boundary-enabled" className="text-xs text-muted-foreground cursor-pointer">
              Enabled
            </Label>
          </div>
          <Button variant="outline" size="sm" onClick={() => setPoints([])}>
            <Trash2 className="size-4" />
            Clear
          </Button>
          <Button variant="outline" size="sm" onClick={closeWorldBoundaryEditor}>
            <X className="size-4" />
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave}>
            <Check className="size-4" />
            Done
          </Button>
        </div>
      </div>

      <div className="flex-1 p-6 overflow-hidden">
        <div className="h-full rounded-xl border bg-card/60 flex items-center justify-center">
          <div
            id="world-boundary-editor-stage"
            className="relative w-full"
            style={{ aspectRatio, maxWidth: 'min(1200px, 92vw)', maxHeight: '82vh' }}
          >
            <svg
              viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
              className="w-full h-full rounded-lg bg-[#0b1220] cursor-crosshair"
              onPointerDown={handleStageClick}
            >
              <rect x="0" y="0" width={canvasWidth} height={canvasHeight} fill="#111827" />
              <rect
                x="1"
                y="1"
                width={Math.max(0, canvasWidth - 2)}
                height={Math.max(0, canvasHeight - 2)}
                fill="none"
                stroke="rgba(255,255,255,0.25)"
                strokeWidth="2"
              />
              {points.length >= 2 && (
                <polyline
                  points={polygonPoints}
                  fill="none"
                  stroke="#60a5fa"
                  strokeWidth="4"
                  strokeLinejoin="round"
                />
              )}
              {points.length >= 3 && (
                <polygon
                  points={polygonPoints}
                  fill="rgba(96,165,250,0.2)"
                  stroke="#60a5fa"
                  strokeWidth="4"
                  strokeLinejoin="round"
                />
              )}
              {points.map((point, index) => {
                const canvasPoint = userToCanvas(point, canvasWidth, canvasHeight);
                return (
                  <g key={`${index}-${point.x}-${point.y}`}>
                    <circle
                      cx={canvasPoint.x}
                      cy={canvasPoint.y}
                      r="10"
                      fill="#f8fafc"
                      stroke="#2563eb"
                      strokeWidth="4"
                      onPointerDown={(event) => {
                        event.stopPropagation();
                        setDragIndex(index);
                      }}
                      onDoubleClick={(event) => {
                        event.stopPropagation();
                        setPoints((current) => current.filter((_, pointIndex) => pointIndex !== index));
                      }}
                    />
                    <text
                      x={canvasPoint.x}
                      y={canvasPoint.y + 4}
                      textAnchor="middle"
                      fontSize="10"
                      fill="#0f172a"
                      pointerEvents="none"
                    >
                      {index + 1}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}
