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

// Project Repository

export async function saveProject(project: Project): Promise<void> {
  const { id, name, createdAt, updatedAt: _updatedAt, ...rest } = project;
  await db.projects.put({
    id,
    name,
    createdAt,
    updatedAt: new Date(),
    data: JSON.stringify(rest),
  });
}

export async function loadProject(id: string): Promise<Project | null> {
  const record = await db.projects.get(id);
  if (!record) return null;

  const data = JSON.parse(record.data);
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    ...data,
  };
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

// Current schema version - increment when project structure changes
export const CURRENT_SCHEMA_VERSION = 1;

// Supported file types for backwards compatibility
const SUPPORTED_FILE_TYPES = ['pochacoding-project', 'phaserblockly-project'] as const;

export interface ExportedProject {
  schemaVersion: number;      // Schema version for migrations
  type: 'pochacoding-project';
  exportedAt: string;
  appVersion?: string;        // Optional: app version that created this file
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
    appVersion: '1.0.0', // Update this when releasing new versions
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
    project = migrateProject(project, schemaVersion);
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
