export const VECTOR_CLIPBOARD_KIND = 'vector-object-selection';
export const VECTOR_CLIPBOARD_VERSION = 1;

export type VectorClipboardEntry<TObject = unknown> = {
  object: TObject;
};

export type VectorClipboardState<TObject = unknown> = {
  kind: typeof VECTOR_CLIPBOARD_KIND;
  version: typeof VECTOR_CLIPBOARD_VERSION;
  pasteCount: number;
  entries: VectorClipboardEntry<TObject>[];
};

type VectorClipboardGlobal = typeof globalThis & {
  __pochaVectorClipboard?: VectorClipboardState | null;
};

const vectorClipboardGlobal = globalThis as VectorClipboardGlobal;

export function setVectorClipboard<TObject>(
  value: Omit<VectorClipboardState<TObject>, 'kind' | 'version' | 'pasteCount'> | null,
): void {
  vectorClipboardGlobal.__pochaVectorClipboard = value
    ? {
        kind: VECTOR_CLIPBOARD_KIND,
        version: VECTOR_CLIPBOARD_VERSION,
        pasteCount: 0,
        entries: [...value.entries],
      }
    : null;
}

export function getVectorClipboard<TObject>(): VectorClipboardState<TObject> | null {
  const clipboard = vectorClipboardGlobal.__pochaVectorClipboard;
  if (!clipboard || clipboard.kind !== VECTOR_CLIPBOARD_KIND || clipboard.version !== VECTOR_CLIPBOARD_VERSION) {
    return null;
  }
  if (clipboard.entries.length === 0) {
    return null;
  }

  return {
    kind: clipboard.kind,
    version: clipboard.version,
    pasteCount: clipboard.pasteCount,
    entries: [...clipboard.entries] as VectorClipboardEntry<TObject>[],
  };
}

export function hasVectorClipboardContents(): boolean {
  return (getVectorClipboard()?.entries.length ?? 0) > 0;
}

export function markVectorClipboardPaste(): void {
  const clipboard = vectorClipboardGlobal.__pochaVectorClipboard;
  if (!clipboard || clipboard.kind !== VECTOR_CLIPBOARD_KIND || clipboard.version !== VECTOR_CLIPBOARD_VERSION) {
    return;
  }

  clipboard.pasteCount += 1;
}
