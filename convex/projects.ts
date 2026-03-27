import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { SCHEMA_VERSION } from "./schema";

const schemaVersionValidator = v.union(v.number(), v.string());
const managedAssetIdsValidator = v.array(v.string());
const MANAGED_ASSET_ID_PATTERN = /^asset:[0-9a-f]{64}$/i;
const PROJECT_ASSET_GC_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

const projectSummaryValidator = v.object({
  _id: v.id("projects"),
  localId: v.string(),
  name: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  schemaVersion: v.number(),
  appVersion: v.optional(v.string()),
  contentHash: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  dataSizeBytes: v.optional(v.number()),
  assetIds: v.optional(managedAssetIdsValidator),
});

const fullProjectValidator = v.object({
  localId: v.string(),
  name: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  schemaVersion: v.number(),
  appVersion: v.optional(v.string()),
  contentHash: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  dataSizeBytes: v.optional(v.number()),
  assetIds: v.optional(managedAssetIdsValidator),
  data: v.optional(v.string()),
  dataUrl: v.union(v.string(), v.null()),
});

const syncResultValidator = v.object({
  action: v.union(v.literal("created"), v.literal("updated"), v.literal("skipped")),
  id: v.id("projects"),
  reason: v.optional(v.string()),
});

const syncBatchResultValidator = v.object({
  localId: v.string(),
  action: v.union(v.literal("created"), v.literal("updated"), v.literal("skipped")),
  reason: v.optional(v.string()),
});

const syncMetadataValidator = v.object({
  localId: v.string(),
  updatedAt: v.number(),
  schemaVersion: v.optional(schemaVersionValidator),
  contentHash: v.optional(v.string()),
});

const syncPayloadValidator = v.object({
  localId: v.string(),
  name: v.string(),
  storageId: v.optional(v.id("_storage")),
  // Kept optional for backwards compatibility with older clients.
  data: v.optional(v.string()),
  dataSizeBytes: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  schemaVersion: v.optional(schemaVersionValidator),
  appVersion: v.optional(v.string()),
  contentHash: v.optional(v.string()),
  assetIds: v.optional(managedAssetIdsValidator),
});

const revisionReasonValidator = v.union(
  v.literal("manual_checkpoint"),
  v.literal("auto_checkpoint"),
  v.literal("import"),
  v.literal("restore"),
  v.literal("edit_revision"),
);

const revisionSyncMetadataValidator = v.object({
  revisionId: v.string(),
  createdAt: v.number(),
  schemaVersion: v.optional(schemaVersionValidator),
  contentHash: v.optional(v.string()),
  reason: revisionReasonValidator,
  checkpointName: v.optional(v.string()),
  isCheckpoint: v.boolean(),
});

const revisionSyncPayloadValidator = v.object({
  localProjectId: v.string(),
  revisionId: v.string(),
  parentRevisionId: v.optional(v.string()),
  kind: v.union(v.literal("snapshot"), v.literal("delta")),
  baseRevisionId: v.string(),
  storageId: v.optional(v.id("_storage")),
  // Kept optional for backward compatibility with inline payload clients.
  data: v.optional(v.string()),
  dataSizeBytes: v.optional(v.number()),
  contentHash: v.optional(v.string()),
  createdAt: v.number(),
  schemaVersion: v.optional(schemaVersionValidator),
  appVersion: v.optional(v.string()),
  reason: revisionReasonValidator,
  checkpointName: v.optional(v.string()),
  isCheckpoint: v.boolean(),
  restoredFromRevisionId: v.optional(v.string()),
  assetIds: v.optional(managedAssetIdsValidator),
});

const revisionSummaryValidator = v.object({
  projectLocalId: v.string(),
  revisionId: v.string(),
  parentRevisionId: v.optional(v.string()),
  kind: v.union(v.literal("snapshot"), v.literal("delta")),
  baseRevisionId: v.string(),
  storageId: v.optional(v.id("_storage")),
  dataSizeBytes: v.optional(v.number()),
  contentHash: v.string(),
  createdAt: v.number(),
  schemaVersion: v.number(),
  appVersion: v.optional(v.string()),
  reason: revisionReasonValidator,
  checkpointName: v.optional(v.string()),
  isCheckpoint: v.boolean(),
  restoredFromRevisionId: v.optional(v.string()),
  assetIds: v.optional(managedAssetIdsValidator),
  data: v.optional(v.string()),
  dataUrl: v.union(v.string(), v.null()),
});

const projectSyncPlanValidator = v.object({
  action: v.union(v.literal("upload"), v.literal("skip"), v.literal("pull")),
  reason: v.string(),
});

const revisionSyncPlanValidator = v.object({
  revisionId: v.string(),
  action: v.union(v.literal("upload"), v.literal("skip")),
  reason: v.string(),
});

const syncPlanResultValidator = v.object({
  project: projectSyncPlanValidator,
  revisions: v.array(revisionSyncPlanValidator),
});

type StoredProject = {
  _id: Id<"projects">;
  ownerUserId?: string;
  localId: string;
  name: string;
  storageId?: Id<"_storage">;
  data?: string;
  dataSizeBytes?: number;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number | string;
  appVersion?: string;
  contentHash?: string;
  assetIds?: string[];
};

type SyncPayload = {
  localId: string;
  name: string;
  storageId?: Id<"_storage">;
  data?: string;
  dataSizeBytes?: number;
  createdAt: number;
  updatedAt: number;
  schemaVersion?: number | string;
  appVersion?: string;
  contentHash?: string;
  assetIds?: string[];
};

type SyncMetadata = {
  localId: string;
  updatedAt: number;
  schemaVersion?: number | string;
  contentHash?: string;
};

async function requireAuthenticatedUserId(ctx: any): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("unauthenticated");
  }
  return identity.subject;
}

type StoredProjectRevision = {
  _id: Id<"projectRevisions">;
  ownerUserId?: string;
  projectLocalId: string;
  revisionId: string;
  parentRevisionId?: string;
  kind: "snapshot" | "delta";
  baseRevisionId: string;
  storageId?: Id<"_storage">;
  data?: string;
  dataSizeBytes?: number;
  contentHash: string;
  createdAt: number;
  schemaVersion: number | string;
  appVersion?: string;
  reason: "manual_checkpoint" | "auto_checkpoint" | "import" | "restore" | "edit_revision";
  checkpointName?: string;
  isCheckpoint: boolean;
  restoredFromRevisionId?: string;
  assetIds?: string[];
};

type RevisionSyncPayload = {
  localProjectId: string;
  ownerUserId?: string;
  revisionId: string;
  parentRevisionId?: string;
  kind: "snapshot" | "delta";
  baseRevisionId: string;
  storageId?: Id<"_storage">;
  data?: string;
  dataSizeBytes?: number;
  contentHash?: string;
  createdAt: number;
  schemaVersion?: number | string;
  appVersion?: string;
  reason: "manual_checkpoint" | "auto_checkpoint" | "import" | "restore" | "edit_revision";
  checkpointName?: string;
  isCheckpoint: boolean;
  restoredFromRevisionId?: string;
  assetIds?: string[];
};

type RevisionSyncMetadata = {
  revisionId: string;
  createdAt: number;
  schemaVersion?: number | string;
  contentHash?: string;
  reason: "manual_checkpoint" | "auto_checkpoint" | "import" | "restore" | "edit_revision";
  checkpointName?: string;
  isCheckpoint: boolean;
};

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const FNV64_MASK = 0xffffffffffffffffn;

function computeContentHash(data: string): string {
  let hash = FNV64_OFFSET;
  for (let i = 0; i < data.length; i += 1) {
    hash ^= BigInt(data.charCodeAt(i));
    hash = (hash * FNV64_PRIME) & FNV64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

function normalizeContentHash(hash: unknown): string | null {
  if (typeof hash !== "string") {
    return null;
  }

  const normalized = hash.trim().toLowerCase();
  return /^[0-9a-f]{16}$/.test(normalized) ? normalized : null;
}

function normalizeSchemaVersion(version: number | string | undefined): number {
  if (typeof version === "number" && Number.isFinite(version) && version >= 1) {
    return Math.floor(version);
  }
  if (typeof version === "string") {
    const parsed = Number.parseFloat(version);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }
  }
  return SCHEMA_VERSION;
}

function normalizeManagedAssetIds(assetIds: unknown): string[] {
  if (!Array.isArray(assetIds)) {
    return [];
  }

  return Array.from(new Set(
    assetIds.filter((assetId): assetId is string => typeof assetId === "string" && MANAGED_ASSET_ID_PATTERN.test(assetId.trim()))
      .map((assetId) => assetId.trim()),
  ));
}

export function planProjectSyncAction(
  existing: {
    updatedAt: number;
    schemaVersion: number | string;
    contentHash?: string;
  } | null,
  incoming: SyncMetadata,
): { action: "upload" | "skip" | "pull"; reason: string } {
  if (!existing) {
    return {
      action: "upload",
      reason: "cloud project is missing",
    };
  }

  const incomingSchemaVersion = normalizeSchemaVersion(incoming.schemaVersion);
  const existingSchemaVersion = normalizeSchemaVersion(existing.schemaVersion);
  if (incomingSchemaVersion < existingSchemaVersion) {
    return {
      action: "pull",
      reason: `schema downgrade blocked (incoming v${incomingSchemaVersion}, cloud v${existingSchemaVersion})`,
    };
  }

  const incomingHash = normalizeContentHash(incoming.contentHash);
  const existingHash = normalizeContentHash(existing.contentHash);
  const sameTimestamp = incoming.updatedAt === existing.updatedAt;
  const sameSchema = incomingSchemaVersion === existingSchemaVersion;
  const matchingHashes = sameSchema && incomingHash !== null && existingHash !== null && incomingHash === existingHash;

  if (matchingHashes) {
    return {
      action: "skip",
      reason: "content already in sync",
    };
  }

  const shouldUpload =
    incomingSchemaVersion > existingSchemaVersion ||
    incoming.updatedAt > existing.updatedAt ||
    (sameTimestamp &&
      sameSchema &&
      incomingHash !== null &&
      existingHash !== null &&
      incomingHash !== existingHash &&
      incomingHash > existingHash);

  if (shouldUpload) {
    return {
      action: "upload",
      reason: incomingSchemaVersion > existingSchemaVersion ? "incoming schema is newer" : "local project is newer",
    };
  }

  if (sameTimestamp && sameSchema && incomingHash !== null && existingHash !== null) {
    if (incomingHash === existingHash) {
      return {
        action: "skip",
        reason: "already in sync",
      };
    }

    return {
      action: "pull",
      reason: "same timestamp conflict resolved in favor of cloud hash",
    };
  }

  if (incoming.updatedAt < existing.updatedAt) {
    return {
      action: "pull",
      reason: "cloud project is newer",
    };
  }

  return {
    action: "pull",
    reason: "cloud version is newer or equal",
  };
}

export function planRevisionSyncAction(
  existing: {
    createdAt: number;
    contentHash: string;
    checkpointName?: string;
    reason: "manual_checkpoint" | "auto_checkpoint" | "import" | "restore" | "edit_revision";
    isCheckpoint: boolean;
  } | null,
  incoming: RevisionSyncMetadata,
): { action: "upload" | "skip"; reason: string } {
  if (!existing) {
    return {
      action: "upload",
      reason: "cloud revision is missing",
    };
  }

  const shouldUpload =
    incoming.createdAt > existing.createdAt ||
    (incoming.createdAt === existing.createdAt &&
      ((normalizeContentHash(incoming.contentHash) ?? "") !== existing.contentHash ||
        incoming.checkpointName !== existing.checkpointName ||
        incoming.reason !== existing.reason ||
        incoming.isCheckpoint !== existing.isCheckpoint));

  if (shouldUpload) {
    return {
      action: "upload",
      reason: "local revision is newer",
    };
  }

  return {
    action: "skip",
    reason: "cloud revision is newer or equal",
  };
}

function compareProjectPriority(a: StoredProject, b: StoredProject): number {
  const schemaDiff = normalizeSchemaVersion(a.schemaVersion) - normalizeSchemaVersion(b.schemaVersion);
  if (schemaDiff !== 0) {
    return schemaDiff;
  }

  const updatedAtDiff = a.updatedAt - b.updatedAt;
  if (updatedAtDiff !== 0) {
    return updatedAtDiff;
  }

  const aHash = normalizeContentHash(a.contentHash) ?? "";
  const bHash = normalizeContentHash(b.contentHash) ?? "";
  if (aHash !== bHash) {
    return aHash > bHash ? 1 : -1;
  }

  return String(a._id).localeCompare(String(b._id));
}

function pickCanonicalProject(projects: StoredProject[]): StoredProject | null {
  if (projects.length === 0) {
    return null;
  }

  return projects.slice(1).reduce((best, candidate) => {
    return compareProjectPriority(candidate, best) > 0 ? candidate : best;
  }, projects[0]);
}

function pickCanonicalProjectsByLocalId(projects: StoredProject[]): StoredProject[] {
  const byLocalId = new Map<string, StoredProject>();
  for (const project of projects) {
    const current = byLocalId.get(project.localId);
    if (!current || compareProjectPriority(project, current) > 0) {
      byLocalId.set(project.localId, project);
    }
  }
  return Array.from(byLocalId.values());
}

async function listProjectsByLocalId(ctx: any, ownerUserId: string, localId: string): Promise<StoredProject[]> {
  return (await ctx.db
    .query("projects")
    .withIndex("by_ownerUserId_and_localId", (q: any) => q.eq("ownerUserId", ownerUserId).eq("localId", localId))
    .collect()) as StoredProject[];
}

async function listProjectsForOwner(ctx: any, ownerUserId: string): Promise<StoredProject[]> {
  return (await ctx.db
    .query("projects")
    .withIndex("by_ownerUserId_and_updatedAt", (q: any) => q.eq("ownerUserId", ownerUserId))
    .order("desc")
    .collect()) as StoredProject[];
}

async function listRevisionsByProjectLocalId(
  ctx: any,
  ownerUserId: string,
  projectLocalId: string,
): Promise<StoredProjectRevision[]> {
  return (await ctx.db
    .query("projectRevisions")
    .withIndex("by_ownerUserId_and_projectLocalId_and_createdAt", (q: any) =>
      q.eq("ownerUserId", ownerUserId).eq("projectLocalId", projectLocalId),
    )
    .collect()) as StoredProjectRevision[];
}

async function listRevisionsForOwner(ctx: any, ownerUserId: string): Promise<StoredProjectRevision[]> {
  return (await ctx.db
    .query("projectRevisions")
    .withIndex("by_ownerUserId_and_createdAt", (q: any) => q.eq("ownerUserId", ownerUserId))
    .collect()) as StoredProjectRevision[];
}

type StoredProjectAsset = {
  _id: Id<"projectAssets">;
  ownerUserId?: string;
  assetId: string;
  kind: "image" | "audio" | "background";
  mimeType: string;
  size: number;
  storageId: Id<"_storage">;
  createdAt: number;
  orphanedAt?: number;
};

async function listProjectAssetsForOwner(ctx: any, ownerUserId: string): Promise<StoredProjectAsset[]> {
  return (await ctx.db
    .query("projectAssets")
    .withIndex("by_ownerUserId_and_createdAt", (q: any) => q.eq("ownerUserId", ownerUserId))
    .collect()) as StoredProjectAsset[];
}

async function cleanupDuplicateProjects(
  ctx: any,
  projects: StoredProject[],
  keepId: Id<"projects">,
) {
  if (projects.length <= 1) {
    return;
  }

  const storageIdsToDelete = new Set<Id<"_storage">>();
  const keptProject = projects.find((project) => project._id === keepId) ?? null;
  const keptStorageId = keptProject?.storageId;
  const removedAssetIds = new Set<string>();
  for (const project of projects) {
    if (project._id === keepId) {
      continue;
    }

    if (project.storageId && project.storageId !== keptStorageId) {
      storageIdsToDelete.add(project.storageId);
    }
    for (const assetId of normalizeManagedAssetIds(project.assetIds)) {
      removedAssetIds.add(assetId);
    }
    await ctx.db.delete(project._id);
  }

  for (const storageId of storageIdsToDelete) {
    await cleanupStorage(ctx, storageId);
  }

  if (keptProject?.ownerUserId) {
    await garbageCollectProjectAssets(ctx, keptProject.ownerUserId, removedAssetIds);
  }
}

async function deleteProjectEditorLeases(
  ctx: any,
  ownerUserId: string,
  projectLocalId: string,
) {
  const leases = await ctx.db
    .query("projectEditorLeases")
    .withIndex("by_ownerUserId_and_projectLocalId", (q: any) =>
      q.eq("ownerUserId", ownerUserId).eq("projectLocalId", projectLocalId),
    )
    .collect();

  for (const lease of leases as Array<{ _id: Id<"projectEditorLeases"> }>) {
    await ctx.db.delete(lease._id);
  }
}

async function garbageCollectProjectAssets(
  ctx: any,
  ownerUserId: string,
  touchedAssetIds: Iterable<string> = [],
) {
  const projectAssets = await listProjectAssetsForOwner(ctx, ownerUserId);
  const candidateIds = new Set<string>();

  for (const assetId of touchedAssetIds) {
    if (MANAGED_ASSET_ID_PATTERN.test(assetId)) {
      candidateIds.add(assetId);
    }
  }

  for (const row of projectAssets) {
    if (row.orphanedAt !== undefined) {
      candidateIds.add(row.assetId);
    }
  }

  if (candidateIds.size === 0) {
    return;
  }

  const referencedIds = new Set<string>();
  const ownedProjects = await listProjectsForOwner(ctx, ownerUserId);
  for (const project of ownedProjects) {
    for (const assetId of normalizeManagedAssetIds(project.assetIds)) {
      if (candidateIds.has(assetId)) {
        referencedIds.add(assetId);
      }
    }
  }

  const ownedRevisions = await listRevisionsForOwner(ctx, ownerUserId);
  for (const revision of ownedRevisions) {
    for (const assetId of normalizeManagedAssetIds(revision.assetIds)) {
      if (candidateIds.has(assetId)) {
        referencedIds.add(assetId);
      }
    }
  }

  const now = Date.now();
  for (const row of projectAssets) {
    if (!candidateIds.has(row.assetId)) {
      continue;
    }

    if (referencedIds.has(row.assetId)) {
      if (row.orphanedAt !== undefined) {
        await ctx.db.replace(row._id, {
          ownerUserId: row.ownerUserId,
          assetId: row.assetId,
          kind: row.kind,
          mimeType: row.mimeType,
          size: row.size,
          storageId: row.storageId,
          createdAt: row.createdAt,
        });
      }
      continue;
    }

    if (row.orphanedAt === undefined) {
      await ctx.db.patch(row._id, { orphanedAt: now });
      continue;
    }

    if (now - row.orphanedAt < PROJECT_ASSET_GC_GRACE_PERIOD_MS) {
      continue;
    }

    await ctx.db.delete(row._id);
    await cleanupStorage(ctx, row.storageId);
  }
}

function toSummary(project: StoredProject) {
  const summary: {
    _id: Id<"projects">;
    localId: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    schemaVersion: number;
    appVersion?: string;
    contentHash?: string;
    storageId?: Id<"_storage">;
    dataSizeBytes?: number;
    assetIds?: string[];
  } = {
    _id: project._id,
    localId: project.localId,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    schemaVersion: normalizeSchemaVersion(project.schemaVersion),
  };

  if (project.appVersion !== undefined) {
    summary.appVersion = project.appVersion;
  }
  if (project.contentHash !== undefined) {
    summary.contentHash = project.contentHash;
  }
  if (project.storageId !== undefined) {
    summary.storageId = project.storageId;
  }
  if (project.dataSizeBytes !== undefined) {
    summary.dataSizeBytes = project.dataSizeBytes;
  }
  if (project.assetIds !== undefined) {
    summary.assetIds = normalizeManagedAssetIds(project.assetIds);
  }

  return summary;
}

async function toFull(ctx: any, project: StoredProject) {
  const result: {
    localId: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    schemaVersion: number;
    appVersion?: string;
    contentHash?: string;
    storageId?: Id<"_storage">;
    dataSizeBytes?: number;
    assetIds?: string[];
    data?: string;
    dataUrl: string | null;
  } = {
    localId: project.localId,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    schemaVersion: normalizeSchemaVersion(project.schemaVersion),
    dataUrl: project.storageId ? await ctx.storage.getUrl(project.storageId) : null,
  };

  if (project.appVersion !== undefined) {
    result.appVersion = project.appVersion;
  }
  if (project.contentHash !== undefined) {
    result.contentHash = project.contentHash;
  }
  if (project.storageId !== undefined) {
    result.storageId = project.storageId;
  }
  if (project.dataSizeBytes !== undefined) {
    result.dataSizeBytes = project.dataSizeBytes;
  }
  if (project.assetIds !== undefined) {
    result.assetIds = normalizeManagedAssetIds(project.assetIds);
  }
  if (project.data !== undefined) {
    result.data = project.data;
  }

  return result;
}

async function toRevisionFull(ctx: any, revision: StoredProjectRevision) {
  const result: {
    projectLocalId: string;
    revisionId: string;
    parentRevisionId?: string;
    kind: "snapshot" | "delta";
    baseRevisionId: string;
    storageId?: Id<"_storage">;
    dataSizeBytes?: number;
    contentHash: string;
    createdAt: number;
    schemaVersion: number;
    appVersion?: string;
    reason: "manual_checkpoint" | "auto_checkpoint" | "import" | "restore" | "edit_revision";
    checkpointName?: string;
    isCheckpoint: boolean;
    restoredFromRevisionId?: string;
    assetIds?: string[];
    data?: string;
    dataUrl: string | null;
  } = {
    projectLocalId: revision.projectLocalId,
    revisionId: revision.revisionId,
    parentRevisionId: revision.parentRevisionId,
    kind: revision.kind,
    baseRevisionId: revision.baseRevisionId,
    contentHash: revision.contentHash,
    createdAt: revision.createdAt,
    schemaVersion: normalizeSchemaVersion(revision.schemaVersion),
    reason: revision.reason,
    isCheckpoint: revision.isCheckpoint,
    dataUrl: revision.storageId ? await ctx.storage.getUrl(revision.storageId) : null,
  };

  if (revision.storageId !== undefined) {
    result.storageId = revision.storageId;
  }
  if (revision.dataSizeBytes !== undefined) {
    result.dataSizeBytes = revision.dataSizeBytes;
  }
  if (revision.appVersion !== undefined) {
    result.appVersion = revision.appVersion;
  }
  if (revision.checkpointName !== undefined) {
    result.checkpointName = revision.checkpointName;
  }
  if (revision.restoredFromRevisionId !== undefined) {
    result.restoredFromRevisionId = revision.restoredFromRevisionId;
  }
  if (revision.assetIds !== undefined) {
    result.assetIds = normalizeManagedAssetIds(revision.assetIds);
  }
  if (revision.data !== undefined) {
    result.data = revision.data;
  }

  return result;
}

function toRevisionDocument(ownerUserId: string, payload: RevisionSyncPayload) {
  const contentHash =
    normalizeContentHash(payload.contentHash) ??
    (typeof payload.data === "string" ? computeContentHash(payload.data) : "0000000000000000");
  const base: {
    ownerUserId: string;
    projectLocalId: string;
    revisionId: string;
    parentRevisionId?: string;
    kind: "snapshot" | "delta";
    baseRevisionId: string;
    dataSizeBytes?: number;
    contentHash: string;
    createdAt: number;
    schemaVersion: number;
    appVersion?: string;
    reason: "manual_checkpoint" | "auto_checkpoint" | "import" | "restore" | "edit_revision";
    checkpointName?: string;
    isCheckpoint: boolean;
    restoredFromRevisionId?: string;
    assetIds?: string[];
  } = {
    ownerUserId,
    projectLocalId: payload.localProjectId,
    revisionId: payload.revisionId,
    parentRevisionId: payload.parentRevisionId,
    kind: payload.kind,
    baseRevisionId: payload.baseRevisionId,
    contentHash,
    createdAt: payload.createdAt,
    schemaVersion: normalizeSchemaVersion(payload.schemaVersion),
    reason: payload.reason,
    checkpointName: payload.checkpointName,
    isCheckpoint: payload.isCheckpoint,
    restoredFromRevisionId: payload.restoredFromRevisionId,
  };

  if (payload.dataSizeBytes !== undefined) {
    base.dataSizeBytes = payload.dataSizeBytes;
  }
  if (payload.appVersion !== undefined) {
    base.appVersion = payload.appVersion;
  }
  if (payload.assetIds !== undefined) {
    base.assetIds = normalizeManagedAssetIds(payload.assetIds);
  }

  if (payload.storageId) {
    return {
      ...base,
      storageId: payload.storageId,
    };
  }

  if (payload.data !== undefined) {
    return {
      ...base,
      data: payload.data,
    };
  }

  throw new Error("Revision sync payload must include either storageId or data");
}

async function upsertProjectRevision(ctx: any, ownerUserId: string, payload: RevisionSyncPayload) {
  const existing = (await ctx.db
    .query("projectRevisions")
    .withIndex("by_ownerUserId_and_projectLocalId_and_revisionId", (q: any) =>
      q.eq("ownerUserId", ownerUserId).eq("projectLocalId", payload.localProjectId).eq("revisionId", payload.revisionId),
    )
    .first()) as StoredProjectRevision | null;

  const nextDocument = toRevisionDocument(ownerUserId, payload);

  if (!existing) {
    await ctx.db.insert("projectRevisions", nextDocument);
    await garbageCollectProjectAssets(ctx, ownerUserId, normalizeManagedAssetIds(nextDocument.assetIds));
    return { action: "created" as const };
  }

  const shouldUpdate =
    nextDocument.createdAt > existing.createdAt ||
    (nextDocument.createdAt === existing.createdAt &&
      (nextDocument.contentHash !== existing.contentHash ||
        nextDocument.checkpointName !== existing.checkpointName ||
        nextDocument.reason !== existing.reason ||
        nextDocument.isCheckpoint !== existing.isCheckpoint));

  if (!shouldUpdate) {
    const uploadedStorageId =
      payload.storageId && payload.storageId !== existing.storageId ? payload.storageId : undefined;
    await cleanupStorage(ctx, uploadedStorageId);
    await garbageCollectProjectAssets(ctx, ownerUserId, [
      ...normalizeManagedAssetIds(existing.assetIds),
      ...normalizeManagedAssetIds(nextDocument.assetIds),
    ]);
    return { action: "skipped" as const };
  }

  const staleStorageId = payload.storageId
    ? existing.storageId && existing.storageId !== payload.storageId
      ? existing.storageId
      : undefined
    : existing.storageId;

  await ctx.db.replace(existing._id, nextDocument);
  await cleanupStorage(ctx, staleStorageId);
  await garbageCollectProjectAssets(ctx, ownerUserId, [
    ...normalizeManagedAssetIds(existing.assetIds),
    ...normalizeManagedAssetIds(nextDocument.assetIds),
  ]);
  return { action: "updated" as const };
}

function toProjectDocument(
  ownerUserId: string,
  payload: SyncPayload,
  normalizedSchemaVersion: number,
  createdAt: number,
) {
  const contentHash =
    normalizeContentHash(payload.contentHash) ??
    (typeof payload.data === "string" ? computeContentHash(payload.data) : undefined);

  const base: {
    ownerUserId: string;
    localId: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    schemaVersion: number;
    appVersion?: string;
    contentHash?: string;
    dataSizeBytes?: number;
    assetIds?: string[];
  } = {
    ownerUserId,
    localId: payload.localId,
    name: payload.name,
    createdAt,
    updatedAt: payload.updatedAt,
    schemaVersion: normalizedSchemaVersion,
  };

  if (payload.appVersion !== undefined) {
    base.appVersion = payload.appVersion;
  }
  if (contentHash !== undefined) {
    base.contentHash = contentHash;
  }
  if (payload.dataSizeBytes !== undefined) {
    base.dataSizeBytes = payload.dataSizeBytes;
  }
  if (payload.assetIds !== undefined) {
    base.assetIds = normalizeManagedAssetIds(payload.assetIds);
  }

  if (payload.storageId) {
    return {
      ...base,
      storageId: payload.storageId,
    };
  }

  if (payload.data !== undefined) {
    return {
      ...base,
      data: payload.data,
    };
  }

  throw new Error("Project sync payload must include either storageId or data");
}

async function cleanupStorage(ctx: any, storageId: Id<"_storage"> | undefined) {
  if (storageId) {
    await ctx.storage.delete(storageId);
  }
}

async function upsertProject(ctx: any, ownerUserId: string, payload: SyncPayload) {
  const incomingSchemaVersion = normalizeSchemaVersion(payload.schemaVersion);
  const incomingHash =
    normalizeContentHash(payload.contentHash) ??
    (typeof payload.data === "string" ? computeContentHash(payload.data) : null);

  const matchingProjects = await listProjectsByLocalId(ctx, ownerUserId, payload.localId);
  const existing = pickCanonicalProject(matchingProjects);

  if (existing && matchingProjects.length > 1) {
    await cleanupDuplicateProjects(ctx, matchingProjects, existing._id);
  }

  if (existing) {
    const existingSchemaVersion = normalizeSchemaVersion(existing.schemaVersion);
    if (incomingSchemaVersion < existingSchemaVersion) {
      const uploadedStorageId =
        payload.storageId && payload.storageId !== existing.storageId
          ? payload.storageId
          : undefined;
      await cleanupStorage(ctx, uploadedStorageId);
      return {
        action: "skipped" as const,
        id: existing._id,
        reason: `schema downgrade blocked (incoming v${incomingSchemaVersion}, cloud v${existingSchemaVersion})`,
      };
    }

    const existingHash =
      normalizeContentHash(existing.contentHash) ??
      (typeof existing.data === "string" ? computeContentHash(existing.data) : null);
    const sameTimestamp = payload.updatedAt === existing.updatedAt;
    const sameSchema = incomingSchemaVersion === existingSchemaVersion;

    const shouldUpdate =
      incomingSchemaVersion > existingSchemaVersion ||
      payload.updatedAt > existing.updatedAt ||
      (sameTimestamp &&
        sameSchema &&
        incomingHash !== null &&
        existingHash !== null &&
        incomingHash !== existingHash &&
        incomingHash > existingHash);

    if (!shouldUpdate) {
      // Uploaded storage blobs should not be orphaned when updates are skipped.
      const uploadedStorageId =
        payload.storageId && payload.storageId !== existing.storageId
          ? payload.storageId
          : undefined;
      await cleanupStorage(ctx, uploadedStorageId);

      let reason = "cloud version is newer or equal";
      if (sameTimestamp && sameSchema && incomingHash !== null && existingHash !== null) {
        if (incomingHash === existingHash) {
          reason = "already in sync";
        } else {
          reason = "same timestamp conflict resolved in favor of cloud hash";
        }
      } else if (payload.updatedAt < existing.updatedAt) {
        reason = "cloud project is newer";
      }

      await garbageCollectProjectAssets(ctx, ownerUserId, [
        ...normalizeManagedAssetIds(existing.assetIds),
        ...normalizeManagedAssetIds(payload.assetIds),
      ]);

      return {
        action: "skipped" as const,
        id: existing._id,
        reason,
      };
    }

    const staleStorageId = payload.storageId
      ? existing.storageId && existing.storageId !== payload.storageId
        ? existing.storageId
        : undefined
      : existing.storageId;

    const nextDocument = toProjectDocument(ownerUserId, payload, incomingSchemaVersion, existing.createdAt);
    await ctx.db.replace(existing._id, nextDocument);

    await cleanupStorage(ctx, staleStorageId);
    await garbageCollectProjectAssets(ctx, ownerUserId, [
      ...normalizeManagedAssetIds(existing.assetIds),
      ...normalizeManagedAssetIds(nextDocument.assetIds),
    ]);

    return { action: "updated" as const, id: existing._id };
  }

  const nextDocument = toProjectDocument(ownerUserId, payload, incomingSchemaVersion, payload.createdAt);
  const id = await ctx.db.insert("projects", nextDocument);
  await garbageCollectProjectAssets(ctx, ownerUserId, normalizeManagedAssetIds(nextDocument.assetIds));

  return { action: "created" as const, id };
}

// List all projects from cloud
export const list = query({
  args: {},
  returns: v.array(projectSummaryValidator),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }
    const ownerUserId = identity.subject;
    const projects = await listProjectsForOwner(ctx, ownerUserId);
    return pickCanonicalProjectsByLocalId(projects).map(toSummary);
  },
});

// Get a single project by localId
export const getByLocalId = query({
  args: { localId: v.string() },
  returns: v.union(projectSummaryValidator, v.null()),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const projects = await listProjectsByLocalId(ctx, ownerUserId, args.localId);
    const project = pickCanonicalProject(projects);

    if (!project) {
      return null;
    }

    return toSummary(project);
  },
});

// Get full project data by localId
export const getFullProject = query({
  args: { localId: v.string() },
  returns: v.union(fullProjectValidator, v.null()),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const projects = await listProjectsByLocalId(ctx, ownerUserId, args.localId);
    const project = pickCanonicalProject(projects);

    if (!project) {
      return null;
    }

    return await toFull(ctx, project);
  },
});

export const planSync = query({
  args: {
    project: syncMetadataValidator,
    revisions: v.array(revisionSyncMetadataValidator),
  },
  returns: syncPlanResultValidator,
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const projects = await listProjectsByLocalId(ctx, ownerUserId, args.project.localId);
    const project = pickCanonicalProject(projects);
    const projectPlan = planProjectSyncAction(project, args.project);

    if (projectPlan.action === "pull") {
      return {
        project: projectPlan,
        revisions: [],
      };
    }

    const revisionsById = new Map<string, StoredProjectRevision>();
    if (project) {
      const existingRevisions = await listRevisionsByProjectLocalId(ctx, ownerUserId, args.project.localId);
      for (const revision of existingRevisions) {
        revisionsById.set(revision.revisionId, revision);
      }
    }

    return {
      project: projectPlan,
      revisions: args.revisions.map((revision) => ({
        revisionId: revision.revisionId,
        ...planRevisionSyncAction(revisionsById.get(revision.revisionId) ?? null, revision),
      })),
    };
  },
});

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireAuthenticatedUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

// Sync a project to cloud (upsert based on localId)
export const sync = mutation({
  args: syncPayloadValidator,
  returns: syncResultValidator,
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    return await upsertProject(ctx, ownerUserId, args);
  },
});

// Sync multiple projects at once
export const syncBatch = mutation({
  args: {
    projects: v.array(syncPayloadValidator),
  },
  returns: v.array(syncBatchResultValidator),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const results = [];

    for (const project of args.projects) {
      const result = await upsertProject(ctx, ownerUserId, project);
      results.push({
        localId: project.localId,
        action: result.action,
        reason: result.reason,
      });
    }

    return results;
  },
});

export const syncRevisions = mutation({
  args: {
    revisions: v.array(revisionSyncPayloadValidator),
  },
  returns: v.object({
    created: v.number(),
    updated: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const checkedProjects = new Map<string, boolean>();

    for (const revision of args.revisions as RevisionSyncPayload[]) {
      const projectLocalId = revision.localProjectId;
      let ownsProject = checkedProjects.get(projectLocalId);
      if (ownsProject === undefined) {
        const ownedProjects = await listProjectsByLocalId(ctx, ownerUserId, projectLocalId);
        ownsProject = ownedProjects.length > 0;
        checkedProjects.set(projectLocalId, ownsProject);
      }
      if (!ownsProject) {
        skipped += 1;
        continue;
      }

      const result = await upsertProjectRevision(ctx, ownerUserId, revision);
      if (result.action === "created") {
        created += 1;
      } else if (result.action === "updated") {
        updated += 1;
      } else {
        skipped += 1;
      }
    }

    return { created, updated, skipped };
  },
});

// Delete a project from cloud
export const remove = mutation({
  args: { localId: v.string() },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const projects = await listProjectsByLocalId(ctx, ownerUserId, args.localId);
    const revisions = await listRevisionsByProjectLocalId(ctx, ownerUserId, args.localId);
    const hadProjectArtifacts = projects.length > 0 || revisions.length > 0;
    if (!hadProjectArtifacts) {
      await deleteProjectEditorLeases(ctx, ownerUserId, args.localId);
      return { deleted: false };
    }

    const storageIdsToDelete = new Set<Id<"_storage">>();
    for (const project of projects) {
      if (project.storageId) {
        storageIdsToDelete.add(project.storageId);
      }
      await ctx.db.delete(project._id);
    }

    for (const storageId of storageIdsToDelete) {
      await cleanupStorage(ctx, storageId);
    }

    const revisionStorageIds = new Set<Id<"_storage">>();
    for (const revision of revisions) {
      if (revision.storageId) {
        revisionStorageIds.add(revision.storageId);
      }
      await ctx.db.delete(revision._id);
    }

    for (const storageId of revisionStorageIds) {
      await cleanupStorage(ctx, storageId);
    }

    await garbageCollectProjectAssets(ctx, ownerUserId, [
      ...projects.flatMap((project) => normalizeManagedAssetIds(project.assetIds)),
      ...revisions.flatMap((revision) => normalizeManagedAssetIds(revision.assetIds)),
    ]);
    await deleteProjectEditorLeases(ctx, ownerUserId, args.localId);

    return { deleted: true };
  },
});

// Get all full project data for sync down
export const listFull = query({
  args: {},
  returns: v.array(fullProjectValidator),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return [];
    }
    const ownerUserId = identity.subject;
    const projects = await listProjectsForOwner(ctx, ownerUserId);
    const canonicalProjects = pickCanonicalProjectsByLocalId(projects);
    return await Promise.all(canonicalProjects.map((project) => toFull(ctx, project)));
  },
});

export const listRevisions = query({
  args: {
    localId: v.string(),
  },
  returns: v.array(revisionSummaryValidator),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const projects = await listProjectsByLocalId(ctx, ownerUserId, args.localId);
    if (projects.length === 0) {
      return [];
    }

    const revisions = await listRevisionsByProjectLocalId(ctx, ownerUserId, args.localId);
    const sorted = revisions.slice().sort((a, b) => b.createdAt - a.createdAt);
    return await Promise.all(sorted.map((revision) => toRevisionFull(ctx, revision)));
  },
});

export const listRevisionsForSync = mutation({
  args: {
    localId: v.string(),
  },
  returns: v.array(revisionSummaryValidator),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const projects = await listProjectsByLocalId(ctx, ownerUserId, args.localId);
    if (projects.length === 0) {
      return [];
    }

    const revisions = await listRevisionsByProjectLocalId(ctx, ownerUserId, args.localId);
    const sorted = revisions.slice().sort((a, b) => b.createdAt - a.createdAt);
    return await Promise.all(sorted.map((revision) => toRevisionFull(ctx, revision)));
  },
});

export const renameCheckpoint = mutation({
  args: {
    localId: v.string(),
    revisionId: v.string(),
    checkpointName: v.string(),
  },
  returns: v.object({ updated: v.boolean() }),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const revision = (await ctx.db
      .query("projectRevisions")
      .withIndex("by_ownerUserId_and_projectLocalId_and_revisionId", (q: any) =>
        q.eq("ownerUserId", ownerUserId).eq("projectLocalId", args.localId).eq("revisionId", args.revisionId),
      )
      .first()) as StoredProjectRevision | null;

    if (!revision || !revision.isCheckpoint) {
      return { updated: false };
    }

    const normalizedName = args.checkpointName.trim().slice(0, 80);
    if (!normalizedName) {
      return { updated: false };
    }

    await ctx.db.patch(revision._id, {
      checkpointName: normalizedName,
    });
    return { updated: true };
  },
});

export const deleteRevision = mutation({
  args: {
    localId: v.string(),
    revisionId: v.string(),
  },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const revision = (await ctx.db
      .query("projectRevisions")
      .withIndex("by_ownerUserId_and_projectLocalId_and_revisionId", (q: any) =>
        q.eq("ownerUserId", ownerUserId).eq("projectLocalId", args.localId).eq("revisionId", args.revisionId),
      )
      .first()) as StoredProjectRevision | null;
    if (!revision) {
      return { deleted: false };
    }

    if (revision.storageId) {
      await cleanupStorage(ctx, revision.storageId);
    }
    await ctx.db.delete(revision._id);
    return { deleted: true };
  },
});
