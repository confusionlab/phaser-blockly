import type { HierarchyFolder } from '@/types';

export type HierarchyNodeKey = string;

export interface HierarchyDropTarget {
  key: HierarchyNodeKey | null;
  dropPosition: 'before' | 'after' | 'on' | null;
}

export interface FolderedItemShape {
  id: string;
  order?: number;
  folderId?: string | null;
}

export interface HierarchyTreeNode<TItem extends FolderedItemShape> {
  key: HierarchyNodeKey;
  id: string;
  type: 'folder' | 'item';
  parentId: string | null;
  order: number;
  folder?: HierarchyFolder;
  item?: TItem;
  children: HierarchyTreeNode<TItem>[];
}

interface FolderedHierarchyConfig<TItem extends FolderedItemShape> {
  itemKeyPrefix: string;
  setItemFolderId: (item: TItem, folderId: string | null) => TItem;
  setItemOrder: (item: TItem, order: number) => TItem;
}

const ROOT_KEY = '__root__';
const FOLDER_PREFIX = 'folder:';

interface IndexedNode {
  key: HierarchyNodeKey;
  type: 'folder' | 'item';
  id: string;
  parentId: string | null;
  order: number;
}

function parentToGroupKey(parentId: string | null): string {
  return parentId ?? ROOT_KEY;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function sortByOrderThenId<T extends { order: number; id: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.order !== b.order) return a.order - b.order;
    return a.id.localeCompare(b.id);
  });
}

function groupByParent<T extends { parentId: string | null }>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = parentToGroupKey(item.parentId);
    const current = groups.get(key);
    if (current) {
      current.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

function collectFolderAncestors(
  folderId: string,
  folderById: Map<string, HierarchyFolder>,
  seen: Set<string>,
): Set<string> {
  const ancestors = new Set<string>();
  let current: string | null = folderId;
  while (current) {
    const folder = folderById.get(current);
    if (!folder) break;
    const parentId = folder.parentId ?? null;
    if (!parentId) break;
    if (seen.has(parentId)) break;
    seen.add(parentId);
    ancestors.add(parentId);
    current = parentId;
  }
  return ancestors;
}

function normalizeFolderParents(folders: HierarchyFolder[]): HierarchyFolder[] {
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));

  return folders.map((folder) => {
    let parentId = folder.parentId ?? null;
    if (parentId && !folderById.has(parentId)) {
      parentId = null;
    }
    if (!parentId || parentId === folder.id) {
      return { ...folder, parentId: null };
    }

    const seen = new Set<string>([folder.id]);
    const ancestors = collectFolderAncestors(parentId, folderById, seen);
    if (ancestors.has(folder.id)) {
      return { ...folder, parentId: null };
    }

    return { ...folder, parentId };
  });
}

function applySiblingOrdering<TItem extends FolderedItemShape>(
  folders: HierarchyFolder[],
  items: TItem[],
  config: FolderedHierarchyConfig<TItem>,
): { folders: HierarchyFolder[]; items: TItem[] } {
  const folderGroups = groupByParent(folders);
  const itemGroups = groupByParent(
    items.map((item) => ({
      ...item,
      parentId: item.folderId ?? null,
    })),
  );

  const nextFolders = folders.map((folder) => ({ ...folder }));
  const nextItems = items.map((item) => ({ ...item }));

  const folderIndexById = new Map(nextFolders.map((folder, index) => [folder.id, index]));
  const itemIndexById = new Map(nextItems.map((item, index) => [item.id, index]));

  const parentKeys = new Set<string>([
    ...folderGroups.keys(),
    ...itemGroups.keys(),
    ROOT_KEY,
  ]);

  for (const parentKey of parentKeys) {
    const parentId = parentKey === ROOT_KEY ? null : parentKey;
    const siblingFolders = sortByOrderThenId(
      (folderGroups.get(parentKey) ?? []).map((folder) => ({ ...folder })),
    );
    const siblingItems = sortByOrderThenId(
      (itemGroups.get(parentKey) ?? []).map((item) => ({ ...item })),
    );

    const siblingNodes: Array<{ type: 'folder' | 'item'; id: string; order: number }> = [
      ...siblingFolders.map((folder) => ({ type: 'folder' as const, id: folder.id, order: folder.order })),
      ...siblingItems.map((item) => ({ type: 'item' as const, id: item.id, order: item.order ?? 0 })),
    ].sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.id.localeCompare(b.id);
    });

    siblingNodes.forEach((node, index) => {
      if (node.type === 'folder') {
        const folderIndex = folderIndexById.get(node.id);
        if (folderIndex !== undefined) {
          nextFolders[folderIndex] = {
            ...nextFolders[folderIndex],
            parentId,
            order: index,
          };
        }
      } else {
        const itemIndex = itemIndexById.get(node.id);
        if (itemIndex !== undefined) {
          const item = nextItems[itemIndex] as TItem;
          nextItems[itemIndex] = config.setItemOrder(
            config.setItemFolderId(item, parentId),
            index,
          );
        }
      }
    });
  }

  return {
    folders: nextFolders,
    items: nextItems,
  };
}

export function getHierarchyFolderNodeKey(folderId: string): HierarchyNodeKey {
  return `${FOLDER_PREFIX}${folderId}`;
}

export function getHierarchyItemNodeKey(itemKeyPrefix: string, itemId: string): HierarchyNodeKey {
  return `${itemKeyPrefix}:${itemId}`;
}

export function normalizeFolderedHierarchy<TItem extends FolderedItemShape>(
  folders: HierarchyFolder[],
  items: TItem[],
  config: FolderedHierarchyConfig<TItem>,
): { folders: HierarchyFolder[]; items: TItem[] } {
  const coercedFolders = (Array.isArray(folders) ? folders : []).map((folder, index) => ({
    ...folder,
    id: typeof folder.id === 'string' && folder.id.trim() ? folder.id : crypto.randomUUID(),
    parentId: typeof folder.parentId === 'string' && folder.parentId.trim() ? folder.parentId : null,
    order: isFiniteNumber(folder.order) ? folder.order : index,
  }));

  const uniqueFolders: HierarchyFolder[] = [];
  const seenFolderIds = new Set<string>();
  for (const folder of coercedFolders) {
    if (seenFolderIds.has(folder.id)) continue;
    seenFolderIds.add(folder.id);
    uniqueFolders.push(folder);
  }

  const validFolderIds = new Set(uniqueFolders.map((folder) => folder.id));
  const normalizedFolders = normalizeFolderParents(uniqueFolders).map((folder) => ({
    ...folder,
    parentId: folder.parentId && validFolderIds.has(folder.parentId) ? folder.parentId : null,
  }));

  const nextItems = (Array.isArray(items) ? items : []).map((item, index) => {
    const folderId = item.folderId && validFolderIds.has(item.folderId) ? item.folderId : null;
    const ordered = config.setItemOrder(item, isFiniteNumber(item.order) ? item.order : index);
    return config.setItemFolderId(ordered, folderId);
  });

  return applySiblingOrdering(normalizedFolders, nextItems, config);
}

function createIndexedNodes<TItem extends FolderedItemShape>(
  folders: HierarchyFolder[],
  items: TItem[],
  config: FolderedHierarchyConfig<TItem>,
): {
  nodeByKey: Map<HierarchyNodeKey, IndexedNode>;
  siblingsByParent: Map<string, HierarchyNodeKey[]>;
} {
  const normalized = normalizeFolderedHierarchy(folders, items, config);
  const nodes: IndexedNode[] = [
    ...normalized.folders.map((folder) => ({
      key: getHierarchyFolderNodeKey(folder.id),
      type: 'folder' as const,
      id: folder.id,
      parentId: folder.parentId ?? null,
      order: folder.order,
    })),
    ...normalized.items.map((item) => ({
      key: getHierarchyItemNodeKey(config.itemKeyPrefix, item.id),
      type: 'item' as const,
      id: item.id,
      parentId: item.folderId ?? null,
      order: item.order ?? 0,
    })),
  ];

  const nodeByKey = new Map<HierarchyNodeKey, IndexedNode>(nodes.map((node) => [node.key, node]));
  const siblingsByParent = new Map<string, HierarchyNodeKey[]>();

  for (const node of nodes) {
    const parentKey = parentToGroupKey(node.parentId);
    const current = siblingsByParent.get(parentKey);
    if (current) {
      current.push(node.key);
    } else {
      siblingsByParent.set(parentKey, [node.key]);
    }
  }

  for (const [parentKey, keys] of siblingsByParent) {
    keys.sort((a, b) => {
      const nodeA = nodeByKey.get(a);
      const nodeB = nodeByKey.get(b);
      if (!nodeA || !nodeB) return 0;
      if (nodeA.order !== nodeB.order) return nodeA.order - nodeB.order;
      if (nodeA.type !== nodeB.type) return nodeA.type === 'folder' ? -1 : 1;
      return nodeA.id.localeCompare(nodeB.id);
    });
    siblingsByParent.set(parentKey, keys);
  }

  return { nodeByKey, siblingsByParent };
}

function folderAncestors(folderId: string, folderById: Map<string, HierarchyFolder>): Set<string> {
  const ancestors = new Set<string>();
  let current = folderById.get(folderId)?.parentId ?? null;
  while (current) {
    if (ancestors.has(current)) break;
    ancestors.add(current);
    current = folderById.get(current)?.parentId ?? null;
  }
  return ancestors;
}

export function moveFolderedHierarchyNodes<TItem extends FolderedItemShape>(
  folders: HierarchyFolder[],
  items: TItem[],
  movedKeys: HierarchyNodeKey[],
  target: HierarchyDropTarget,
  config: FolderedHierarchyConfig<TItem>,
): { folders: HierarchyFolder[]; items: TItem[] } {
  const normalized = normalizeFolderedHierarchy(folders, items, config);
  const { nodeByKey, siblingsByParent } = createIndexedNodes(normalized.folders, normalized.items, config);
  if (movedKeys.length === 0) return normalized;

  const uniqueMovedKeys = Array.from(new Set(movedKeys)).filter((key) => nodeByKey.has(key));
  if (uniqueMovedKeys.length === 0) return normalized;

  const movedFolderIds = new Set<string>();
  uniqueMovedKeys.forEach((key) => {
    const node = nodeByKey.get(key);
    if (node?.type === 'folder') movedFolderIds.add(node.id);
  });

  const folderById = new Map(normalized.folders.map((folder) => [folder.id, folder]));
  const sanitizedMovedKeys = uniqueMovedKeys.filter((key) => {
    const node = nodeByKey.get(key);
    if (!node) return false;
    if (node.type === 'folder') {
      const ancestors = folderAncestors(node.id, folderById);
      for (const ancestor of ancestors) {
        if (movedFolderIds.has(ancestor)) return false;
      }
      return true;
    }
    let currentParent = node.parentId;
    while (currentParent) {
      if (movedFolderIds.has(currentParent)) return false;
      currentParent = folderById.get(currentParent)?.parentId ?? null;
    }
    return true;
  });

  if (sanitizedMovedKeys.length === 0) return normalized;

  const sanitizedSet = new Set(sanitizedMovedKeys);
  for (const [parentKey, keys] of siblingsByParent) {
    siblingsByParent.set(parentKey, keys.filter((key) => !sanitizedSet.has(key)));
  }

  let destinationParentId: string | null = null;
  let destinationParentKey = ROOT_KEY;
  let destinationIndex = 0;

  const targetNode = target.key ? nodeByKey.get(target.key) : null;
  if (targetNode && target.dropPosition && target.dropPosition !== 'on' && sanitizedSet.has(targetNode.key)) {
    return normalized;
  }

  if (!targetNode || !target.dropPosition) {
    destinationIndex = (siblingsByParent.get(ROOT_KEY) ?? []).length;
  } else if (target.dropPosition === 'on' && targetNode.type === 'folder') {
    destinationParentId = targetNode.id;
    destinationParentKey = parentToGroupKey(destinationParentId);
    destinationIndex = (siblingsByParent.get(destinationParentKey) ?? []).length;
  } else {
    destinationParentId = targetNode.parentId ?? null;
    destinationParentKey = parentToGroupKey(destinationParentId);
    const siblings = siblingsByParent.get(destinationParentKey) ?? [];
    const targetIndex = siblings.indexOf(targetNode.key);
    destinationIndex = targetIndex < 0 ? siblings.length : targetIndex + (target.dropPosition === 'after' ? 1 : 0);
  }

  if (destinationParentId) {
    for (const movedKey of sanitizedMovedKeys) {
      const movedNode = nodeByKey.get(movedKey);
      if (!movedNode || movedNode.type !== 'folder') continue;
      const ancestors = folderAncestors(destinationParentId, folderById);
      if (movedNode.id === destinationParentId || ancestors.has(movedNode.id)) {
        return normalized;
      }
    }
  }

  const destinationSiblings = siblingsByParent.get(destinationParentKey) ?? [];
  const boundedIndex = Math.max(0, Math.min(destinationSiblings.length, destinationIndex));
  const orderedMovedKeys = sanitizedMovedKeys.sort((a, b) => {
    const nodeA = nodeByKey.get(a);
    const nodeB = nodeByKey.get(b);
    if (!nodeA || !nodeB) return 0;
    if (nodeA.parentId === nodeB.parentId && nodeA.order !== nodeB.order) {
      return nodeA.order - nodeB.order;
    }
    const pathA = `${nodeA.parentId ?? ROOT_KEY}:${nodeA.order}`;
    const pathB = `${nodeB.parentId ?? ROOT_KEY}:${nodeB.order}`;
    return pathA.localeCompare(pathB);
  });

  const nextDestination = [...destinationSiblings];
  nextDestination.splice(boundedIndex, 0, ...orderedMovedKeys);
  siblingsByParent.set(destinationParentKey, nextDestination);

  const folderUpdates = new Map<string, { parentId: string | null; order: number }>();
  const itemUpdates = new Map<string, { folderId: string | null; order: number }>();
  for (const [parentKey, keys] of siblingsByParent) {
    const parentId = parentKey === ROOT_KEY ? null : parentKey;
    keys.forEach((key, index) => {
      const node = nodeByKey.get(key);
      if (!node) return;
      if (node.type === 'folder') {
        folderUpdates.set(node.id, { parentId, order: index });
      } else {
        itemUpdates.set(node.id, { folderId: parentId, order: index });
      }
    });
  }

  const nextFolders = normalized.folders.map((folder) => {
    const update = folderUpdates.get(folder.id);
    return update ? { ...folder, ...update } : folder;
  });
  const nextItems = normalized.items.map((item) => {
    const update = itemUpdates.get(item.id);
    if (!update) return item;
    return config.setItemOrder(config.setItemFolderId(item, update.folderId), update.order);
  });

  return applySiblingOrdering(nextFolders, nextItems, config);
}

export function normalizeFolderedHierarchyDropTarget<TItem extends FolderedItemShape>(
  folders: HierarchyFolder[],
  items: TItem[],
  target: HierarchyDropTarget,
  config: FolderedHierarchyConfig<TItem>,
): HierarchyDropTarget {
  const normalized = normalizeFolderedHierarchy(folders, items, config);
  const { nodeByKey, siblingsByParent } = createIndexedNodes(normalized.folders, normalized.items, config);
  const targetNode = target.key ? nodeByKey.get(target.key) : null;

  if (!targetNode || !target.dropPosition) {
    return { key: null, dropPosition: null };
  }

  if (target.dropPosition === 'on') {
    return targetNode.type === 'folder'
      ? { key: targetNode.key, dropPosition: 'on' }
      : { key: targetNode.key, dropPosition: 'after' };
  }

  const parentKey = parentToGroupKey(targetNode.parentId ?? null);
  const siblings = siblingsByParent.get(parentKey) ?? [];
  const targetIndex = siblings.indexOf(targetNode.key);
  if (targetIndex < 0) {
    return { key: null, dropPosition: null };
  }

  const destinationIndex = targetIndex + (target.dropPosition === 'after' ? 1 : 0);
  const nextSiblingKey = siblings[destinationIndex];
  if (nextSiblingKey) {
    return { key: nextSiblingKey, dropPosition: 'before' };
  }

  if (parentKey === ROOT_KEY) {
    return { key: null, dropPosition: null };
  }

  return { key: targetNode.key, dropPosition: 'after' };
}

export function getFolderedHierarchyTree<TItem extends FolderedItemShape>(
  folders: HierarchyFolder[],
  items: TItem[],
  config: FolderedHierarchyConfig<TItem>,
): HierarchyTreeNode<TItem>[] {
  const normalized = normalizeFolderedHierarchy(folders, items, config);
  const folderById = new Map(normalized.folders.map((folder) => [folder.id, folder]));
  const itemById = new Map(normalized.items.map((item) => [item.id, item]));

  const folderGroups = groupByParent(normalized.folders);
  const itemGroups = groupByParent(
    normalized.items.map((item) => ({
      ...item,
      parentId: item.folderId ?? null,
    })),
  );

  const build = (parentId: string | null): HierarchyTreeNode<TItem>[] => {
    const parentKey = parentToGroupKey(parentId);
    const folderNodes = sortByOrderThenId(folderGroups.get(parentKey) ?? []).map((folder) => ({
      key: getHierarchyFolderNodeKey(folder.id),
      id: folder.id,
      type: 'folder' as const,
      parentId: folder.parentId ?? null,
      order: folder.order,
      folder: folderById.get(folder.id),
      children: build(folder.id),
    }));
    const itemNodes = sortByOrderThenId(itemGroups.get(parentKey) ?? []).map((item) => ({
      key: getHierarchyItemNodeKey(config.itemKeyPrefix, item.id),
      id: item.id,
      type: 'item' as const,
      parentId: item.folderId ?? null,
      order: item.order ?? 0,
      item: itemById.get(item.id),
      children: [],
    }));

    return [...folderNodes, ...itemNodes].sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
  };

  return build(null);
}

export function getNextFolderedSiblingOrder<TItem extends FolderedItemShape>(
  folders: HierarchyFolder[],
  items: TItem[],
  parentId: string | null,
  config: FolderedHierarchyConfig<TItem>,
): number {
  const normalized = normalizeFolderedHierarchy(folders, items, config);
  const parentKey = parentToGroupKey(parentId);
  const folderMax = Math.max(
    -1,
    ...normalized.folders
      .filter((folder) => parentToGroupKey(folder.parentId ?? null) === parentKey)
      .map((folder) => folder.order),
  );
  const itemMax = Math.max(
    -1,
    ...normalized.items
      .filter((item) => parentToGroupKey(item.folderId ?? null) === parentKey)
      .map((item) => item.order ?? 0),
  );
  return Math.max(folderMax, itemMax) + 1;
}
