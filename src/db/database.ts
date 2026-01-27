import Dexie, { type EntityTable } from 'dexie';
import type { Project, Asset, ReusableObject } from '../types';

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
    super('PhaserBlocklyDB');

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
  const { id, name, createdAt, updatedAt, ...rest } = project;
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

// Asset Repository

export async function saveAsset(asset: Asset): Promise<void> {
  await db.assets.put(asset);
}

export async function loadAsset(id: string): Promise<Asset | null> {
  return await db.assets.get(id) ?? null;
}

export async function listAssets(type?: Asset['type']): Promise<Asset[]> {
  if (type) {
    return await db.assets.where('type').equals(type).toArray();
  }
  return await db.assets.toArray();
}

export async function deleteAsset(id: string): Promise<void> {
  await db.assets.delete(id);
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
