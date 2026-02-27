import type { GameObject, Project, Scene, SceneFolder } from '@/types';

export type LayerNodeKey = string;
export type LayerNodeType = 'folder' | 'object';

const ROOT_KEY = '__root__';
const FOLDER_PREFIX = 'folder:';
const OBJECT_PREFIX = 'object:';

export interface LayerTreeNode {
  key: LayerNodeKey;
  id: string;
  type: LayerNodeType;
  parentId: string | null;
  order: number;
  folder?: SceneFolder;
  object?: GameObject;
  children: LayerTreeNode[];
}

export function getFolderNodeKey(folderId: string): LayerNodeKey {
  return `${FOLDER_PREFIX}${folderId}`;
}

export function getObjectNodeKey(objectId: string): LayerNodeKey {
  return `${OBJECT_PREFIX}${objectId}`;
}

export function parseLayerNodeKey(key: string): { type: LayerNodeType; id: string } | null {
  if (key.startsWith(FOLDER_PREFIX)) {
    return { type: 'folder', id: key.slice(FOLDER_PREFIX.length) };
  }
  if (key.startsWith(OBJECT_PREFIX)) {
    return { type: 'object', id: key.slice(OBJECT_PREFIX.length) };
  }
  return null;
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

function parentToGroupKey(parentId: string | null): string {
  return parentId ?? ROOT_KEY;
}

function groupByParent<T extends { parentId: string | null }>(items: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = parentToGroupKey(item.parentId);
    const arr = groups.get(key);
    if (arr) {
      arr.push(item);
    } else {
      groups.set(key, [item]);
    }
  }
  return groups;
}

function collectFolderAncestors(
  folderId: string,
  folderById: Map<string, SceneFolder>,
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

function coerceFolder(folder: SceneFolder, fallbackOrder: number): SceneFolder {
  const folderId = typeof folder.id === 'string' && folder.id.trim() ? folder.id : crypto.randomUUID();
  const parentId = typeof folder.parentId === 'string' && folder.parentId.trim()
    ? folder.parentId
    : null;
  const order = isFiniteNumber(folder.order) ? folder.order : fallbackOrder;
  return {
    ...folder,
    id: folderId,
    parentId,
    order,
  };
}

function coerceObject(object: GameObject, fallbackOrder: number): GameObject {
  const legacyFolderId = typeof object.folderId === 'string' && object.folderId.trim()
    ? object.folderId
    : null;
  const parentId = typeof object.parentId === 'string' && object.parentId.trim()
    ? object.parentId
    : legacyFolderId;
  const order = isFiniteNumber(object.order) ? object.order : fallbackOrder;
  return {
    ...object,
    parentId,
    order,
  };
}

function normalizeFolderParents(folders: SceneFolder[]): SceneFolder[] {
  const folderById = new Map(folders.map((folder) => [folder.id, folder]));

  const nextFolders = folders.map((folder) => {
    let parentId = folder.parentId ?? null;
    if (parentId && !folderById.has(parentId)) {
      parentId = null;
    }
    if (!parentId) {
      return { ...folder, parentId: null };
    }
    if (parentId === folder.id) {
      return { ...folder, parentId: null };
    }

    const seen = new Set<string>([folder.id]);
    const ancestors = collectFolderAncestors(parentId, folderById, seen);
    if (ancestors.has(folder.id)) {
      return { ...folder, parentId: null };
    }
    return { ...folder, parentId };
  });

  return nextFolders;
}

function applySiblingOrdering(scene: Scene): Scene {
  const folderGroups = groupByParent(scene.objectFolders);
  const objectGroups = groupByParent(scene.objects);

  const nextFolders = scene.objectFolders.map((folder) => ({ ...folder }));
  const nextObjects = scene.objects.map((obj) => ({ ...obj }));

  const folderIndexById = new Map(nextFolders.map((folder, index) => [folder.id, index]));
  const objectIndexById = new Map(nextObjects.map((obj, index) => [obj.id, index]));

  const parentKeys = new Set<string>([
    ...folderGroups.keys(),
    ...objectGroups.keys(),
    ROOT_KEY,
  ]);

  for (const parentKey of parentKeys) {
    const parentId = parentKey === ROOT_KEY ? null : parentKey;
    const siblingFolders = sortByOrderThenId(
      (folderGroups.get(parentKey) ?? []).map((folder) => ({ ...folder })),
    );
    const siblingObjects = sortByOrderThenId(
      (objectGroups.get(parentKey) ?? []).map((obj) => ({ ...obj })),
    );

    const siblingNodes: Array<{
      type: LayerNodeType;
      id: string;
      order: number;
    }> = [
      ...siblingFolders.map((folder) => ({
        type: 'folder' as const,
        id: folder.id,
        order: folder.order,
      })),
      ...siblingObjects.map((obj) => ({
        type: 'object' as const,
        id: obj.id,
        order: obj.order,
      })),
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
        const objectIndex = objectIndexById.get(node.id);
        if (objectIndex !== undefined) {
          nextObjects[objectIndex] = {
            ...nextObjects[objectIndex],
            parentId,
            order: index,
          };
        }
      }
    });
  }

  return {
    ...scene,
    objectFolders: nextFolders,
    objects: nextObjects,
  };
}

function normalizeLegacyRootOrdering(scene: Scene): Scene {
  const folderById = new Map(scene.objectFolders.map((folder) => [folder.id, folder]));
  const firstObjectIndexByFolder = new Map<string, number>();

  scene.objects.forEach((obj, index) => {
    const parentId = obj.parentId ?? null;
    if (parentId && folderById.has(parentId) && !firstObjectIndexByFolder.has(parentId)) {
      firstObjectIndexByFolder.set(parentId, index);
    }
  });

  const rootNodes: Array<{ type: LayerNodeType; id: string; order: number }> = [];
  const emittedFolders = new Set<string>();
  scene.objects.forEach((obj, index) => {
    const parentId = obj.parentId ?? null;
    if (parentId && folderById.has(parentId)) {
      if (!emittedFolders.has(parentId)) {
        emittedFolders.add(parentId);
        rootNodes.push({ type: 'folder', id: parentId, order: index });
      }
      return;
    }
    rootNodes.push({ type: 'object', id: obj.id, order: index });
  });

  scene.objectFolders.forEach((folder, index) => {
    if (folder.parentId) return;
    if (emittedFolders.has(folder.id)) return;
    const fallback = scene.objects.length + index;
    const order = firstObjectIndexByFolder.get(folder.id) ?? fallback;
    rootNodes.push({ type: 'folder', id: folder.id, order });
  });

  const nextFolders = scene.objectFolders.map((folder) => ({
    ...folder,
    parentId: folder.parentId ?? null,
    order: folder.order,
  }));
  const nextObjects = scene.objects.map((obj) => ({
    ...obj,
    parentId: obj.parentId ?? null,
    order: obj.order,
  }));

  const folderIndexById = new Map(nextFolders.map((folder, index) => [folder.id, index]));
  const objectIndexById = new Map(nextObjects.map((obj, index) => [obj.id, index]));

  rootNodes
    .sort((a, b) => a.order - b.order)
    .forEach((node, index) => {
      if (node.type === 'folder') {
        const folderIndex = folderIndexById.get(node.id);
        if (folderIndex !== undefined) {
          nextFolders[folderIndex] = {
            ...nextFolders[folderIndex],
            parentId: null,
            order: index,
          };
        }
      } else {
        const objectIndex = objectIndexById.get(node.id);
        if (objectIndex !== undefined) {
          nextObjects[objectIndex] = {
            ...nextObjects[objectIndex],
            parentId: null,
            order: index,
          };
        }
      }
    });

  return {
    ...scene,
    objectFolders: nextFolders,
    objects: nextObjects,
  };
}

export function normalizeSceneLayering(scene: Scene): Scene {
  const rawFolders = Array.isArray(scene.objectFolders) ? scene.objectFolders : [];
  const rawObjects = Array.isArray(scene.objects) ? scene.objects : [];

  const coercedFolders = rawFolders.map((folder, index) => coerceFolder(folder, index));
  const uniqueFolders: SceneFolder[] = [];
  const seenFolderIds = new Set<string>();
  for (const folder of coercedFolders) {
    if (seenFolderIds.has(folder.id)) continue;
    seenFolderIds.add(folder.id);
    uniqueFolders.push(folder);
  }

  const coercedObjects = rawObjects.map((obj, index) => coerceObject(obj, index));
  const validFolderIds = new Set(uniqueFolders.map((folder) => folder.id));
  const objectsWithValidParents = coercedObjects.map((obj) => {
    const parentId = obj.parentId && validFolderIds.has(obj.parentId) ? obj.parentId : null;
    return {
      ...obj,
      parentId,
      folderId: undefined,
    };
  });

  const foldersWithValidParents = normalizeFolderParents(uniqueFolders).map((folder) => {
    const parentId = folder.parentId && validFolderIds.has(folder.parentId) ? folder.parentId : null;
    return {
      ...folder,
      parentId,
    };
  });

  const hasLegacyFolderOnly = rawObjects.some(
    (obj) => !isFiniteNumber(obj.order) && (obj.folderId ?? null) !== null && (obj.parentId ?? null) === null,
  );

  const baseScene: Scene = {
    ...scene,
    objectFolders: foldersWithValidParents,
    objects: objectsWithValidParents,
  };

  const legacyAdjustedScene = hasLegacyFolderOnly
    ? normalizeLegacyRootOrdering(baseScene)
    : baseScene;

  return applySiblingOrdering(legacyAdjustedScene);
}

export function normalizeProjectLayering(project: Project): Project {
  return {
    ...project,
    scenes: project.scenes.map((scene) => normalizeSceneLayering(scene)),
  };
}

interface IndexedLayerNode {
  key: LayerNodeKey;
  type: LayerNodeType;
  id: string;
  parentId: string | null;
  order: number;
}

function createIndexedNodes(scene: Scene): {
  nodeByKey: Map<LayerNodeKey, IndexedLayerNode>;
  siblingsByParent: Map<string, LayerNodeKey[]>;
} {
  const normalizedScene = normalizeSceneLayering(scene);
  const nodes: IndexedLayerNode[] = [
    ...normalizedScene.objectFolders.map((folder) => ({
      key: getFolderNodeKey(folder.id),
      type: 'folder' as const,
      id: folder.id,
      parentId: folder.parentId ?? null,
      order: folder.order,
    })),
    ...normalizedScene.objects.map((obj) => ({
      key: getObjectNodeKey(obj.id),
      type: 'object' as const,
      id: obj.id,
      parentId: obj.parentId ?? null,
      order: obj.order,
    })),
  ];

  const nodeByKey = new Map<LayerNodeKey, IndexedLayerNode>(nodes.map((node) => [node.key, node]));
  const siblingsByParent = new Map<string, LayerNodeKey[]>();

  for (const node of nodes) {
    const parentKey = parentToGroupKey(node.parentId);
    const siblings = siblingsByParent.get(parentKey);
    if (siblings) {
      siblings.push(node.key);
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

function folderAncestors(folderId: string, folderById: Map<string, SceneFolder>): Set<string> {
  const ancestors = new Set<string>();
  let current = folderById.get(folderId)?.parentId ?? null;
  while (current) {
    if (ancestors.has(current)) break;
    ancestors.add(current);
    current = folderById.get(current)?.parentId ?? null;
  }
  return ancestors;
}

export function moveSceneLayerNodes(
  scene: Scene,
  movedKeys: LayerNodeKey[],
  target: { key: LayerNodeKey | null; dropPosition: 'before' | 'after' | 'on' | null },
): Scene {
  const normalizedScene = normalizeSceneLayering(scene);
  const { nodeByKey, siblingsByParent } = createIndexedNodes(normalizedScene);
  if (movedKeys.length === 0) return normalizedScene;

  const uniqueMovedKeys = Array.from(new Set(movedKeys)).filter((key) => nodeByKey.has(key));
  if (uniqueMovedKeys.length === 0) return normalizedScene;
  const movedFolderIds = new Set<string>();
  uniqueMovedKeys.forEach((key) => {
    const node = nodeByKey.get(key);
    if (node?.type === 'folder') movedFolderIds.add(node.id);
  });

  const folderById = new Map(normalizedScene.objectFolders.map((folder) => [folder.id, folder]));
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

  if (sanitizedMovedKeys.length === 0) return normalizedScene;

  const sanitizedSet = new Set(sanitizedMovedKeys);
  for (const [parentKey, keys] of siblingsByParent) {
    siblingsByParent.set(
      parentKey,
      keys.filter((key) => !sanitizedSet.has(key)),
    );
  }

  let destinationParentId: string | null = null;
  let destinationParentKey = ROOT_KEY;
  let destinationIndex = 0;

  const targetNode = target.key ? nodeByKey.get(target.key) : null;

  if (!targetNode || !target.dropPosition) {
    const rootSiblings = siblingsByParent.get(ROOT_KEY) ?? [];
    destinationIndex = rootSiblings.length;
  } else if (target.dropPosition === 'on' && targetNode.type === 'folder') {
    destinationParentId = targetNode.id;
    destinationParentKey = parentToGroupKey(destinationParentId);
    destinationIndex = (siblingsByParent.get(destinationParentKey) ?? []).length;
  } else {
    destinationParentId = targetNode.parentId ?? null;
    destinationParentKey = parentToGroupKey(destinationParentId);
    const siblings = siblingsByParent.get(destinationParentKey) ?? [];
    const targetIndex = siblings.indexOf(targetNode.key);
    destinationIndex = targetIndex < 0
      ? siblings.length
      : targetIndex + (target.dropPosition === 'after' ? 1 : 0);
  }

  if (destinationParentId) {
    for (const movedKey of sanitizedMovedKeys) {
      const movedNode = nodeByKey.get(movedKey);
      if (!movedNode || movedNode.type !== 'folder') continue;
      const ancestors = folderAncestors(destinationParentId, folderById);
      if (movedNode.id === destinationParentId || ancestors.has(movedNode.id)) {
        return normalizedScene;
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
  const objectUpdates = new Map<string, { parentId: string | null; order: number }>();

  for (const [parentKey, keys] of siblingsByParent) {
    const parentId = parentKey === ROOT_KEY ? null : parentKey;
    keys.forEach((key, index) => {
      const node = nodeByKey.get(key);
      if (!node) return;
      if (node.type === 'folder') {
        folderUpdates.set(node.id, { parentId, order: index });
      } else {
        objectUpdates.set(node.id, { parentId, order: index });
      }
    });
  }

  const nextScene: Scene = {
    ...normalizedScene,
    objectFolders: normalizedScene.objectFolders.map((folder) => {
      const update = folderUpdates.get(folder.id);
      return update ? { ...folder, ...update } : folder;
    }),
    objects: normalizedScene.objects.map((obj) => {
      const update = objectUpdates.get(obj.id);
      return update ? { ...obj, ...update } : obj;
    }),
  };

  return applySiblingOrdering(nextScene);
}

export function getSceneTree(scene: Scene): LayerTreeNode[] {
  const normalized = normalizeSceneLayering(scene);
  const folderById = new Map(normalized.objectFolders.map((folder) => [folder.id, folder]));
  const objectById = new Map(normalized.objects.map((obj) => [obj.id, obj]));

  const folderGroups = groupByParent(normalized.objectFolders);
  const objectGroups = groupByParent(normalized.objects);

  const build = (parentId: string | null): LayerTreeNode[] => {
    const parentKey = parentToGroupKey(parentId);
    const folderNodes = sortByOrderThenId(folderGroups.get(parentKey) ?? []).map((folder) => ({
      key: getFolderNodeKey(folder.id),
      id: folder.id,
      type: 'folder' as const,
      parentId: folder.parentId ?? null,
      order: folder.order,
      folder: folderById.get(folder.id),
      children: build(folder.id),
    }));
    const objectNodes = sortByOrderThenId(objectGroups.get(parentKey) ?? []).map((obj) => ({
      key: getObjectNodeKey(obj.id),
      id: obj.id,
      type: 'object' as const,
      parentId: obj.parentId ?? null,
      order: obj.order,
      object: objectById.get(obj.id),
      children: [],
    }));

    return [...folderNodes, ...objectNodes].sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.id.localeCompare(b.id);
    });
  };

  return build(null);
}

export function getSceneObjectsInLayerOrder(scene: Scene): GameObject[] {
  const tree = getSceneTree(scene);
  const ordered: GameObject[] = [];

  const walk = (nodes: LayerTreeNode[]) => {
    for (const node of nodes) {
      if (node.type === 'object' && node.object) {
        ordered.push(node.object);
      } else if (node.type === 'folder') {
        walk(node.children);
      }
    }
  };

  walk(tree);
  return ordered;
}

export function getNextSiblingOrder(scene: Scene, parentId: string | null): number {
  const normalized = normalizeSceneLayering(scene);
  const parentKey = parentToGroupKey(parentId);
  const folderMax = Math.max(
    -1,
    ...normalized.objectFolders
      .filter((folder) => parentToGroupKey(folder.parentId ?? null) === parentKey)
      .map((folder) => folder.order),
  );
  const objectMax = Math.max(
    -1,
    ...normalized.objects
      .filter((obj) => parentToGroupKey(obj.parentId ?? null) === parentKey)
      .map((obj) => obj.order),
  );
  return Math.max(folderMax, objectMax) + 1;
}
