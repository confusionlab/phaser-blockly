import Dexie, { type EntityTable } from 'dexie';
import type { Project, ReusableObject } from '../types';

// Current schema version - increment when project structure changes (see CLAUDE.md)
export const CURRENT_SCHEMA_VERSION = 1;

// App version comes from Vite define (derived from package.json)
export const APP_VERSION = __APP_VERSION__;

// Database schema
interface ProjectRecordV1 {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  data: string; // JSON stringified Project (scenes, settings, etc.)
}

interface ProjectRecord extends ProjectRecordV1 {
  schemaVersion: number;
  appVersion?: string;
}

interface AssetRecord {
  id: string;
  name: string;
  type: 'sprite' | 'background' | 'sound';
  data: Blob;
  thumbnail?: string;
  frameWidth?: number;
  frameHeight?: number;
}

interface ReusableRecord {
  id: string;
  name: string;
  thumbnail: string;
  data: string; // JSON stringified ReusableObject data
  createdAt: Date;
  tags: string[];
}

function normalizeSchemaVersion(version: unknown): number {
  if (typeof version === 'number' && Number.isFinite(version) && version >= 1) {
    return Math.floor(version);
  }

  if (typeof version === 'string') {
    const parsed = Number.parseFloat(version);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }
  }

  return 1;
}

function serializeProjectData(project: Project): string {
  const { id: _id, name: _name, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = project;
  return JSON.stringify(rest);
}

function deserializeProjectFromRecord(record: ProjectRecord): {
  project: Project;
  sourceSchemaVersion: number;
  migrated: boolean;
} {
  const data = JSON.parse(record.data);
  const sourceSchemaVersion = normalizeSchemaVersion(record.schemaVersion);

  if (sourceSchemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Project "${record.name}" requires schema v${sourceSchemaVersion} but this app supports up to v${CURRENT_SCHEMA_VERSION}.`,
    );
  }

  let project: Project = {
    id: record.id,
    name: record.name,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
    ...data,
  };

  let migrated = false;
  if (sourceSchemaVersion < CURRENT_SCHEMA_VERSION) {
    project = migrateProject(project, sourceSchemaVersion);
    project.updatedAt = new Date();
    migrated = true;
  }

  return {
    project,
    sourceSchemaVersion,
    migrated,
  };
}

function toProjectRecord(project: Project, updatedAt: Date = new Date()): ProjectRecord {
  return {
    id: project.id,
    name: project.name,
    createdAt: new Date(project.createdAt),
    updatedAt,
    data: serializeProjectData(project),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
  };
}

class GameMakerDatabase extends Dexie {
  projects!: EntityTable<ProjectRecord, 'id'>;
  assets!: EntityTable<AssetRecord, 'id'>;
  reusables!: EntityTable<ReusableRecord, 'id'>;

  constructor() {
    super('PochaCodingDB');

    this.version(1).stores({
      projects: 'id, name, createdAt, updatedAt',
      assets: 'id, name, type',
      reusables: 'id, name, createdAt, *tags',
    });

    this.version(2)
      .stores({
        projects: 'id, name, createdAt, updatedAt, schemaVersion',
        assets: 'id, name, type',
        reusables: 'id, name, createdAt, *tags',
      })
      .upgrade(async (tx) => {
        await tx
          .table('projects')
          .toCollection()
          .modify((record: ProjectRecordV1 & Partial<ProjectRecord>) => {
            record.schemaVersion = normalizeSchemaVersion(record.schemaVersion);
            if (typeof record.appVersion !== 'string') {
              delete record.appVersion;
            }
          });
      });
  }
}

export const db = new GameMakerDatabase();

// Project Repository

export async function saveProject(project: Project): Promise<void> {
  await db.projects.put(toProjectRecord(project));
}

export async function loadProject(id: string): Promise<Project | null> {
  const record = await db.projects.get(id);
  if (!record) return null;

  const normalizedRecord: ProjectRecord = {
    ...record,
    schemaVersion: normalizeSchemaVersion(record.schemaVersion),
  };

  const { project, migrated } = deserializeProjectFromRecord(normalizedRecord);

  if (migrated) {
    await db.projects.put(toProjectRecord(project, project.updatedAt));
  }

  return project;
}

export async function listProjects(): Promise<Array<{ id: string; name: string; updatedAt: Date }>> {
  const records = await db.projects.orderBy('updatedAt').reverse().toArray();
  return records.map((record) => ({
    id: record.id,
    name: record.name,
    updatedAt: record.updatedAt,
  }));
}

export async function deleteProject(id: string): Promise<void> {
  await db.projects.delete(id);
}

// Reusable Object Repository

export async function saveReusable(reusable: ReusableObject): Promise<void> {
  const { id, name, thumbnail, createdAt, tags, ...rest } = reusable;
  await db.reusables.put({
    id,
    name,
    thumbnail,
    createdAt,
    tags,
    data: JSON.stringify(rest),
  });
}

export async function loadReusable(id: string): Promise<ReusableObject | null> {
  const record = await db.reusables.get(id);
  if (!record) return null;

  const data = JSON.parse(record.data);
  return {
    id: record.id,
    name: record.name,
    thumbnail: record.thumbnail,
    createdAt: record.createdAt,
    tags: record.tags,
    ...data,
  };
}

export async function listReusables(): Promise<ReusableObject[]> {
  const records = await db.reusables.orderBy('createdAt').reverse().toArray();
  return records.map((record) => {
    const data = JSON.parse(record.data);
    return {
      id: record.id,
      name: record.name,
      thumbnail: record.thumbnail,
      createdAt: record.createdAt,
      tags: record.tags,
      ...data,
    };
  });
}

export async function deleteReusable(id: string): Promise<void> {
  await db.reusables.delete(id);
}

// === Cloud Sync Functions ===

export interface ProjectSyncPayload {
  localId: string;
  name: string;
  data: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
  appVersion: string;
}

export function createProjectSyncPayload(project: Project): ProjectSyncPayload {
  return {
    localId: project.id,
    name: project.name,
    data: serializeProjectData(project),
    createdAt: project.createdAt.getTime(),
    updatedAt: project.updatedAt.getTime(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
  };
}

function recordToSyncPayload(record: ProjectRecord): ProjectSyncPayload {
  return {
    localId: record.id,
    name: record.name,
    data: record.data,
    createdAt: record.createdAt.getTime(),
    updatedAt: record.updatedAt.getTime(),
    schemaVersion: normalizeSchemaVersion(record.schemaVersion),
    appVersion: record.appVersion ?? APP_VERSION,
  };
}

// Get all local projects for batch sync
export async function getAllProjectsForSync(): Promise<ProjectSyncPayload[]> {
  const records = await db.projects.toArray();
  const payloads: ProjectSyncPayload[] = [];

  for (const record of records) {
    try {
      const project = await loadProject(record.id);
      if (project) {
        payloads.push(createProjectSyncPayload(project));
      }
    } catch (error) {
      console.error(`[CloudSync] Failed to prepare project ${record.id} for sync:`, error);
    }
  }

  return payloads;
}

export async function pruneLocalProjectsNotInCloud(cloudLocalIds: string[]): Promise<{ deleted: number }> {
  const cloudIdSet = new Set(cloudLocalIds);
  const localRecords = await db.projects.toArray();
  const localOnlyIds = localRecords
    .map((record) => record.id)
    .filter((localId) => !cloudIdSet.has(localId));

  if (localOnlyIds.length === 0) {
    return { deleted: 0 };
  }

  await db.transaction('rw', db.projects, async () => {
    await Promise.all(localOnlyIds.map((localId) => db.projects.delete(localId)));
  });

  return { deleted: localOnlyIds.length };
}

// Sync a single project from cloud to local
export async function syncProjectFromCloud(cloudProject: {
  localId: string;
  name: string;
  data: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number | string;
  appVersion?: string;
}): Promise<{ action: 'created' | 'updated' | 'skipped'; reason?: string; migrated?: boolean }> {
  const cloudSchemaVersion = normalizeSchemaVersion(cloudProject.schemaVersion);

  if (cloudSchemaVersion > CURRENT_SCHEMA_VERSION) {
    return {
      action: 'skipped',
      reason: `cloud schema v${cloudSchemaVersion} is newer than supported v${CURRENT_SCHEMA_VERSION}`,
    };
  }

  let cloudData: Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>;
  try {
    cloudData = JSON.parse(cloudProject.data) as Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>;
  } catch {
    return {
      action: 'skipped',
      reason: 'cloud project data is invalid JSON',
    };
  }

  let incomingProject: Project = {
    id: cloudProject.localId,
    name: cloudProject.name,
    createdAt: new Date(cloudProject.createdAt),
    updatedAt: new Date(cloudProject.updatedAt),
    ...cloudData,
  };

  let migrated = false;
  if (cloudSchemaVersion < CURRENT_SCHEMA_VERSION) {
    incomingProject = migrateProject(incomingProject, cloudSchemaVersion);
    incomingProject.updatedAt = new Date(Math.max(Date.now(), cloudProject.updatedAt));
    migrated = true;
  }

  const incomingRecord: ProjectRecord = {
    id: incomingProject.id,
    name: incomingProject.name,
    data: serializeProjectData(incomingProject),
    createdAt: new Date(cloudProject.createdAt),
    updatedAt: new Date(incomingProject.updatedAt),
    schemaVersion: migrated ? CURRENT_SCHEMA_VERSION : cloudSchemaVersion,
    appVersion: cloudProject.appVersion,
  };

  const existing = await db.projects.get(cloudProject.localId);

  if (!existing) {
    await db.projects.put(incomingRecord);
    return { action: 'created', migrated };
  }

  const existingSchemaVersion = normalizeSchemaVersion(existing.schemaVersion);
  const shouldUpdate =
    incomingRecord.updatedAt.getTime() > existing.updatedAt.getTime() ||
    incomingRecord.schemaVersion > existingSchemaVersion;

  if (!shouldUpdate) {
    return { action: 'skipped' };
  }

  await db.projects.put(incomingRecord);
  return { action: 'updated', migrated };
}

// Get single project record for sync
export async function getProjectForSync(id: string): Promise<ProjectSyncPayload | null> {
  const project = await loadProject(id);
  if (!project) return null;
  return createProjectSyncPayload(project);
}

export async function getProjectForSyncFromRecord(id: string): Promise<ProjectSyncPayload | null> {
  const record = await db.projects.get(id);
  if (!record) return null;
  return recordToSyncPayload({
    ...record,
    schemaVersion: normalizeSchemaVersion(record.schemaVersion),
  });
}

export async function migrateAllLocalProjects(): Promise<{
  migrated: number;
  skipped: number;
  failed: number;
}> {
  const records = await db.projects.toArray();
  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const record of records) {
    try {
      const originalSchemaVersion = normalizeSchemaVersion(record.schemaVersion);
      await loadProject(record.id);
      if (originalSchemaVersion < CURRENT_SCHEMA_VERSION) {
        migrated += 1;
      } else {
        skipped += 1;
      }
    } catch (error) {
      failed += 1;
      console.error(`[Migration] Failed to migrate project ${record.id}:`, error);
    }
  }

  return { migrated, skipped, failed };
}

// Export / Import

// Supported file types for backwards compatibility
const SUPPORTED_FILE_TYPES = ['pochacoding-project', 'phaserblockly-project'] as const;

export interface ExportedProject {
  schemaVersion: number; // Schema version for migrations
  type: 'pochacoding-project';
  exportedAt: string;
  appVersion?: string; // Optional: app version that created this file
  project: Project;
}

// Schema migration functions - add new migrations here as schema evolves
type MigrationFn = (project: Project) => Project;

const migrations: Record<number, MigrationFn> = {
  // Example for future migrations:
  // 2: (project) => {
  //   // Migrate from v1 to v2
  //   project.scenes.forEach(scene => {
  //     scene.newField = scene.newField ?? 'default';
  //   });
  //   return project;
  // },
};

function migrateProject(project: Project, fromVersion: number): Project {
  let currentProject = { ...project };

  for (let version = fromVersion + 1; version <= CURRENT_SCHEMA_VERSION; version++) {
    const migrateFn = migrations[version];
    if (migrateFn) {
      console.log(`Migrating project from schema v${version - 1} to v${version}`);
      currentProject = migrateFn(currentProject);
    }
  }

  return currentProject;
}

export function exportProject(project: Project): string {
  const exportData: ExportedProject = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    type: 'pochacoding-project',
    exportedAt: new Date().toISOString(),
    appVersion: APP_VERSION,
    project,
  };
  return JSON.stringify(exportData, null, 2);
}

export function downloadProject(project: Project): void {
  const json = exportProject(project);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `${project.name.replace(/[^a-z0-9]/gi, '_')}.pochacoding.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const PICK_FROM_STAGE = '__PICK_FROM_STAGE__';
const COMPONENT_ANY_PREFIX = 'COMPONENT_ANY:';
const VALID_OBJECT_SPECIAL_VALUES = new Set(['EDGE', 'GROUND', 'MOUSE', 'MY_CLONES', '']);

const OBJECT_REFERENCE_BLOCKS: Record<string, string> = {
  sensing_touching: 'TARGET',
  sensing_touching_direction: 'TARGET',
  sensing_distance_to: 'TARGET',
  sensing_touching_object: 'TARGET',
  motion_point_towards: 'TARGET',
  camera_follow_object: 'TARGET',
  control_clone_object: 'TARGET',
  event_when_touching: 'TARGET',
  event_when_touching_direction: 'TARGET',
  motion_attach_to_dropdown: 'TARGET',
  motion_attach_dropdown_to_me: 'TARGET',
};

const SOUND_REFERENCE_BLOCKS: Record<string, string> = {
  sound_play: 'SOUND',
  sound_play_until_done: 'SOUND',
};

const VARIABLE_REFERENCE_BLOCKS: Record<string, string> = {
  typed_variable_get: 'VAR',
  typed_variable_set: 'VAR',
  typed_variable_change: 'VAR',
};

interface ImportReferenceMaps {
  objectIds: Map<string, string>;
  variableIds: Map<string, string>;
  soundIds: Map<string, string>;
  componentIds: Map<string, string>;
}

interface ImportReferenceFallbacks {
  objectNameToId?: Map<string, string>;
  variableNameToId?: Map<string, string>;
  soundNameToId?: Map<string, string>;
}

function cloneProjectForImport(project: Project): Project {
  if (typeof structuredClone === 'function') {
    return structuredClone(project);
  }
  return JSON.parse(JSON.stringify(project)) as Project;
}

function readValidId(id: unknown): string | null {
  if (typeof id !== 'string') return null;
  const trimmed = id.trim();
  return trimmed ? trimmed : null;
}

function rememberIdMapping(map: Map<string, string>, previousId: unknown, nextId: string): void {
  const oldId = readValidId(previousId);
  if (oldId) {
    map.set(oldId, nextId);
  }
}

function createUniqueNameIdMap(entries: Array<{ name?: string; id?: string }>): Map<string, string> {
  const countsByName = new Map<string, number>();
  const idByName = new Map<string, string>();

  for (const entry of entries) {
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const id = readValidId(entry.id);
    if (!name || !id) continue;
    countsByName.set(name, (countsByName.get(name) || 0) + 1);
    idByName.set(name, id);
  }

  const result = new Map<string, string>();
  for (const [name, count] of countsByName) {
    if (count === 1) {
      const id = idByName.get(name);
      if (id) {
        result.set(name, id);
      }
    }
  }
  return result;
}

function remapObjectReference(
  rawValue: string,
  maps: ImportReferenceMaps,
  objectNameToId?: Map<string, string>
): string {
  const value = rawValue.trim();
  if (!value || value === PICK_FROM_STAGE || VALID_OBJECT_SPECIAL_VALUES.has(value)) {
    return rawValue;
  }

  if (value.startsWith(COMPONENT_ANY_PREFIX)) {
    const componentId = value.slice(COMPONENT_ANY_PREFIX.length);
    const remappedComponentId = maps.componentIds.get(componentId);
    return remappedComponentId ? `${COMPONENT_ANY_PREFIX}${remappedComponentId}` : rawValue;
  }

  return maps.objectIds.get(value) || objectNameToId?.get(value) || rawValue;
}

function remapIdOrNameReference(
  rawValue: string,
  idMap: Map<string, string>,
  nameMap?: Map<string, string>
): string {
  const value = rawValue.trim();
  if (!value) return rawValue;
  return idMap.get(value) || nameMap?.get(value) || rawValue;
}

function remapBlocklyXmlReferences(
  blocklyXml: string,
  maps: ImportReferenceMaps,
  fallbacks: ImportReferenceFallbacks = {}
): string {
  if (!blocklyXml.trim()) return blocklyXml;
  if (typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return blocklyXml;
  }

  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(blocklyXml, 'text/xml');
    if (xmlDoc.getElementsByTagName('parsererror').length > 0) {
      return blocklyXml;
    }

    let changed = false;
    const blocks = Array.from(xmlDoc.getElementsByTagName('block'));
    for (const block of blocks) {
      const blockType = block.getAttribute('type') || '';

      const updateField = (fieldName: string, mapper: (value: string) => string) => {
        const fields = Array.from(block.children).filter(
          (child): child is Element =>
            child.tagName.toLowerCase() === 'field' &&
            child.getAttribute('name') === fieldName
        );

        for (const field of fields) {
          const currentValue = field.textContent || '';
          const remappedValue = mapper(currentValue);
          if (remappedValue !== currentValue) {
            field.textContent = remappedValue;
            changed = true;
          }
        }
      };

      const objectFieldName = OBJECT_REFERENCE_BLOCKS[blockType];
      if (objectFieldName) {
        updateField(objectFieldName, (value) =>
          remapObjectReference(value, maps, fallbacks.objectNameToId)
        );
      }

      const variableFieldName = VARIABLE_REFERENCE_BLOCKS[blockType];
      if (variableFieldName) {
        updateField(variableFieldName, (value) =>
          remapIdOrNameReference(value, maps.variableIds, fallbacks.variableNameToId)
        );
      }

      const soundFieldName = SOUND_REFERENCE_BLOCKS[blockType];
      if (soundFieldName) {
        updateField(soundFieldName, (value) =>
          remapIdOrNameReference(value, maps.soundIds, fallbacks.soundNameToId)
        );
      }
    }

    if (!changed || !xmlDoc.documentElement) {
      return blocklyXml;
    }

    return new XMLSerializer().serializeToString(xmlDoc.documentElement);
  } catch {
    return blocklyXml;
  }
}

export async function importProject(jsonString: string): Promise<Project> {
  const data = JSON.parse(jsonString);

  // Validate format - support both old and new file types
  const fileType = data.type as string;
  if (!SUPPORTED_FILE_TYPES.includes(fileType as (typeof SUPPORTED_FILE_TYPES)[number])) {
    throw new Error('Invalid file format: not a PochaCoding project');
  }

  if (!data.project) {
    throw new Error('Invalid file format: missing project data');
  }

  // Handle schema version (default to 1 for old files without schemaVersion)
  const schemaVersion = normalizeSchemaVersion(data.schemaVersion ?? data.version ?? 1);

  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `This project was created with a newer version of PochaCoding (schema v${schemaVersion}). ` +
        `Please update the app to open this file.`,
    );
  }

  // Migrate project if needed
  let project = cloneProjectForImport(data.project as Project);
  if (schemaVersion < CURRENT_SCHEMA_VERSION) {
    project = migrateProject(project, schemaVersion);
  }

  // Ensure missing arrays do not break import of older files.
  project.scenes = Array.isArray(project.scenes) ? project.scenes : [];
  project.globalVariables = Array.isArray(project.globalVariables) ? project.globalVariables : [];
  project.components = Array.isArray(project.components) ? project.components : [];

  // Generate new IDs to avoid collisions and keep imported data isolated.
  const objectIdMap = new Map<string, string>();
  const variableIdMap = new Map<string, string>();
  const soundIdMap = new Map<string, string>();
  const componentIdMap = new Map<string, string>();

  // Remap component IDs first so object.componentId references can be updated.
  for (const component of project.components) {
    const newComponentId = crypto.randomUUID();
    rememberIdMapping(componentIdMap, component.id, newComponentId);
    component.id = newComponentId;

    component.costumes = Array.isArray(component.costumes) ? component.costumes : [];
    component.sounds = Array.isArray(component.sounds) ? component.sounds : [];

    for (const costume of component.costumes) {
      costume.id = crypto.randomUUID();
    }

    for (const sound of component.sounds) {
      const newSoundId = crypto.randomUUID();
      rememberIdMapping(soundIdMap, sound.id, newSoundId);
      sound.id = newSoundId;
    }
  }

  // Remap variable IDs (global + local) and wire local ownership.
  for (const variable of project.globalVariables) {
    const newVariableId = crypto.randomUUID();
    rememberIdMapping(variableIdMap, variable.id, newVariableId);
    variable.id = newVariableId;
  }

  for (const scene of project.scenes) {
    scene.id = crypto.randomUUID();
    scene.objects = Array.isArray(scene.objects) ? scene.objects : [];
    scene.objectFolders = Array.isArray(scene.objectFolders) ? scene.objectFolders : [];
    if (!scene.cameraConfig) {
      scene.cameraConfig = {
        followTarget: null,
        bounds: null,
        zoom: 1,
      };
    }

    for (const obj of scene.objects) {
      const newObjectId = crypto.randomUUID();
      rememberIdMapping(objectIdMap, obj.id, newObjectId);
      obj.id = newObjectId;

      if (obj.componentId) {
        obj.componentId = componentIdMap.get(obj.componentId) || obj.componentId;
      }

      obj.costumes = Array.isArray(obj.costumes) ? obj.costumes : [];
      obj.sounds = Array.isArray(obj.sounds) ? obj.sounds : [];
      obj.localVariables = Array.isArray(obj.localVariables) ? obj.localVariables : [];

      for (const costume of obj.costumes) {
        costume.id = crypto.randomUUID();
      }

      for (const sound of obj.sounds) {
        const newSoundId = crypto.randomUUID();
        rememberIdMapping(soundIdMap, sound.id, newSoundId);
        sound.id = newSoundId;
      }

      for (const variable of obj.localVariables) {
        const newVariableId = crypto.randomUUID();
        rememberIdMapping(variableIdMap, variable.id, newVariableId);
        variable.id = newVariableId;
        variable.objectId = obj.id;
      }
    }
  }

  const referenceMaps: ImportReferenceMaps = {
    objectIds: objectIdMap,
    variableIds: variableIdMap,
    soundIds: soundIdMap,
    componentIds: componentIdMap,
  };

  const globalObjectNameToId = createUniqueNameIdMap(
    project.scenes.flatMap((scene) => scene.objects.map((obj) => ({ name: obj.name, id: obj.id })))
  );
  const globalVariableNameToId = createUniqueNameIdMap(
    project.globalVariables.map((variable) => ({ name: variable.name, id: variable.id }))
  );

  for (const scene of project.scenes) {
    const sceneObjectNameToId = createUniqueNameIdMap(
      scene.objects.map((obj) => ({ name: obj.name, id: obj.id }))
    );

    scene.cameraConfig.followTarget = scene.cameraConfig.followTarget
      ? remapObjectReference(scene.cameraConfig.followTarget, referenceMaps, sceneObjectNameToId)
      : null;

    for (const obj of scene.objects) {
      const localVariableNameToId = createUniqueNameIdMap(
        obj.localVariables.map((variable) => ({ name: variable.name, id: variable.id }))
      );
      const combinedVariableNameToId = createUniqueNameIdMap([
        ...project.globalVariables.map((variable) => ({ name: variable.name, id: variable.id })),
        ...obj.localVariables.map((variable) => ({ name: variable.name, id: variable.id })),
      ]);

      const effectiveSounds = obj.componentId
        ? (project.components.find((component) => component.id === obj.componentId)?.sounds || [])
        : obj.sounds;
      const soundNameToId = createUniqueNameIdMap(
        effectiveSounds.map((sound) => ({ name: sound.name, id: sound.id }))
      );

      // Keep object code intact while reconnecting IDs for dropdown-backed fields.
      obj.blocklyXml = remapBlocklyXmlReferences(obj.blocklyXml || '', referenceMaps, {
        objectNameToId: sceneObjectNameToId,
        variableNameToId: combinedVariableNameToId.size > 0 ? combinedVariableNameToId : localVariableNameToId,
        soundNameToId,
      });
    }
  }

  for (const component of project.components) {
    const componentSoundNameToId = createUniqueNameIdMap(
      component.sounds.map((sound) => ({ name: sound.name, id: sound.id }))
    );

    component.blocklyXml = remapBlocklyXmlReferences(component.blocklyXml || '', referenceMaps, {
      objectNameToId: globalObjectNameToId,
      variableNameToId: globalVariableNameToId,
      soundNameToId: componentSoundNameToId,
    });
  }

  const newProjectId = crypto.randomUUID();

  const importedProject: Project = {
    ...project,
    id: newProjectId,
    name: `${project.name} (imported)`,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await saveProject(importedProject);

  return importedProject;
}

export async function importProjectFromFile(file: File): Promise<Project> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const jsonString = e.target?.result as string;
        const project = await importProject(jsonString);
        resolve(project);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
}
