import type { CostumeEditorMode } from '@/types';
import type { DrawingTool } from './CostumeToolbar';

const UNIVERSAL_COSTUME_TOOL_SHORTCUTS: Record<string, DrawingTool> = {
  v: 'select',
  r: 'rectangle',
  c: 'circle',
  g: 'triangle',
  s: 'star',
  l: 'line',
};

const VECTOR_COSTUME_TOOL_SHORTCUTS: Record<string, DrawingTool> = {
  p: 'pen',
  b: 'brush',
  t: 'text',
};

const BITMAP_COSTUME_TOOL_SHORTCUTS: Record<string, DrawingTool> = {
  b: 'brush',
  e: 'eraser',
  f: 'fill',
};

export function resolveCostumeToolShortcut(
  key: string,
  editorMode: CostumeEditorMode,
): DrawingTool | null {
  const normalizedKey = key.trim().toLowerCase();
  if (!normalizedKey) {
    return null;
  }

  const universalTool = UNIVERSAL_COSTUME_TOOL_SHORTCUTS[normalizedKey];
  if (universalTool) {
    return universalTool;
  }

  if (editorMode === 'vector') {
    return VECTOR_COSTUME_TOOL_SHORTCUTS[normalizedKey] ?? null;
  }

  return BITMAP_COSTUME_TOOL_SHORTCUTS[normalizedKey] ?? null;
}
