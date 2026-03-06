import { validateProjectBeforePlay } from '@/lib/playValidation';
import type { ProjectOp, Scalar } from '@/lib/llm/types';
import {
  createDefaultScene,
  createDefaultGameObject,
  createDefaultColliderConfig,
  createDefaultPhysicsConfig,
  getEffectiveObjectProps,
  type ColliderConfig,
  type Costume,
  type GameObject,
  type Project,
  type Scene,
  type SceneFolder,
} from '@/types';
import { calculateVisibleBounds } from '@/utils/imageBounds';
import { processImageFromDataUrl } from '@/utils/imageProcessor';
import { getFolderNodeKey, getNextSiblingOrder, getObjectNodeKey, moveSceneLayerNodes } from '@/utils/layerTree';

type ProjectOpsBindings = {
  getProject: () => Project | null;
  updateProjectName: (name: string) => void;
  addScene: (name: string) => void;
  reorderScenes: (sceneIds: string[]) => void;
  updateScene: (sceneId: string, updates: Partial<Scene>) => void;
  addObject: (sceneId: string, name: string) => GameObject;
  updateObject: (sceneId: string, objectId: string, updates: Partial<GameObject>) => void;
};

export type ProjectOpsApplyResult = {
  applied: boolean;
  changed: boolean;
  appliedOpCount: number;
  summaryLines: string[];
  errors: string[];
  validationIssueCount: number;
  validationIssueSample: string[];
};

export type ProjectOpsPreviewResult = ProjectOpsApplyResult & {
  pass: boolean;
  project: Project;
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

function toFiniteNumber(value: Scalar): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toBoolean(value: Scalar): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const normalized = normalize(String(value));
  if (normalized === 'true' || normalized === 'yes' || normalized === '1') return true;
  if (normalized === 'false' || normalized === 'no' || normalized === '0') return false;
  return null;
}

function resolveByIdOrName<T extends { id: string; name?: string }>(
  items: T[],
  ref: string,
  kind: string,
): { item: T | null; error?: string } {
  const trimmed = ref.trim();
  if (!trimmed) return { item: null, error: `${kind} reference is empty.` };

  const byId = items.find((item) => item.id === trimmed);
  if (byId) return { item: byId };

  const normalizedRef = normalize(trimmed);
  const byName = items.filter((item) => normalize(item.name || '') === normalizedRef);
  if (byName.length === 1) return { item: byName[0] };
  if (byName.length > 1) {
    return { item: null, error: `${kind} reference "${ref}" is ambiguous.` };
  }

  return { item: null, error: `${kind} "${ref}" was not found.` };
}

function resolveScene(project: Project, ref: string): { scene: Scene | null; error?: string } {
  const resolved = resolveByIdOrName(project.scenes, ref, 'Scene');
  return { scene: resolved.item, error: resolved.error };
}

function resolveObject(scene: Scene, ref: string): { object: GameObject | null; error?: string } {
  const resolved = resolveByIdOrName(scene.objects, ref, 'Object');
  return { object: resolved.item, error: resolved.error };
}

function resolveFolder(scene: Scene, ref: string): { folder: SceneFolder | null; error?: string } {
  const resolved = resolveByIdOrName(scene.objectFolders || [], ref, 'Folder');
  return { folder: resolved.item, error: resolved.error };
}

function resolveCostume(
  costumes: Costume[],
  ref: string,
): { costume: Costume | null; error?: string } {
  const resolved = resolveByIdOrName(costumes, ref, 'Costume');
  return { costume: resolved.item, error: resolved.error };
}

function summarizeProjectOp(op: ProjectOp): string {
  switch (op.op) {
    case 'rename_project':
      return `Rename project to "${op.name}"`;
    case 'create_scene':
      return `Create scene "${op.name}"`;
    case 'rename_scene':
      return `Rename scene "${op.sceneId}" to "${op.name}"`;
    case 'reorder_scenes':
      return `Reorder scenes (${op.sceneIds.length} reference(s))`;
    case 'create_object':
      return `Create object "${op.name}" in scene "${op.sceneId}"`;
    case 'rename_object':
      return `Rename object "${op.objectId}" to "${op.name}"`;
    case 'set_object_property':
      return `Set ${op.objectId}.${op.property}`;
    case 'set_object_physics':
      return `Update physics for "${op.objectId}"`;
    case 'set_object_collider_type':
      return `Set collider type for "${op.objectId}" to "${op.colliderType}"`;
    case 'create_folder':
      return `Create folder "${op.name}"`;
    case 'rename_folder':
      return `Rename folder "${op.folderId}" to "${op.name}"`;
    case 'move_object_to_folder':
      return `Move object "${op.objectId}" to ${op.folderId ? `folder "${op.folderId}"` : 'root'}`;
    case 'add_costume_from_image_url':
      return `Import image costume "${op.name}"`;
    case 'add_costume_text_circle':
      return `Add text-circle costume "${op.name}"`;
    case 'rename_costume':
      return `Rename costume "${op.costumeId}" to "${op.name}"`;
    case 'reorder_costumes':
      return `Reorder costumes (${op.costumeIds.length} reference(s))`;
    case 'set_current_costume':
      return `Set current costume to "${op.costumeId}"`;
    case 'validate_project':
      return 'Run project validation';
    default:
      return `Apply ${String((op as { op: string }).op)}`;
  }
}

export function summarizeProjectOps(projectOps: ProjectOp[]): string[] {
  if (projectOps.length === 0) return [];
  return projectOps.map((op, index) => `${index + 1}. ${summarizeProjectOp(op)}`);
}

function escapeXmlText(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (!/^[a-zA-Z0-9#(),.%\s-]+$/.test(trimmed)) return fallback;
  return trimmed;
}

function toBase64Unicode(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function splitTextLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current.length > 0 ? `${current} ${word}` : word;
    if (candidate.length <= maxCharsPerLine) {
      current = candidate;
      continue;
    }
    if (current.length > 0) {
      lines.push(current);
      current = word;
    } else {
      lines.push(word.slice(0, maxCharsPerLine));
      current = word.slice(maxCharsPerLine);
    }
    if (lines.length >= maxLines - 1) break;
  }
  if (current.length > 0 && lines.length < maxLines) {
    lines.push(current);
  }
  if (lines.length === 0) {
    lines.push(words.join(' ').slice(0, maxCharsPerLine));
  }
  return lines.slice(0, maxLines);
}

function createTextCircleCostumeAsset(args: {
  text: string;
  fillColor?: string;
  textColor?: string;
}): { assetId: string; bounds: Costume['bounds'] } {
  const fillColor = sanitizeColor(args.fillColor, '#dbeafe');
  const textColor = sanitizeColor(args.textColor, '#111827');
  const lines = splitTextLines(args.text, 12, 4).map(escapeXmlText);

  const width = 512;
  const height = 512;
  const cx = width / 2;
  const cy = height / 2;
  const radius = 220;
  const lineHeight = 42;
  const firstY = cy - ((lines.length - 1) * lineHeight) / 2;

  const textTspans = lines
    .map((line, index) => `<tspan x="${cx}" y="${firstY + index * lineHeight}">${line}</tspan>`)
    .join('');

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `  <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${fillColor}" stroke="#1f2937" stroke-width="8" />`,
    `  <text text-anchor="middle" dominant-baseline="middle" font-family="Arial, sans-serif" font-size="36" font-weight="600" fill="${textColor}">${textTspans}</text>`,
    '</svg>',
  ].join('\n');

  return {
    assetId: `data:image/svg+xml;base64,${toBase64Unicode(svg)}`,
    bounds: {
      x: cx - radius,
      y: cy - radius,
      width: radius * 2,
      height: radius * 2,
    },
  };
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      if (!result) {
        reject(new Error('Failed to read image response.'));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(new Error('Failed to read image data.'));
    reader.readAsDataURL(blob);
  });
}

async function importImageCostumeAsset(imageUrl: string): Promise<{ assetId: string; bounds: Costume['bounds'] }> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Image fetch failed (${response.status}).`);
  }
  const blob = await response.blob();
  if (!blob.type.startsWith('image/')) {
    throw new Error('Fetched resource is not an image.');
  }
  const dataUrl = await blobToDataUrl(blob);
  const processedAsset = await processImageFromDataUrl(dataUrl);
  const bounds = (await calculateVisibleBounds(processedAsset)) || undefined;
  return {
    assetId: processedAsset,
    bounds,
  };
}

function setObjectCostumes(
  bindings: ProjectOpsBindings,
  sceneId: string,
  objectId: string,
  costumes: Costume[],
  currentCostumeIndex: number,
): void {
  bindings.updateObject(sceneId, objectId, {
    costumes,
    currentCostumeIndex,
  });
}

export async function applyProjectOps(args: {
  projectOps: ProjectOp[];
  bindings: ProjectOpsBindings;
}): Promise<ProjectOpsApplyResult> {
  const errors: string[] = [];
  const summaryLines: string[] = [];
  let appliedOpCount = 0;
  let changed = false;
  let validationIssueCount = 0;
  let validationIssueSample: string[] = [];

  for (let index = 0; index < args.projectOps.length; index += 1) {
    const op = args.projectOps[index];
    const opLabel = `projectOps[${index}](${op.op})`;
    const currentProject = args.bindings.getProject();
    if (!currentProject) {
      errors.push(`${opLabel}: no project is open.`);
      break;
    }

    try {
      switch (op.op) {
        case 'rename_project': {
          args.bindings.updateProjectName(op.name);
          changed = true;
          appliedOpCount += 1;
          summaryLines.push(`Renamed project to "${op.name}".`);
          break;
        }
        case 'create_scene': {
          args.bindings.addScene(op.name);
          changed = true;
          appliedOpCount += 1;
          summaryLines.push(`Created scene "${op.name}".`);
          break;
        }
        case 'rename_scene': {
          const sceneResolved = resolveScene(currentProject, op.sceneId);
          if (!sceneResolved.scene) {
            errors.push(`${opLabel}: ${sceneResolved.error}`);
            break;
          }
          args.bindings.updateScene(sceneResolved.scene.id, { name: op.name });
          changed = true;
          appliedOpCount += 1;
          summaryLines.push(`Renamed scene "${sceneResolved.scene.name}" to "${op.name}".`);
          break;
        }
        case 'reorder_scenes': {
          const orderedSceneIds: string[] = [];
          for (const sceneRef of op.sceneIds) {
            const sceneResolved = resolveScene(currentProject, sceneRef);
            if (!sceneResolved.scene) {
              errors.push(`${opLabel}: ${sceneResolved.error}`);
              continue;
            }
            orderedSceneIds.push(sceneResolved.scene.id);
          }
          const uniqueRequested = dedupe(orderedSceneIds);
          if (uniqueRequested.length === 0) {
            errors.push(`${opLabel}: no valid scene references were provided.`);
            break;
          }
          const remainingIds = currentProject.scenes
            .map((scene) => scene.id)
            .filter((sceneId) => !uniqueRequested.includes(sceneId));
          args.bindings.reorderScenes([...uniqueRequested, ...remainingIds]);
          changed = true;
          appliedOpCount += 1;
          summaryLines.push(`Reordered scenes (${uniqueRequested.length} reference(s)).`);
          break;
        }
        case 'create_object': {
          const sceneResolved = resolveScene(currentProject, op.sceneId);
          if (!sceneResolved.scene) {
            errors.push(`${opLabel}: ${sceneResolved.error}`);
            break;
          }
          const created = args.bindings.addObject(sceneResolved.scene.id, op.name);
          if (typeof op.x === 'number' || typeof op.y === 'number') {
            args.bindings.updateObject(sceneResolved.scene.id, created.id, {
              ...(typeof op.x === 'number' ? { x: op.x } : {}),
              ...(typeof op.y === 'number' ? { y: op.y } : {}),
            });
          }
          changed = true;
          appliedOpCount += 1;
          summaryLines.push(`Created object "${op.name}" in "${sceneResolved.scene.name}".`);
          break;
        }
        case 'rename_object': {
          const sceneResolved = resolveScene(currentProject, op.sceneId);
          if (!sceneResolved.scene) {
            errors.push(`${opLabel}: ${sceneResolved.error}`);
            break;
          }
          const objectResolved = resolveObject(sceneResolved.scene, op.objectId);
          if (!objectResolved.object) {
            errors.push(`${opLabel}: ${objectResolved.error}`);
            break;
          }
          args.bindings.updateObject(sceneResolved.scene.id, objectResolved.object.id, { name: op.name });
          changed = true;
          appliedOpCount += 1;
          summaryLines.push(`Renamed object "${objectResolved.object.name}" to "${op.name}".`);
          break;
        }
        case 'set_object_property': {
          const sceneResolved = resolveScene(currentProject, op.sceneId);
          if (!sceneResolved.scene) {
            errors.push(`${opLabel}: ${sceneResolved.error}`);
            break;
          }
          const objectResolved = resolveObject(sceneResolved.scene, op.objectId);
          if (!objectResolved.object) {
            errors.push(`${opLabel}: ${objectResolved.error}`);
            break;
          }

          if (op.property === 'visible') {
            const boolValue = toBoolean(op.value);
            if (boolValue === null) {
              errors.push(`${opLabel}: property "${op.property}" requires boolean value.`);
              break;
            }
            args.bindings.updateObject(sceneResolved.scene.id, objectResolved.object.id, { visible: boolValue });
          } else {
            const numericValue = toFiniteNumber(op.value);
            if (numericValue === null) {
              errors.push(`${opLabel}: property "${op.property}" requires numeric value.`);
              break;
            }
            args.bindings.updateObject(sceneResolved.scene.id, objectResolved.object.id, {
              [op.property]: numericValue,
            } as Partial<GameObject>);
          }

          changed = true;
          appliedOpCount += 1;
          summaryLines.push(`Updated ${objectResolved.object.name}.${op.property}.`);
          break;
        }
        case 'set_object_physics': {
          const sceneResolved = resolveScene(currentProject, op.sceneId);
          if (!sceneResolved.scene) {
            errors.push(`${opLabel}: ${sceneResolved.error}`);
            break;
          }
          const objectResolved = resolveObject(sceneResolved.scene, op.objectId);
          if (!objectResolved.object) {
            errors.push(`${opLabel}: ${objectResolved.error}`);
            break;
          }

          if (op.physics === null) {
            args.bindings.updateObject(sceneResolved.scene.id, objectResolved.object.id, { physics: null });
          } else {
            const effectiveProps = getEffectiveObjectProps(objectResolved.object, currentProject.components || []);
            const nextPhysics = {
              ...(effectiveProps.physics || createDefaultPhysicsConfig()),
              ...op.physics,
            };
            args.bindings.updateObject(sceneResolved.scene.id, objectResolved.object.id, { physics: nextPhysics });
          }

          changed = true;
          appliedOpCount += 1;
          summaryLines.push(`Updated physics for "${objectResolved.object.name}".`);
          break;
        }
        case 'set_object_collider_type': {
          const sceneResolved = resolveScene(currentProject, op.sceneId);
          if (!sceneResolved.scene) {
            errors.push(`${opLabel}: ${sceneResolved.error}`);
            break;
          }
          const objectResolved = resolveObject(sceneResolved.scene, op.objectId);
          if (!objectResolved.object) {
            errors.push(`${opLabel}: ${objectResolved.error}`);
            break;
          }

          if (op.colliderType === 'none') {
            args.bindings.updateObject(sceneResolved.scene.id, objectResolved.object.id, { collider: null });
          } else {
            const effectiveProps = getEffectiveObjectProps(objectResolved.object, currentProject.components || []);
            const baseCollider: ColliderConfig = effectiveProps.collider
              ? { ...effectiveProps.collider, type: op.colliderType }
              : createDefaultColliderConfig(op.colliderType);
            args.bindings.updateObject(sceneResolved.scene.id, objectResolved.object.id, { collider: baseCollider });
          }

          changed = true;
          appliedOpCount += 1;
          summaryLines.push(`Set collider type for "${objectResolved.object.name}" to "${op.colliderType}".`);
          break;
        }
        case 'create_folder': {
          const sceneResolved = resolveScene(currentProject, op.sceneId);
          if (!sceneResolved.scene) {
            errors.push(`${opLabel}: ${sceneResolved.error}`);
            break;
          }
          const scene = sceneResolved.scene;

          let parentId: string | null = null;
          if (typeof op.parentId === 'string') {
            const parentResolved = resolveFolder(scene, op.parentId);
            if (!parentResolved.folder) {
              errors.push(`${opLabel}: ${parentResolved.error}`);
              break;
            }
            parentId = parentResolved.folder.id;
          } else if (op.parentId === null) {
            parentId = null;
          }

          const newFolder: SceneFolder = {
            id: crypto.randomUUID(),
            name: op.name,
            parentId,
            order: getNextSiblingOrder(scene, parentId),
          };
          args.bindings.updateScene(scene.id, {
            objectFolders: [...(scene.objectFolders || []), newFolder],
          });
          changed = true;
          appliedOpCount += 1;
          summaryLines.push(`Created folder "${op.name}" in scene "${scene.name}".`);
          break;
        }
        case 'rename_folder': {
          const sceneResolved = resolveScene(currentProject, op.sceneId);
          if (!sceneResolved.scene) {
            errors.push(`${opLabel}: ${sceneResolved.error}`);
            break;
          }
          const folderResolved = resolveFolder(sceneResolved.scene, op.folderId);
          if (!folderResolved.folder) {
            errors.push(`${opLabel}: ${folderResolved.error}`);
            break;
          }
          const nextFolders = (sceneResolved.scene.objectFolders || []).map((folder) =>
            folder.id === folderResolved.folder!.id ? { ...folder, name: op.name } : folder
          );
          args.bindings.updateScene(sceneResolved.scene.id, {
            objectFolders: nextFolders,
          });
          changed = true;
          appliedOpCount += 1;
          summaryLines.push(`Renamed folder "${folderResolved.folder.name}" to "${op.name}".`);
          break;
        }
        case 'move_object_to_folder': {
          const sceneResolved = resolveScene(currentProject, op.sceneId);
          if (!sceneResolved.scene) {
            errors.push(`${opLabel}: ${sceneResolved.error}`);
            break;
          }
          const objectResolved = resolveObject(sceneResolved.scene, op.objectId);
          if (!objectResolved.object) {
            errors.push(`${opLabel}: ${objectResolved.error}`);
            break;
          }

          let targetFolderId: string | null = null;
          if (typeof op.folderId === 'string') {
            const folderResolved = resolveFolder(sceneResolved.scene, op.folderId);
            if (!folderResolved.folder) {
              errors.push(`${opLabel}: ${folderResolved.error}`);
              break;
            }
            targetFolderId = folderResolved.folder.id;
          }

          const movedScene = moveSceneLayerNodes(
            sceneResolved.scene,
            [getObjectNodeKey(objectResolved.object.id)],
            targetFolderId
              ? { key: getFolderNodeKey(targetFolderId), dropPosition: 'on' }
              : { key: null, dropPosition: null },
          );

          args.bindings.updateScene(sceneResolved.scene.id, {
            objects: movedScene.objects,
            objectFolders: movedScene.objectFolders,
          });
          changed = true;
          appliedOpCount += 1;
          summaryLines.push(
            `Moved "${objectResolved.object.name}" to ${targetFolderId ? `folder "${targetFolderId}"` : 'root'}.`,
          );
          break;
        }
        case 'add_costume_from_image_url': {
          const sceneResolved = resolveScene(currentProject, op.sceneId);
          if (!sceneResolved.scene) {
            errors.push(`${opLabel}: ${sceneResolved.error}`);
            break;
          }
          const objectResolved = resolveObject(sceneResolved.scene, op.objectId);
          if (!objectResolved.object) {
            errors.push(`${opLabel}: ${objectResolved.error}`);
            break;
          }

          const imported = await importImageCostumeAsset(op.imageUrl);
          const effectiveProps = getEffectiveObjectProps(objectResolved.object, currentProject.components || []);
          const nextCostumes = [
            ...(effectiveProps.costumes || []),
            {
              id: crypto.randomUUID(),
              name: op.name,
              assetId: imported.assetId,
              bounds: imported.bounds,
              editorMode: 'vector' as const,
            },
          ];
          setObjectCostumes(
            args.bindings,
            sceneResolved.scene.id,
            objectResolved.object.id,
            nextCostumes,
            nextCostumes.length - 1,
          );
          changed = true;
          appliedOpCount += 1;
          summaryLines.push(`Imported costume "${op.name}" for "${objectResolved.object.name}".`);
          break;
        }
        case 'add_costume_text_circle': {
          const sceneResolved = resolveScene(currentProject, op.sceneId);
          if (!sceneResolved.scene) {
            errors.push(`${opLabel}: ${sceneResolved.error}`);
            break;
          }
          const objectResolved = resolveObject(sceneResolved.scene, op.objectId);
          if (!objectResolved.object) {
            errors.push(`${opLabel}: ${objectResolved.error}`);
            break;
          }

          const circleCostume = createTextCircleCostumeAsset({
            text: op.text,
            fillColor: op.fillColor,
            textColor: op.textColor,
          });
          const effectiveProps = getEffectiveObjectProps(objectResolved.object, currentProject.components || []);
          const nextCostumes = [
            ...(effectiveProps.costumes || []),
            {
              id: crypto.randomUUID(),
              name: op.name,
              assetId: circleCostume.assetId,
              bounds: circleCostume.bounds,
              editorMode: 'vector' as const,
            },
          ];
          setObjectCostumes(
            args.bindings,
            sceneResolved.scene.id,
            objectResolved.object.id,
            nextCostumes,
            nextCostumes.length - 1,
          );
          changed = true;
          appliedOpCount += 1;
          summaryLines.push(`Added text-circle costume "${op.name}" to "${objectResolved.object.name}".`);
          break;
        }
        case 'rename_costume': {
          const sceneResolved = resolveScene(currentProject, op.sceneId);
          if (!sceneResolved.scene) {
            errors.push(`${opLabel}: ${sceneResolved.error}`);
            break;
          }
          const objectResolved = resolveObject(sceneResolved.scene, op.objectId);
          if (!objectResolved.object) {
            errors.push(`${opLabel}: ${objectResolved.error}`);
            break;
          }
          const effectiveProps = getEffectiveObjectProps(objectResolved.object, currentProject.components || []);
          const costumeResolved = resolveCostume(effectiveProps.costumes || [], op.costumeId);
          if (!costumeResolved.costume) {
            errors.push(`${opLabel}: ${costumeResolved.error}`);
            break;
          }

          const nextCostumes = (effectiveProps.costumes || []).map((costume) =>
            costume.id === costumeResolved.costume!.id ? { ...costume, name: op.name } : costume
          );
          setObjectCostumes(
            args.bindings,
            sceneResolved.scene.id,
            objectResolved.object.id,
            nextCostumes,
            effectiveProps.currentCostumeIndex ?? 0,
          );
          changed = true;
          appliedOpCount += 1;
          summaryLines.push(`Renamed costume "${costumeResolved.costume.name}" to "${op.name}".`);
          break;
        }
        case 'reorder_costumes': {
          const sceneResolved = resolveScene(currentProject, op.sceneId);
          if (!sceneResolved.scene) {
            errors.push(`${opLabel}: ${sceneResolved.error}`);
            break;
          }
          const objectResolved = resolveObject(sceneResolved.scene, op.objectId);
          if (!objectResolved.object) {
            errors.push(`${opLabel}: ${objectResolved.error}`);
            break;
          }
          const effectiveProps = getEffectiveObjectProps(objectResolved.object, currentProject.components || []);
          const costumes = effectiveProps.costumes || [];
          const currentCostumeId = costumes[effectiveProps.currentCostumeIndex || 0]?.id || null;

          const orderedIds: string[] = [];
          for (const costumeRef of op.costumeIds) {
            const costumeResolved = resolveCostume(costumes, costumeRef);
            if (!costumeResolved.costume) {
              errors.push(`${opLabel}: ${costumeResolved.error}`);
              continue;
            }
            orderedIds.push(costumeResolved.costume.id);
          }

          const uniqueRequested = dedupe(orderedIds);
          if (uniqueRequested.length === 0) {
            errors.push(`${opLabel}: no valid costume references were provided.`);
            break;
          }

          const finalOrder = [
            ...uniqueRequested,
            ...costumes.map((costume) => costume.id).filter((costumeId) => !uniqueRequested.includes(costumeId)),
          ];
          const byId = new Map(costumes.map((costume) => [costume.id, costume]));
          const nextCostumes = finalOrder
            .map((id) => byId.get(id))
            .filter((item): item is Costume => !!item);
          const nextCurrentIndex = currentCostumeId
            ? Math.max(0, nextCostumes.findIndex((costume) => costume.id === currentCostumeId))
            : 0;

          setObjectCostumes(
            args.bindings,
            sceneResolved.scene.id,
            objectResolved.object.id,
            nextCostumes,
            nextCurrentIndex,
          );
          changed = true;
          appliedOpCount += 1;
          summaryLines.push(`Reordered costumes for "${objectResolved.object.name}".`);
          break;
        }
        case 'set_current_costume': {
          const sceneResolved = resolveScene(currentProject, op.sceneId);
          if (!sceneResolved.scene) {
            errors.push(`${opLabel}: ${sceneResolved.error}`);
            break;
          }
          const objectResolved = resolveObject(sceneResolved.scene, op.objectId);
          if (!objectResolved.object) {
            errors.push(`${opLabel}: ${objectResolved.error}`);
            break;
          }
          const effectiveProps = getEffectiveObjectProps(objectResolved.object, currentProject.components || []);
          const costumeResolved = resolveCostume(effectiveProps.costumes || [], op.costumeId);
          if (!costumeResolved.costume) {
            errors.push(`${opLabel}: ${costumeResolved.error}`);
            break;
          }
          const nextIndex = (effectiveProps.costumes || []).findIndex(
            (costume) => costume.id === costumeResolved.costume!.id,
          );
          args.bindings.updateObject(sceneResolved.scene.id, objectResolved.object.id, {
            currentCostumeIndex: Math.max(0, nextIndex),
          });
          changed = true;
          appliedOpCount += 1;
          summaryLines.push(`Set current costume for "${objectResolved.object.name}" to "${costumeResolved.costume.name}".`);
          break;
        }
        case 'validate_project': {
          const validationProject = args.bindings.getProject();
          if (!validationProject) {
            errors.push(`${opLabel}: no project is open.`);
            break;
          }
          const issues = validateProjectBeforePlay(validationProject);
          validationIssueCount = issues.length;
          validationIssueSample = issues.slice(0, 8).map((issue) => `${issue.objectName}: ${issue.message}`);
          appliedOpCount += 1;
          summaryLines.push(`Validation found ${issues.length} issue(s).`);
          break;
        }
        default: {
          errors.push(`${opLabel}: unsupported project op.`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown project op error.';
      errors.push(`${opLabel}: ${message}`);
    }
  }

  return {
    applied: changed || appliedOpCount > 0,
    changed,
    appliedOpCount,
    summaryLines,
    errors,
    validationIssueCount,
    validationIssueSample,
  };
}

export async function previewProjectOps(args: {
  projectOps: ProjectOp[];
  project: Project;
}): Promise<ProjectOpsPreviewResult> {
  const previewProject = structuredClone(args.project);
  const bindings: ProjectOpsBindings = {
    getProject: () => previewProject,
    updateProjectName: (name) => {
      previewProject.name = name;
      previewProject.updatedAt = new Date();
    },
    addScene: (name) => {
      const order = previewProject.scenes.length;
      previewProject.scenes.push(createDefaultScene(crypto.randomUUID(), name, order));
      previewProject.updatedAt = new Date();
    },
    reorderScenes: (sceneIds) => {
      const ordered = sceneIds
        .map((sceneId) => previewProject.scenes.find((scene) => scene.id === sceneId))
        .filter((scene): scene is Scene => !!scene);
      previewProject.scenes = ordered.map((scene, index) => ({
        ...scene,
        order: index,
      }));
      previewProject.updatedAt = new Date();
    },
    updateScene: (sceneId, updates) => {
      const sceneIndex = previewProject.scenes.findIndex((scene) => scene.id === sceneId);
      if (sceneIndex < 0) return;
      previewProject.scenes[sceneIndex] = {
        ...previewProject.scenes[sceneIndex],
        ...updates,
      };
      previewProject.updatedAt = new Date();
    },
    addObject: (sceneId, name) => {
      const scene = previewProject.scenes.find((entry) => entry.id === sceneId);
      if (!scene) {
        throw new Error(`Scene "${sceneId}" not found.`);
      }
      const object = {
        ...createDefaultGameObject(name),
        order: scene.objects.length,
      };
      scene.objects.push(object);
      previewProject.updatedAt = new Date();
      return object;
    },
    updateObject: (sceneId, objectId, updates) => {
      const scene = previewProject.scenes.find((entry) => entry.id === sceneId);
      const objectIndex = scene?.objects.findIndex((object) => object.id === objectId) ?? -1;
      if (!scene || objectIndex < 0) return;
      scene.objects[objectIndex] = {
        ...scene.objects[objectIndex],
        ...updates,
      };
      previewProject.updatedAt = new Date();
    },
  };

  const result = await applyProjectOps({
    projectOps: args.projectOps,
    bindings,
  });

  return {
    ...result,
    pass: result.errors.length === 0 && result.validationIssueCount === 0,
    project: previewProject,
  };
}
