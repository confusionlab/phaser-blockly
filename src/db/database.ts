import Dexie, { type EntityTable } from 'dexie';
import type { Project, ReusableObject } from '../types';

// Database schema
interface ProjectRecord {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  data: string; // JSON stringified Project (scenes, settings, etc.)
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
  }
}

export const db = new GameMakerDatabase();

export const CURRENT_SCHEMA_VERSION = 2;
export const MIN_SUPPORTED_SCHEMA_VERSION = 1;

type StoredProjectPayload = Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'> & {
  schemaVersion?: number;
};

function ensurePhysicsDefaults<T extends { physics?: Project['components'][number]['physics'] | null }>(entity: T): T {
  if (!entity.physics) return entity;
  return {
    ...entity,
    physics: {
      ...entity.physics,
      friction: entity.physics.friction ?? 0,
    },
  };
}

function migrateProjectToCurrent(project: Project, fromVersion: number): Project {
  let migrated = { ...project };

  for (let version = fromVersion + 1; version <= CURRENT_SCHEMA_VERSION; version += 1) {
    if (version === 2) {
      migrated = {
        ...migrated,
        schemaVersion: 2,
        scenes: migrated.scenes.map((scene) => ({
          ...scene,
          objects: scene.objects.map((obj) => ensurePhysicsDefaults(obj)),
        })),
        components: migrated.components.map((component) => ensurePhysicsDefaults(component)),
      };
    }
  }

  return migrated;
}


function toProjectPayload(project: Project): Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'> {
  return {
    schemaVersion: project.schemaVersion,
    scenes: project.scenes,
    globalVariables: project.globalVariables,
    settings: project.settings,
    components: project.components,
  };
}

function parseProjectRecord(record: ProjectRecord): Project {
  const parsed = JSON.parse(record.data) as StoredProjectPayload;
  const schemaVersion = parsed.schemaVersion ?? 1;

  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(`Project schema v${schemaVersion} is newer than this app (v${CURRENT_SCHEMA_VERSION}).`);
  }

  if (schemaVersion < MIN_SUPPORTED_SCHEMA_VERSION) {
    throw new Error(`Project schema v${schemaVersion} is too old and no longer supported.`);
  }

  const project: Project = {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...parsed,
    schemaVersion,
  };

  return schemaVersion < CURRENT_SCHEMA_VERSION
    ? migrateProjectToCurrent(project, schemaVersion)
    : project;
}

// Project Repository

export async function saveProject(project: Project): Promise<void> {
  await db.projects.put({
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: new Date(),
    data: JSON.stringify({ ...toProjectPayload(project), schemaVersion: CURRENT_SCHEMA_VERSION }),
  });
}

export async function loadProject(id: string): Promise<Project | null> {
  const record = await db.projects.get(id);
  if (!record) return null;

  const project = parseProjectRecord(record);

  if (project.schemaVersion < CURRENT_SCHEMA_VERSION) {
    await saveProject(project);
  }

  return project;
}

export async function listProjects(): Promise<Array<{ id: string; name: string; updatedAt: Date }>> {
  const records = await db.projects.orderBy('updatedAt').reverse().toArray();
  return records.map(r => ({
    id: r.id,
    name: r.name,
    updatedAt: r.updatedAt,
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
  return records.map(record => {
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

// Export / Import

// App version - MUST match package.json version
export const APP_VERSION = '0.1.0';

// === Cloud Sync Functions ===

// Get all local projects for batch sync
export async function getAllProjectsForSync(): Promise<Array<{
  localId: string;
  name: string;
  data: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
}>> {
  const records = await db.projects.toArray();
  return records.map(r => {
    const parsed = parseProjectRecord(r);
    const payload = toProjectPayload(parsed);
    return {
      localId: r.id,
      name: r.name,
      data: JSON.stringify(payload),
      createdAt: r.createdAt.getTime(),
      updatedAt: r.updatedAt.getTime(),
      schemaVersion: parsed.schemaVersion,
    };
  });
}

// Sync a single project from cloud to local
export async function syncProjectFromCloud(cloudProject: {
  localId: string;
  name: string;
  data: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
}): Promise<{ action: 'created' | 'updated' | 'skipped' }> {
  if (cloudProject.schemaVersion > CURRENT_SCHEMA_VERSION) {
    return { action: 'skipped' };
  }

  const existing = await db.projects.get(cloudProject.localId);
  const normalizedData = JSON.stringify({
    ...(JSON.parse(cloudProject.data) as Record<string, unknown>),
    schemaVersion: cloudProject.schemaVersion,
  });

  if (existing) {
    // Only update if cloud version is newer
    if (cloudProject.updatedAt > existing.updatedAt.getTime()) {
      await db.projects.put({
        id: cloudProject.localId,
        name: cloudProject.name,
        data: normalizedData,
        createdAt: new Date(cloudProject.createdAt),
        updatedAt: new Date(cloudProject.updatedAt),
      });
      return { action: 'updated' };
    }
    return { action: 'skipped' };
  } else {
    // Create new local project
    await db.projects.put({
      id: cloudProject.localId,
      name: cloudProject.name,
      data: normalizedData,
      createdAt: new Date(cloudProject.createdAt),
      updatedAt: new Date(cloudProject.updatedAt),
    });
    return { action: 'created' };
  }
}

// Get single project record for sync
export async function getProjectForSync(id: string): Promise<{
  localId: string;
  name: string;
  data: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number;
} | null> {
  const record = await db.projects.get(id);
  if (!record) return null;

  const parsed = parseProjectRecord(record);
  const payload = toProjectPayload(parsed);

  return {
    localId: record.id,
    name: record.name,
    data: JSON.stringify(payload),
    createdAt: record.createdAt.getTime(),
    updatedAt: record.updatedAt.getTime(),
    schemaVersion: parsed.schemaVersion,
  };
}

// Supported file types for backwards compatibility
const SUPPORTED_FILE_TYPES = ['pochacoding-project', 'phaserblockly-project'] as const;

export interface ExportedProject {
  schemaVersion: number;      // Schema version for migrations
  type: 'pochacoding-project';
  exportedAt: string;
  appVersion?: string;        // Optional: app version that created this file
  project: Project;
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

export async function importProject(jsonString: string): Promise<Project> {
  const data = JSON.parse(jsonString);

  // Validate format - support both old and new file types
  const fileType = data.type as string;
  if (!SUPPORTED_FILE_TYPES.includes(fileType as typeof SUPPORTED_FILE_TYPES[number])) {
    throw new Error('Invalid file format: not a PochaCoding project');
  }

  if (!data.project) {
    throw new Error('Invalid file format: missing project data');
  }

  // Handle schema version (default to 1 for old files without schemaVersion)
  const schemaVersion = data.schemaVersion ?? data.version ?? 1;

  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `This project was created with a newer version of PochaCoding (schema v${schemaVersion}). ` +
      `Please update the app to open this file.`
    );
  }

  // Migrate project if needed
  let project = data.project as Project;
  if (schemaVersion < CURRENT_SCHEMA_VERSION) {
    project = migrateProjectToCurrent({ ...project, schemaVersion }, schemaVersion);
  }

  // Generate new IDs to avoid conflicts with existing projects
  const newProjectId = crypto.randomUUID();
  const sceneIdMap = new Map<string, string>();
  const objectIdMap = new Map<string, string>();

  // Map old scene IDs to new ones
  for (const scene of project.scenes) {
    const newSceneId = crypto.randomUUID();
    sceneIdMap.set(scene.id, newSceneId);
    scene.id = newSceneId;

    // Map old object IDs to new ones
    for (const obj of scene.objects) {
      const newObjId = crypto.randomUUID();
      objectIdMap.set(obj.id, newObjId);
      obj.id = newObjId;

      // Generate new costume IDs
      for (const costume of obj.costumes) {
        costume.id = crypto.randomUUID();
      }

      // Generate new sound IDs
      for (const sound of obj.sounds) {
        sound.id = crypto.randomUUID();
      }
    }

    // Update camera follow target reference
    if (scene.cameraConfig.followTarget && objectIdMap.has(scene.cameraConfig.followTarget)) {
      scene.cameraConfig.followTarget = objectIdMap.get(scene.cameraConfig.followTarget)!;
    }
  }

  // Generate new variable IDs
  for (const variable of project.globalVariables) {
    variable.id = crypto.randomUUID();
  }

  // Create imported project with new ID
  const importedProject: Project = {
    ...project,
    id: newProjectId,
    name: `${project.name} (imported)`,
    createdAt: new Date(),
    updatedAt: new Date(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };

  // Save to database
  await saveProject(importedProject);

  return importedProject;
}

export async function importProjectFromFile(file: File): Promise<Project> {
  return new Promise((resolve, reject) => {
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
