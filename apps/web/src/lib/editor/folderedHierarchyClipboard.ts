export type FolderedHierarchyClipboardKind = 'scene' | 'component';
export type FolderedHierarchyClipboardMode = 'copy' | 'cut';

export type FolderedHierarchyClipboardState<TEntry = unknown> = {
  kind: FolderedHierarchyClipboardKind;
  mode: FolderedHierarchyClipboardMode;
  entries: TEntry[];
};

type FolderedHierarchyClipboardGlobal = typeof globalThis & {
  __pochaFolderedHierarchyClipboard?: FolderedHierarchyClipboardState | null;
};

const folderedHierarchyClipboardGlobal = globalThis as FolderedHierarchyClipboardGlobal;

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function setFolderedHierarchyClipboard<TEntry>(
  value: FolderedHierarchyClipboardState<TEntry> | null,
): void {
  folderedHierarchyClipboardGlobal.__pochaFolderedHierarchyClipboard = value
    ? {
        ...value,
        entries: cloneValue(value.entries),
      }
    : null;
}

export function getFolderedHierarchyClipboard<TEntry>(
  kind: FolderedHierarchyClipboardKind,
): FolderedHierarchyClipboardState<TEntry> | null {
  const clipboard = folderedHierarchyClipboardGlobal.__pochaFolderedHierarchyClipboard;
  if (!clipboard || clipboard.kind !== kind || clipboard.entries.length === 0) {
    return null;
  }

  return {
    kind: clipboard.kind,
    mode: clipboard.mode,
    entries: cloneValue(clipboard.entries) as TEntry[],
  };
}

export function hasFolderedHierarchyClipboardContents(
  kind: FolderedHierarchyClipboardKind,
): boolean {
  return (getFolderedHierarchyClipboard(kind)?.entries.length ?? 0) > 0;
}
