export type AssetCardClipboardKind = 'costume' | 'sound';
export type AssetCardClipboardMode = 'copy' | 'cut';

export type AssetCardClipboardEntry<TItem = unknown> = {
  item: TItem;
};

export type AssetCardClipboardState<TItem = unknown> = {
  kind: AssetCardClipboardKind;
  mode: AssetCardClipboardMode;
  entries: AssetCardClipboardEntry<TItem>[];
};

type AssetCardClipboardGlobal = typeof globalThis & {
  __pochaAssetCardClipboard?: AssetCardClipboardState | null;
};

const assetCardClipboardGlobal = globalThis as AssetCardClipboardGlobal;

function cloneValue<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

export function setAssetCardClipboard<TItem>(
  value: AssetCardClipboardState<TItem> | null,
): void {
  assetCardClipboardGlobal.__pochaAssetCardClipboard = value
    ? {
        ...value,
        entries: cloneValue(value.entries),
      }
    : null;
}

export function getAssetCardClipboard<TItem>(
  kind: AssetCardClipboardKind,
): AssetCardClipboardState<TItem> | null {
  const clipboard = assetCardClipboardGlobal.__pochaAssetCardClipboard;
  if (!clipboard || clipboard.kind !== kind || clipboard.entries.length === 0) {
    return null;
  }

  return {
    kind: clipboard.kind,
    mode: clipboard.mode,
    entries: cloneValue(clipboard.entries) as AssetCardClipboardEntry<TItem>[],
  };
}

export function hasAssetCardClipboardContents(kind: AssetCardClipboardKind): boolean {
  return (getAssetCardClipboard(kind)?.entries.length ?? 0) > 0;
}

export function getAssetCardActionIds(
  orderedIds: readonly string[],
  selectedIds: readonly string[],
  contextId: string | null,
): string[] {
  if (!contextId) {
    return [];
  }

  if (selectedIds.length > 1 && selectedIds.includes(contextId)) {
    const selectedIdSet = new Set(selectedIds);
    return orderedIds.filter((id) => selectedIdSet.has(id));
  }

  return [contextId];
}

export function insertAssetItemsAtIndex<TItem>(
  items: readonly TItem[],
  insertedItems: readonly TItem[],
  targetIndex: number,
): TItem[] {
  const insertIndex = Math.max(0, Math.min(targetIndex, items.length));
  return [
    ...items.slice(0, insertIndex),
    ...insertedItems,
    ...items.slice(insertIndex),
  ];
}
