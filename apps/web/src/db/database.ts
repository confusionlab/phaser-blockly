import Dexie, { type EntityTable } from 'dexie';
import type {
  CostumeEditorMode,
  CostumeVectorDocument,
  MessageDefinition,
  Project,
  ReusableObject,
} from '../types';
import {
  COMPONENT_ANY_PREFIX,
  MESSAGE_REFERENCE_BLOCKS,
  OBJECT_REFERENCE_BLOCKS,
  PICK_FROM_STAGE,
  SCENE_REFERENCE_BLOCKS,
  SOUND_REFERENCE_BLOCKS,
  TYPE_REFERENCE_BLOCKS,
  VALID_OBJECT_SPECIAL_VALUES,
  VARIABLE_REFERENCE_BLOCKS,
} from '@/lib/blocklyReferenceMaps';
import { normalizeVariableDefinition } from '@/lib/variableUtils';
import { normalizeProjectLayering } from '@/utils/layerTree';

// Current schema version - increment when project structure changes (see CLAUDE.md)
export const CURRENT_SCHEMA_VERSION = 6;

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
  contentHash?: string;
}

export type ProjectRevisionReason =
  | 'manual_checkpoint'
  | 'auto_checkpoint'
  | 'import'
  | 'restore'
  | 'edit_revision';

export type ProjectRevisionKind = 'snapshot' | 'delta';

interface ProjectRevisionRecord {
  id: string;
  projectId: string;
  parentRevisionId?: string;
  kind: ProjectRevisionKind;
  baseRevisionId: string;
  snapshotData?: string;
  patch?: string;
  contentHash: string;
  createdAt: Date;
  schemaVersion: number;
  appVersion?: string;
  reason: ProjectRevisionReason;
  checkpointName?: string;
  isCheckpoint: boolean;
  restoredFromRevisionId?: string;
}

export interface ProjectRevision {
  id: string;
  projectId: string;
  parentRevisionId: string | null;
  kind: ProjectRevisionKind;
  baseRevisionId: string;
  contentHash: string;
  createdAt: Date;
  schemaVersion: number;
  appVersion?: string;
  reason: ProjectRevisionReason;
  checkpointName: string | null;
  isCheckpoint: boolean;
  restoredFromRevisionId: string | null;
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

function normalizeCostumeEditorMode(mode: unknown): CostumeEditorMode {
  return mode === 'bitmap' ? 'bitmap' : 'vector';
}

function sanitizeVectorDocument(value: unknown): CostumeVectorDocument | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const maybe = value as { version?: unknown; fabricJson?: unknown };
  if (maybe.version !== 1 || typeof maybe.fabricJson !== 'string') {
    return undefined;
  }
  return {
    version: 1,
    fabricJson: maybe.fabricJson,
  };
}

function normalizeCostumeMetadataInProject(project: Project): Project {
  return {
    ...project,
    scenes: (project.scenes || []).map((scene) => ({
      ...scene,
      objects: (scene.objects || []).map((obj) => ({
        ...obj,
        costumes: (obj.costumes || []).map((costume) => ({
          ...costume,
          editorMode: normalizeCostumeEditorMode(costume.editorMode),
          vectorDocument: sanitizeVectorDocument(costume.vectorDocument),
        })),
      })),
    })),
    components: (project.components || []).map((component) => ({
      ...component,
      costumes: (component.costumes || []).map((costume) => ({
        ...costume,
        editorMode: normalizeCostumeEditorMode(costume.editorMode),
        vectorDocument: sanitizeVectorDocument(costume.vectorDocument),
      })),
    })),
  };
}

function normalizeMessagesInProject(project: Project): Project {
  const normalizedMessages: MessageDefinition[] = Array.isArray(project.messages)
    ? project.messages
        .filter((message): message is MessageDefinition => {
          return (
            typeof message?.id === 'string' &&
            message.id.trim().length > 0 &&
            typeof message?.name === 'string' &&
            message.name.trim().length > 0
          );
        })
        .map((message) => ({
          id: message.id.trim(),
          name: message.name.trim(),
        }))
    : [];

  return {
    ...project,
    messages: normalizedMessages,
  };
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

  project = normalizeMessagesInProject(project);
  project = normalizeCostumeMetadataInProject(project);
  project = normalizeProjectLayering(project);

  return {
    project,
    sourceSchemaVersion,
    migrated,
  };
}

function toProjectRecord(project: Project, updatedAt: Date = new Date()): ProjectRecord {
  const data = serializeProjectData(project);
  return {
    id: project.id,
    name: project.name,
    createdAt: new Date(project.createdAt),
    updatedAt,
    data,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    contentHash: computeContentHash(data),
  };
}

class GameMakerDatabase extends Dexie {
  projects!: EntityTable<ProjectRecord, 'id'>;
  projectRevisions!: EntityTable<ProjectRevisionRecord, 'id'>;
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

    this.version(3).stores({
      projects: 'id, name, createdAt, updatedAt, schemaVersion',
      projectRevisions:
        'id, projectId, createdAt, [projectId+createdAt], [projectId+isCheckpoint+createdAt], [projectId+reason+createdAt], [projectId+contentHash]',
      assets: 'id, name, type',
      reusables: 'id, name, createdAt, *tags',
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
  const revisions = await db.projectRevisions.where('projectId').equals(id).toArray();
  await db.transaction('rw', db.projectRevisions, async () => {
    await Promise.all(revisions.map((revision) => db.projectRevisions.delete(revision.id)));
  });
}

const HISTORY_START_DATE = new Date(0);
const HISTORY_END_DATE = new Date(8640000000000000);
const MAX_CHECKPOINT_NAME_LENGTH = 80;

type RevisionCreateOptions = {
  isCheckpoint?: boolean;
  checkpointName?: string;
  restoredFromRevisionId?: string;
};

function normalizeCheckpointName(name: string): string {
  return name.trim().slice(0, MAX_CHECKPOINT_NAME_LENGTH);
}

function toPublicRevision(record: ProjectRevisionRecord): ProjectRevision {
  return {
    id: record.id,
    projectId: record.projectId,
    parentRevisionId: record.parentRevisionId ?? null,
    kind: record.kind,
    baseRevisionId: record.baseRevisionId,
    contentHash: record.contentHash,
    createdAt: new Date(record.createdAt),
    schemaVersion: normalizeSchemaVersion(record.schemaVersion),
    appVersion: record.appVersion,
    reason: record.reason,
    checkpointName: record.checkpointName ?? null,
    isCheckpoint: record.isCheckpoint,
    restoredFromRevisionId: record.restoredFromRevisionId ?? null,
  };
}

async function getProjectRevisionsAscending(projectId: string): Promise<ProjectRevisionRecord[]> {
  return await db.projectRevisions
    .where('[projectId+createdAt]')
    .between([projectId, HISTORY_START_DATE], [projectId, HISTORY_END_DATE])
    .sortBy('createdAt');
}

async function getLatestRevision(projectId: string): Promise<ProjectRevisionRecord | null> {
  const latest = await db.projectRevisions
    .where('[projectId+createdAt]')
    .between([projectId, HISTORY_START_DATE], [projectId, HISTORY_END_DATE])
    .reverse()
    .first();
  return latest ?? null;
}

async function getLatestCheckpointRevision(projectId: string): Promise<ProjectRevisionRecord | null> {
  const candidates = await db.projectRevisions
    .where('[projectId+isCheckpoint+createdAt]')
    .between([projectId, true, HISTORY_START_DATE], [projectId, true, HISTORY_END_DATE])
    .reverse()
    .first();
  return candidates ?? null;
}

function buildRevisionData(project: Project): { serializedData: string; contentHash: string } {
  const serializedData = serializeProjectData(project);
  return {
    serializedData,
    contentHash: computeContentHash(serializedData),
  };
}

function parseRevisionProjectData(serializedData: string): Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'> {
  return JSON.parse(serializedData) as Omit<Project, 'id' | 'name' | 'createdAt' | 'updatedAt'>;
}

function formatRestoreTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
}

async function ensureUniqueProjectName(baseName: string): Promise<string> {
  const existing = await listProjects();
  const names = new Set(existing.map((project) => project.name));
  if (!names.has(baseName)) return baseName;

  let index = 2;
  while (names.has(`${baseName} (${index})`)) {
    index += 1;
  }
  return `${baseName} (${index})`;
}

export async function createRevision(
  project: Project,
  reason: ProjectRevisionReason,
  options: RevisionCreateOptions = {},
): Promise<ProjectRevision | null> {
  const { serializedData, contentHash } = buildRevisionData(project);
  const latestRevision = await getLatestRevision(project.id);
  if (reason !== 'manual_checkpoint' && reason !== 'restore' && latestRevision?.contentHash === contentHash) {
    return null;
  }

  const checkpointName = options.checkpointName ? normalizeCheckpointName(options.checkpointName) : undefined;
  const isCheckpoint = options.isCheckpoint ?? false;
  if (isCheckpoint && !checkpointName && reason === 'manual_checkpoint') {
    throw new Error('Checkpoint name is required for manual checkpoints.');
  }

  const revisionId = crypto.randomUUID();
  const record: ProjectRevisionRecord = {
    id: revisionId,
    projectId: project.id,
    parentRevisionId: latestRevision?.id,
    kind: 'snapshot',
    baseRevisionId: revisionId,
    snapshotData: serializedData,
    patch: undefined,
    contentHash,
    createdAt: new Date(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    reason,
    checkpointName,
    isCheckpoint,
    restoredFromRevisionId: options.restoredFromRevisionId,
  };

  await db.projectRevisions.put(record);
  return toPublicRevision(record);
}

export async function createManualCheckpoint(project: Project, checkpointName: string): Promise<ProjectRevision | null> {
  const normalizedName = normalizeCheckpointName(checkpointName);
  if (!normalizedName) {
    throw new Error('Checkpoint name cannot be empty.');
  }
  return await createRevision(project, 'manual_checkpoint', {
    isCheckpoint: true,
    checkpointName: normalizedName,
  });
}

export async function createAutoCheckpoint(project: Project): Promise<ProjectRevision | null> {
  const latestCheckpoint = await getLatestCheckpointRevision(project.id);
  const { contentHash } = buildRevisionData(project);
  if (latestCheckpoint?.contentHash === contentHash) {
    return null;
  }
  return await createRevision(project, 'auto_checkpoint', {
    isCheckpoint: true,
  });
}

export type ListProjectRevisionFilters = {
  manualCheckpointsOnly?: boolean;
};

export async function listProjectRevisions(
  projectId: string,
  filters: ListProjectRevisionFilters = {},
): Promise<ProjectRevision[]> {
  const revisions = await getProjectRevisionsAscending(projectId);
  const filtered = filters.manualCheckpointsOnly
    ? revisions.filter((revision) => revision.reason === 'manual_checkpoint')
    : revisions;
  return filtered
    .slice()
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .map(toPublicRevision);
}

export async function renameCheckpoint(
  projectId: string,
  revisionId: string,
  checkpointName: string,
): Promise<ProjectRevision> {
  const normalizedName = normalizeCheckpointName(checkpointName);
  if (!normalizedName) {
    throw new Error('Checkpoint name cannot be empty.');
  }

  const revision = await db.projectRevisions.get(revisionId);
  if (!revision || revision.projectId !== projectId) {
    throw new Error('Checkpoint not found.');
  }
  if (!revision.isCheckpoint) {
    throw new Error('Revision is not a checkpoint.');
  }

  const updated: ProjectRevisionRecord = {
    ...revision,
    checkpointName: normalizedName,
  };
  await db.projectRevisions.put(updated);
  return toPublicRevision(updated);
}

export async function restoreAsNewProject(projectId: string, revisionId: string): Promise<Project> {
  const sourceProject = await loadProject(projectId);
  if (!sourceProject) {
    throw new Error('Source project not found.');
  }

  const revisions = await getProjectRevisionsAscending(projectId);
  const targetIndex = revisions.findIndex((revision) => revision.id === revisionId);
  if (targetIndex < 0) {
    throw new Error('Revision not found.');
  }

  const targetRevision = revisions[targetIndex];
  if (!targetRevision.snapshotData) {
    throw new Error('Only snapshot revisions are currently restorable.');
  }

  const parsedData = parseRevisionProjectData(targetRevision.snapshotData);
  const restoreLabel = targetRevision.checkpointName
    ? targetRevision.checkpointName
    : formatRestoreTimestamp(new Date(targetRevision.createdAt));
  const desiredName = `${sourceProject.name} (Restored: ${restoreLabel})`;
  const uniqueName = await ensureUniqueProjectName(desiredName);
  const newProjectId = crypto.randomUUID();
  const now = new Date();

  const restoredProject: Project = {
    ...parsedData,
    id: newProjectId,
    name: uniqueName,
    createdAt: now,
    updatedAt: now,
  };

  await saveProject(restoredProject);

  const copiedRevisions = revisions.slice(0, targetIndex + 1);
  const revisionIdMap = new Map<string, string>();
  const newRevisionRecords: ProjectRevisionRecord[] = [];

  for (const revision of copiedRevisions) {
    const newRevisionId = crypto.randomUUID();
    revisionIdMap.set(revision.id, newRevisionId);
  }

  for (const revision of copiedRevisions) {
    const mappedId = revisionIdMap.get(revision.id);
    if (!mappedId) continue;
    const mappedParentId = revision.parentRevisionId ? revisionIdMap.get(revision.parentRevisionId) : undefined;
    const mappedBaseRevisionId = revisionIdMap.get(revision.baseRevisionId) ?? mappedId;
    const mappedRestoredFrom = revision.restoredFromRevisionId
      ? revisionIdMap.get(revision.restoredFromRevisionId)
      : undefined;

    newRevisionRecords.push({
      ...revision,
      id: mappedId,
      projectId: newProjectId,
      parentRevisionId: mappedParentId,
      baseRevisionId: mappedBaseRevisionId,
      restoredFromRevisionId: mappedRestoredFrom,
      createdAt: new Date(revision.createdAt),
    });
  }

  if (newRevisionRecords.length > 0) {
    await db.projectRevisions.bulkPut(newRevisionRecords);
  }

  await createRevision(restoredProject, 'restore', {
    restoredFromRevisionId: revisionIdMap.get(targetRevision.id) ?? undefined,
  });

  return restoredProject;
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
  contentHash: string;
}

export interface ProjectRevisionSyncPayload {
  localProjectId: string;
  revisionId: string;
  parentRevisionId?: string;
  kind: ProjectRevisionKind;
  baseRevisionId: string;
  data: string;
  contentHash: string;
  createdAt: number;
  schemaVersion: number;
  appVersion?: string;
  reason: ProjectRevisionReason;
  checkpointName?: string;
  isCheckpoint: boolean;
  restoredFromRevisionId?: string;
}

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const FNV64_MASK = 0xffffffffffffffffn;

function computeContentHash(data: string): string {
  let hash = FNV64_OFFSET;
  for (let i = 0; i < data.length; i += 1) {
    hash ^= BigInt(data.charCodeAt(i));
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
  }
  return hash.toString(16).padStart(16, '0');
}

function normalizeContentHash(hash: unknown): string | null {
  if (typeof hash !== 'string') {
    return null;
  }

  const normalized = hash.trim().toLowerCase();
  return /^[0-9a-f]{16}$/.test(normalized) ? normalized : null;
}

function chooseIncomingByTieBreak(incomingHash: string | null, existingHash: string | null): boolean {
  if (!incomingHash || !existingHash) {
    return false;
  }

  return incomingHash > existingHash;
}

async function preserveLocalConflictCopy(existing: ProjectRecord, existingHash: string): Promise<void> {
  const suffix = existingHash.slice(0, 8);
  const conflictId = `${existing.id}-conflict-${suffix}`;
  const alreadyExists = await db.projects.get(conflictId);
  if (alreadyExists) {
    return;
  }

  const timestampLabel = new Date().toISOString().replace('T', ' ').slice(0, 16);
  await db.projects.put({
    ...existing,
    id: conflictId,
    name: `${existing.name} (Conflict ${timestampLabel})`,
    createdAt: new Date(existing.createdAt),
    updatedAt: new Date(),
    contentHash: existingHash,
  });
}

export function createProjectSyncPayload(project: Project): ProjectSyncPayload {
  const data = serializeProjectData(project);
  return {
    localId: project.id,
    name: project.name,
    data,
    createdAt: project.createdAt.getTime(),
    updatedAt: project.updatedAt.getTime(),
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    contentHash: computeContentHash(data),
  };
}

function recordToSyncPayload(record: ProjectRecord): ProjectSyncPayload {
  const contentHash = normalizeContentHash(record.contentHash) ?? computeContentHash(record.data);
  return {
    localId: record.id,
    name: record.name,
    data: record.data,
    createdAt: record.createdAt.getTime(),
    updatedAt: record.updatedAt.getTime(),
    schemaVersion: normalizeSchemaVersion(record.schemaVersion),
    appVersion: record.appVersion ?? APP_VERSION,
    contentHash,
  };
}

function revisionRecordToSyncPayload(record: ProjectRevisionRecord): ProjectRevisionSyncPayload {
  const data = record.snapshotData ?? record.patch ?? '';
  return {
    localProjectId: record.projectId,
    revisionId: record.id,
    parentRevisionId: record.parentRevisionId,
    kind: record.kind,
    baseRevisionId: record.baseRevisionId,
    data,
    contentHash: normalizeContentHash(record.contentHash) ?? computeContentHash(data),
    createdAt: record.createdAt.getTime(),
    schemaVersion: normalizeSchemaVersion(record.schemaVersion),
    appVersion: record.appVersion ?? APP_VERSION,
    reason: record.reason,
    checkpointName: record.checkpointName,
    isCheckpoint: record.isCheckpoint,
    restoredFromRevisionId: record.restoredFromRevisionId,
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

export async function getProjectRevisionsForSync(projectId: string): Promise<ProjectRevisionSyncPayload[]> {
  const revisions = await getProjectRevisionsAscending(projectId);
  return revisions.map(revisionRecordToSyncPayload);
}

export async function pruneLocalProjectsNotInCloud(cloudLocalIds: string[]): Promise<{ deleted: number }> {
  const cloudIdSet = new Set(cloudLocalIds);
  const localRecords = await db.projects.toArray();
  const isConflictCopyId = (id: string) => /-conflict-[0-9a-f]{8}$/i.test(id);
  const localOnlyIds = localRecords
    .map((record) => record.id)
    .filter((localId) => !cloudIdSet.has(localId) && !isConflictCopyId(localId));

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
  contentHash?: string;
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

  incomingProject = normalizeMessagesInProject(incomingProject);

  const serializedIncomingData = serializeProjectData(incomingProject);
  const incomingRecord: ProjectRecord = {
    id: incomingProject.id,
    name: incomingProject.name,
    data: serializedIncomingData,
    createdAt: new Date(cloudProject.createdAt),
    updatedAt: new Date(incomingProject.updatedAt),
    schemaVersion: migrated ? CURRENT_SCHEMA_VERSION : cloudSchemaVersion,
    appVersion: cloudProject.appVersion,
    contentHash: normalizeContentHash(cloudProject.contentHash) ?? computeContentHash(serializedIncomingData),
  };

  const existing = await db.projects.get(cloudProject.localId);

  if (!existing) {
    await db.projects.put(incomingRecord);
    return { action: 'created', migrated };
  }

  const existingSchemaVersion = normalizeSchemaVersion(existing.schemaVersion);
  if (incomingRecord.schemaVersion < existingSchemaVersion) {
    return {
      action: 'skipped',
      reason: `schema downgrade blocked (incoming v${incomingRecord.schemaVersion}, local v${existingSchemaVersion})`,
    };
  }

  const incomingUpdatedAtMs = incomingRecord.updatedAt.getTime();
  const existingUpdatedAtMs = existing.updatedAt.getTime();
  let shouldUpdate = false;
  let reason: string | undefined;

  if (incomingRecord.schemaVersion > existingSchemaVersion) {
    shouldUpdate = true;
    reason = 'incoming schema is newer';
  } else if (incomingUpdatedAtMs > existingUpdatedAtMs) {
    shouldUpdate = true;
    reason = 'incoming project is newer';
  } else if (incomingUpdatedAtMs < existingUpdatedAtMs) {
    shouldUpdate = false;
    reason = 'local project is newer';
  } else {
    const incomingHash =
      normalizeContentHash(incomingRecord.contentHash) ?? computeContentHash(incomingRecord.data);
    const existingHash =
      normalizeContentHash(existing.contentHash) ?? computeContentHash(existing.data);

    if (incomingHash === existingHash) {
      shouldUpdate = false;
      reason = 'same timestamp and identical content';
    } else {
      const incomingWins = chooseIncomingByTieBreak(incomingHash, existingHash);
      shouldUpdate = incomingWins;
      reason = incomingWins
        ? 'same timestamp conflict resolved in favor of incoming hash'
        : 'same timestamp conflict resolved in favor of local hash';

      if (incomingWins) {
        await preserveLocalConflictCopy(existing, existingHash);
      }
    }
  }

  if (!shouldUpdate) {
    return { action: 'skipped', reason };
  }

  await db.projects.put(incomingRecord);
  return { action: 'updated', migrated, reason };
}

export async function syncProjectRevisionsFromCloud(
  projectId: string,
  cloudRevisions: ProjectRevisionSyncPayload[],
): Promise<{ created: number; updated: number; skipped: number }> {
  const projectExists = await db.projects.get(projectId);
  if (!projectExists) {
    return { created: 0, updated: 0, skipped: cloudRevisions.length };
  }

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const payload of cloudRevisions) {
    if (payload.localProjectId !== projectId) {
      skipped += 1;
      continue;
    }

    const incomingKind: ProjectRevisionKind = payload.kind === 'delta' ? 'delta' : 'snapshot';
    const incomingReason: ProjectRevisionReason = (
      ['manual_checkpoint', 'auto_checkpoint', 'import', 'restore', 'edit_revision'] as ProjectRevisionReason[]
    ).includes(payload.reason)
      ? payload.reason
      : 'edit_revision';

    const incomingRecord: ProjectRevisionRecord = {
      id: payload.revisionId,
      projectId: payload.localProjectId,
      parentRevisionId: payload.parentRevisionId,
      kind: incomingKind,
      baseRevisionId: payload.baseRevisionId,
      snapshotData: incomingKind === 'snapshot' ? payload.data : undefined,
      patch: incomingKind === 'delta' ? payload.data : undefined,
      contentHash: normalizeContentHash(payload.contentHash) ?? computeContentHash(payload.data),
      createdAt: new Date(payload.createdAt),
      schemaVersion: normalizeSchemaVersion(payload.schemaVersion),
      appVersion: payload.appVersion,
      reason: incomingReason,
      checkpointName: payload.checkpointName ? normalizeCheckpointName(payload.checkpointName) : undefined,
      isCheckpoint: Boolean(payload.isCheckpoint),
      restoredFromRevisionId: payload.restoredFromRevisionId,
    };

    const existing = await db.projectRevisions.get(incomingRecord.id);
    if (!existing) {
      await db.projectRevisions.put(incomingRecord);
      created += 1;
      continue;
    }

    if (existing.projectId !== projectId) {
      skipped += 1;
      continue;
    }

    const shouldUpdate =
      incomingRecord.createdAt.getTime() > existing.createdAt.getTime() ||
      (incomingRecord.createdAt.getTime() === existing.createdAt.getTime() &&
        (incomingRecord.contentHash !== existing.contentHash ||
          incomingRecord.checkpointName !== existing.checkpointName ||
          incomingRecord.reason !== existing.reason ||
          incomingRecord.isCheckpoint !== existing.isCheckpoint));

    if (!shouldUpdate) {
      skipped += 1;
      continue;
    }

    await db.projectRevisions.put(incomingRecord);
    updated += 1;
  }

  return { created, updated, skipped };
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

function remapLegacySceneNameRefsInBlocklyXml(
  blocklyXml: string,
  sceneNameToId: Map<string, string>,
  sceneIds: Set<string>
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
      if ((block.getAttribute('type') || '') !== 'control_switch_scene') continue;

      const fields = Array.from(block.children).filter(
        (child): child is Element =>
          child.tagName.toLowerCase() === 'field' &&
          child.getAttribute('name') === 'SCENE'
      );

      for (const field of fields) {
        const currentValue = (field.textContent || '').trim();
        if (!currentValue || sceneIds.has(currentValue)) {
          continue;
        }

        const remappedId = sceneNameToId.get(currentValue);
        if (remappedId && remappedId !== currentValue) {
          field.textContent = remappedId;
          changed = true;
        }
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

function normalizeMessageName(name: unknown): string {
  return typeof name === 'string' ? name.trim() : '';
}

function remapLegacyMessageRefsInBlocklyXml(
  blocklyXml: string,
  messageIdSet: Set<string>,
  messageNameToId: Map<string, string>,
  ensureMessageIdForName: (name: string) => string,
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
      const messageFieldName = MESSAGE_REFERENCE_BLOCKS[blockType];
      if (!messageFieldName) continue;

      const fields = Array.from(block.children).filter(
        (child): child is Element =>
          child.tagName.toLowerCase() === 'field' &&
          child.getAttribute('name') === messageFieldName,
      );

      for (const field of fields) {
        const currentValue = (field.textContent || '').trim();
        if (!currentValue || messageIdSet.has(currentValue)) {
          continue;
        }

        const messageId = messageNameToId.get(currentValue) || ensureMessageIdForName(currentValue);
        if (messageId && messageId !== currentValue) {
          field.textContent = messageId;
          changed = true;
        }
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

const migrations: Record<number, MigrationFn> = {
  // v2: Ensure basic scene defaults for older files.
  2: (project) => {
    const scenes = Array.isArray(project.scenes) ? project.scenes : [];
    return {
      ...project,
      scenes: scenes.map((scene) => ({
        ...scene,
        objectFolders: Array.isArray(scene.objectFolders) ? scene.objectFolders : [],
        cameraConfig: scene.cameraConfig ?? {
          followTarget: null,
          bounds: null,
          zoom: 1,
        },
      })),
      components: Array.isArray(project.components) ? project.components : [],
      globalVariables: Array.isArray(project.globalVariables) ? project.globalVariables : [],
      messages: Array.isArray(project.messages) ? project.messages : [],
      schemaVersion: 2,
    };
  },
  // v3: Normalize robust layer tree structure (parentId/order).
  3: (project) => ({
    ...normalizeProjectLayering(project),
    schemaVersion: 3,
  }),
  // v4: Add costume editor metadata defaults.
  4: (project) => ({
    ...project,
    scenes: (project.scenes || []).map((scene) => ({
      ...scene,
      objects: (scene.objects || []).map((obj) => ({
        ...obj,
        costumes: (obj.costumes || []).map((costume) => ({
          ...costume,
          editorMode: normalizeCostumeEditorMode(costume.editorMode),
          vectorDocument: sanitizeVectorDocument(costume.vectorDocument),
        })),
      })),
    })),
    components: (project.components || []).map((component) => ({
      ...component,
      costumes: (component.costumes || []).map((costume) => ({
        ...costume,
        editorMode: normalizeCostumeEditorMode(costume.editorMode),
        vectorDocument: sanitizeVectorDocument(costume.vectorDocument),
      })),
    })),
    schemaVersion: 4,
  }),
  // v5: Migrate legacy scene-name references in Blockly "switch scene" blocks to scene IDs.
  5: (project) => {
    const scenes = Array.isArray(project.scenes) ? project.scenes : [];
    const countsByName = new Map<string, number>();
    for (const scene of scenes) {
      const name = typeof scene.name === 'string' ? scene.name.trim() : '';
      if (!name) continue;
      countsByName.set(name, (countsByName.get(name) || 0) + 1);
    }

    const sceneNameToId = new Map<string, string>();
    for (const scene of scenes) {
      const name = typeof scene.name === 'string' ? scene.name.trim() : '';
      if (!name) continue;
      if ((countsByName.get(name) || 0) !== 1) continue;
      sceneNameToId.set(name, scene.id);
    }
    const sceneIds = new Set(scenes.map((scene) => scene.id));

    return {
      ...project,
      scenes: scenes.map((scene) => ({
        ...scene,
        objects: (scene.objects || []).map((obj) => ({
          ...obj,
          blocklyXml: remapLegacySceneNameRefsInBlocklyXml(
            obj.blocklyXml || '',
            sceneNameToId,
            sceneIds,
          ),
        })),
      })),
      components: (project.components || []).map((component) => ({
        ...component,
        blocklyXml: remapLegacySceneNameRefsInBlocklyXml(
          component.blocklyXml || '',
          sceneNameToId,
          sceneIds,
        ),
      })),
      schemaVersion: 5,
    };
  },
  // v6: Migrate message fields from free-text names to stable message IDs.
  6: (project) => {
    const scenes = Array.isArray(project.scenes) ? project.scenes : [];
    const components = Array.isArray(project.components) ? project.components : [];
    const existingMessages = Array.isArray(project.messages) ? project.messages : [];

    const messages: MessageDefinition[] = [];
    const messageIdSet = new Set<string>();
    const messageNameToId = new Map<string, string>();

    for (const maybeMessage of existingMessages) {
      const name = normalizeMessageName(maybeMessage?.name);
      if (!name) continue;

      let id = readValidId(maybeMessage?.id) || crypto.randomUUID();
      while (messageIdSet.has(id)) {
        id = crypto.randomUUID();
      }

      messages.push({ id, name });
      messageIdSet.add(id);
      if (!messageNameToId.has(name)) {
        messageNameToId.set(name, id);
      }
    }

    const ensureMessageIdForName = (rawName: string): string => {
      const normalizedName = normalizeMessageName(rawName);
      if (!normalizedName) {
        return '';
      }
      const existingId = messageNameToId.get(normalizedName);
      if (existingId) {
        return existingId;
      }

      let id = crypto.randomUUID();
      while (messageIdSet.has(id)) {
        id = crypto.randomUUID();
      }

      messages.push({ id, name: normalizedName });
      messageIdSet.add(id);
      messageNameToId.set(normalizedName, id);
      return id;
    };

    return {
      ...project,
      scenes: scenes.map((scene) => ({
        ...scene,
        objects: (scene.objects || []).map((obj) => ({
          ...obj,
          blocklyXml: remapLegacyMessageRefsInBlocklyXml(
            obj.blocklyXml || '',
            messageIdSet,
            messageNameToId,
            ensureMessageIdForName,
          ),
        })),
      })),
      components: components.map((component) => ({
        ...component,
        blocklyXml: remapLegacyMessageRefsInBlocklyXml(
          component.blocklyXml || '',
          messageIdSet,
          messageNameToId,
          ensureMessageIdForName,
        ),
      })),
      messages,
      schemaVersion: 6,
    };
  },
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

interface ImportReferenceMaps {
  objectIds: Map<string, string>;
  variableIds: Map<string, string>;
  soundIds: Map<string, string>;
  messageIds: Map<string, string>;
  componentIds: Map<string, string>;
  sceneIds: Map<string, string>;
}

interface ImportReferenceFallbacks {
  objectNameToId?: Map<string, string>;
  variableNameToId?: Map<string, string>;
  soundNameToId?: Map<string, string>;
  messageNameToId?: Map<string, string>;
  sceneNameToId?: Map<string, string>;
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

function remapTypeReference(rawValue: string, maps: ImportReferenceMaps): string {
  const value = rawValue.trim();
  if (!value) return rawValue;
  if (!value.startsWith('component:')) return rawValue;
  const componentId = value.slice('component:'.length);
  const remappedComponentId = maps.componentIds.get(componentId);
  return remappedComponentId ? `component:${remappedComponentId}` : rawValue;
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

      const messageFieldName = MESSAGE_REFERENCE_BLOCKS[blockType];
      if (messageFieldName) {
        updateField(messageFieldName, (value) =>
          remapIdOrNameReference(value, maps.messageIds, fallbacks.messageNameToId)
        );
      }

      const sceneFieldName = SCENE_REFERENCE_BLOCKS[blockType];
      if (sceneFieldName) {
        updateField(sceneFieldName, (value) =>
          remapIdOrNameReference(value, maps.sceneIds, fallbacks.sceneNameToId)
        );
      }

      const typeFieldName = TYPE_REFERENCE_BLOCKS[blockType];
      if (typeFieldName) {
        updateField(typeFieldName, (value) => remapTypeReference(value, maps));
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
  project.messages = Array.isArray(project.messages) ? project.messages : [];
  project = normalizeCostumeMetadataInProject(project);

  // Generate new IDs to avoid collisions and keep imported data isolated.
  const objectIdMap = new Map<string, string>();
  const variableIdMap = new Map<string, string>();
  const soundIdMap = new Map<string, string>();
  const messageIdMap = new Map<string, string>();
  const componentIdMap = new Map<string, string>();
  const sceneIdMap = new Map<string, string>();

  for (const message of project.messages) {
    const newMessageId = crypto.randomUUID();
    rememberIdMapping(messageIdMap, message.id, newMessageId);
    message.id = newMessageId;
    const normalizedName = normalizeMessageName(message.name);
    message.name = normalizedName || 'message';
  }

  // Remap component IDs first so object.componentId references can be updated.
  for (const component of project.components) {
    const newComponentId = crypto.randomUUID();
    rememberIdMapping(componentIdMap, component.id, newComponentId);
    component.id = newComponentId;

    component.costumes = Array.isArray(component.costumes) ? component.costumes : [];
    component.sounds = Array.isArray(component.sounds) ? component.sounds : [];
    component.localVariables = Array.isArray(component.localVariables) ? component.localVariables : [];

    for (const costume of component.costumes) {
      costume.id = crypto.randomUUID();
      costume.editorMode = normalizeCostumeEditorMode(costume.editorMode);
      costume.vectorDocument = sanitizeVectorDocument(costume.vectorDocument);
    }

    for (const sound of component.sounds) {
      const newSoundId = crypto.randomUUID();
      rememberIdMapping(soundIdMap, sound.id, newSoundId);
      sound.id = newSoundId;
    }

    for (const variable of component.localVariables) {
      const existingVariableId = readValidId(variable.id);
      const remappedVariableId = existingVariableId ? variableIdMap.get(existingVariableId) : undefined;
      const newVariableId = remappedVariableId || crypto.randomUUID();
      if (!remappedVariableId) {
        rememberIdMapping(variableIdMap, variable.id, newVariableId);
      }
      const normalizedVariable = normalizeVariableDefinition(
        { ...variable, id: newVariableId },
        { scope: 'local' },
      );
      Object.assign(variable, normalizedVariable);
      delete variable.objectId;
    }
  }

  // Remap variable IDs (global + local) and wire local ownership.
  for (const variable of project.globalVariables) {
    const newVariableId = crypto.randomUUID();
    rememberIdMapping(variableIdMap, variable.id, newVariableId);
    const normalizedVariable = normalizeVariableDefinition(
      { ...variable, id: newVariableId },
      { scope: 'global' },
    );
    Object.assign(variable, normalizedVariable);
  }

  for (const scene of project.scenes) {
    const newSceneId = crypto.randomUUID();
    rememberIdMapping(sceneIdMap, scene.id, newSceneId);
    scene.id = newSceneId;
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
      if (obj.componentId && obj.localVariables.length === 0) {
        const componentLocalVariables = project.components.find((component) => component.id === obj.componentId)?.localVariables || [];
        if (componentLocalVariables.length > 0) {
          obj.localVariables = componentLocalVariables.map((variable) => ({ ...variable }));
        }
      }

      for (const costume of obj.costumes) {
        costume.id = crypto.randomUUID();
        costume.editorMode = normalizeCostumeEditorMode(costume.editorMode);
        costume.vectorDocument = sanitizeVectorDocument(costume.vectorDocument);
      }

      for (const sound of obj.sounds) {
        const newSoundId = crypto.randomUUID();
        rememberIdMapping(soundIdMap, sound.id, newSoundId);
        sound.id = newSoundId;
      }

      for (const variable of obj.localVariables) {
        const existingVariableId = readValidId(variable.id);
        const remappedVariableId = existingVariableId ? variableIdMap.get(existingVariableId) : undefined;
        const newVariableId = remappedVariableId || crypto.randomUUID();
        if (!remappedVariableId) {
          rememberIdMapping(variableIdMap, variable.id, newVariableId);
        }
        const normalizedVariable = normalizeVariableDefinition(
          { ...variable, id: newVariableId },
          { scope: 'local', objectId: obj.id },
        );
        Object.assign(variable, normalizedVariable);
      }
    }
  }

  const referenceMaps: ImportReferenceMaps = {
    objectIds: objectIdMap,
    variableIds: variableIdMap,
    soundIds: soundIdMap,
    messageIds: messageIdMap,
    componentIds: componentIdMap,
    sceneIds: sceneIdMap,
  };

  const globalObjectNameToId = createUniqueNameIdMap(
    project.scenes.flatMap((scene) => scene.objects.map((obj) => ({ name: obj.name, id: obj.id })))
  );
  const globalSceneNameToId = createUniqueNameIdMap(
    project.scenes.map((scene) => ({ name: scene.name, id: scene.id }))
  );
  const globalVariableNameToId = createUniqueNameIdMap(
    project.globalVariables.map((variable) => ({ name: variable.name, id: variable.id }))
  );
  const globalMessageNameToId = createUniqueNameIdMap(
    project.messages.map((message) => ({ name: message.name, id: message.id }))
  );

  for (const scene of project.scenes) {
    const sceneObjectNameToId = createUniqueNameIdMap(
      scene.objects.map((obj) => ({ name: obj.name, id: obj.id }))
    );

    scene.cameraConfig.followTarget = scene.cameraConfig.followTarget
      ? remapObjectReference(scene.cameraConfig.followTarget, referenceMaps, sceneObjectNameToId)
      : null;

    for (const obj of scene.objects) {
      const componentLocalVariables = obj.componentId
        ? project.components.find((component) => component.id === obj.componentId)?.localVariables || []
        : [];
      const effectiveLocalVariables = componentLocalVariables.length > 0
        ? componentLocalVariables
        : obj.localVariables;
      const localVariableNameToId = createUniqueNameIdMap(
        effectiveLocalVariables.map((variable) => ({ name: variable.name, id: variable.id }))
      );
      const combinedVariableNameToId = createUniqueNameIdMap([
        ...project.globalVariables.map((variable) => ({ name: variable.name, id: variable.id })),
        ...effectiveLocalVariables.map((variable) => ({ name: variable.name, id: variable.id })),
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
        messageNameToId: globalMessageNameToId,
        sceneNameToId: globalSceneNameToId,
      });
    }
  }

  for (const component of project.components) {
    const componentVariableNameToId = createUniqueNameIdMap([
      ...project.globalVariables.map((variable) => ({ name: variable.name, id: variable.id })),
      ...(component.localVariables || []).map((variable) => ({ name: variable.name, id: variable.id })),
    ]);
    const componentSoundNameToId = createUniqueNameIdMap(
      component.sounds.map((sound) => ({ name: sound.name, id: sound.id }))
    );

    component.blocklyXml = remapBlocklyXmlReferences(component.blocklyXml || '', referenceMaps, {
      objectNameToId: globalObjectNameToId,
      variableNameToId: componentVariableNameToId.size > 0 ? componentVariableNameToId : globalVariableNameToId,
      soundNameToId: componentSoundNameToId,
      messageNameToId: globalMessageNameToId,
      sceneNameToId: globalSceneNameToId,
    });
  }

  const newProjectId = crypto.randomUUID();

  const importedProject: Project = {
    ...normalizeProjectLayering(project),
    id: newProjectId,
    name: `${project.name} (imported)`,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  await saveProject(importedProject);
  await createRevision(importedProject, 'import');

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
