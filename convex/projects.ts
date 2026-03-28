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
  revisionCount: v.optional(v.number()),
  latestRevisionId: v.optional(v.string()),
  latestRevisionCreatedAt: v.optional(v.number()),
  latestRevisionContentHash: v.optional(v.string()),
  revisionsUpdatedAt: v.optional(v.number()),
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
  revisionCount: v.optional(v.number()),
  latestRevisionId: v.optional(v.string()),
  latestRevisionCreatedAt: v.optional(v.number()),
  latestRevisionContentHash: v.optional(v.string()),
  revisionsUpdatedAt: v.optional(v.number()),
  data: v.optional(v.string()),
  dataUrl: v.union(v.string(), v.null()),
});

const syncMetadataValidator = v.object({
  localId: v.string(),
  updatedAt: v.number(),
  schemaVersion: v.optional(schemaVersionValidator),
  contentHash: v.optional(v.string()),
  assetIds: v.optional(managedAssetIdsValidator),
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
  updatedAt: v.number(),
  schemaVersion: v.optional(schemaVersionValidator),
  contentHash: v.optional(v.string()),
  assetIds: v.optional(managedAssetIdsValidator),
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
  updatedAt: v.optional(v.number()),
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
  updatedAt: v.number(),
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

const revisionSyncStateValidator = v.object({
  revisionCount: v.number(),
  latestRevisionId: v.union(v.string(), v.null()),
  latestRevisionCreatedAt: v.union(v.number(), v.null()),
  latestRevisionContentHash: v.union(v.string(), v.null()),
  revisionsUpdatedAt: v.union(v.number(), v.null()),
});

const syncResultValidator = v.object({
  action: v.union(v.literal("created"), v.literal("updated"), v.literal("skipped")),
  id: v.id("projects"),
  reason: v.optional(v.string()),
  cloudRevisionState: revisionSyncStateValidator,
});

const syncBatchResultValidator = v.object({
  localId: v.string(),
  action: v.union(v.literal("created"), v.literal("updated"), v.literal("skipped")),
  reason: v.optional(v.string()),
  cloudRevisionState: revisionSyncStateValidator,
});

const projectSyncPlanValidator = v.object({
  action: v.union(v.literal("upload"), v.literal("skip"), v.literal("pull")),
  reason: v.string(),
  missingAssetIds: v.optional(managedAssetIdsValidator),
});

const revisionSyncPlanValidator = v.object({
  revisionId: v.string(),
  action: v.union(v.literal("upload"), v.literal("skip")),
  reason: v.string(),
  missingAssetIds: v.optional(managedAssetIdsValidator),
});

const syncPlanResultValidator = v.object({
  project: projectSyncPlanValidator,
  revisions: v.array(revisionSyncPlanValidator),
  cloudRevisionState: revisionSyncStateValidator,
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
  revisionCount?: number;
  latestRevisionId?: string;
  latestRevisionCreatedAt?: number;
  latestRevisionContentHash?: string;
  revisionsUpdatedAt?: number;
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
  assetIds?: string[];
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
  updatedAt?: number;
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
  updatedAt?: number;
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
  updatedAt: number;
  schemaVersion?: number | string;
  contentHash?: string;
  assetIds?: string[];
  reason: "manual_checkpoint" | "auto_checkpoint" | "import" | "restore" | "edit_revision";
  checkpointName?: string;
  isCheckpoint: boolean;
};

type RevisionSyncState = {
  revisionCount: number;
  latestRevisionId: string | null;
  latestRevisionCreatedAt: number | null;
  latestRevisionContentHash: string | null;
  revisionsUpdatedAt: number | null;
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

function createEmptyRevisionSyncState(): RevisionSyncState {
  return {
    revisionCount: 0,
    latestRevisionId: null,
    latestRevisionCreatedAt: null,
    latestRevisionContentHash: null,
    revisionsUpdatedAt: null,
  };
}

function getRevisionUpdatedAt(revision: Pick<StoredProjectRevision, "createdAt"> & Partial<Pick<StoredProjectRevision, "updatedAt">>): number {
  return typeof revision.updatedAt === "number" && Number.isFinite(revision.updatedAt)
    ? revision.updatedAt
    : revision.createdAt;
}

function buildRevisionMetadataFingerprint(
  revision: Pick<RevisionSyncMetadata, "contentHash" | "checkpointName" | "reason" | "isCheckpoint" | "assetIds">,
): string {
  return [
    normalizeContentHash(revision.contentHash) ?? "",
    revision.checkpointName ?? "",
    revision.reason,
    revision.isCheckpoint ? "1" : "0",
    Array.from(new Set(normalizeManagedAssetIds(revision.assetIds))).sort().join(","),
  ].join("|");
}

function revisionSyncStateFromProject(
  project: Pick<
    StoredProject,
    "revisionCount" | "latestRevisionId" | "latestRevisionCreatedAt" | "latestRevisionContentHash" | "revisionsUpdatedAt"
  > | null,
): RevisionSyncState {
  if (!project) {
    return createEmptyRevisionSyncState();
  }

  return {
    revisionCount:
      typeof project.revisionCount === "number" && Number.isFinite(project.revisionCount)
        ? Math.max(0, Math.floor(project.revisionCount))
        : 0,
    latestRevisionId: typeof project.latestRevisionId === "string" ? project.latestRevisionId : null,
    latestRevisionCreatedAt:
      typeof project.latestRevisionCreatedAt === "number" && Number.isFinite(project.latestRevisionCreatedAt)
        ? project.latestRevisionCreatedAt
        : null,
    latestRevisionContentHash: normalizeContentHash(project.latestRevisionContentHash) ?? null,
    revisionsUpdatedAt:
      typeof project.revisionsUpdatedAt === "number" && Number.isFinite(project.revisionsUpdatedAt)
        ? project.revisionsUpdatedAt
        : null,
  };
}

function hasStoredRevisionSyncState(project: StoredProject | null): boolean {
  return !!project && (
    typeof project.revisionCount === "number"
    || typeof project.revisionsUpdatedAt === "number"
    || typeof project.latestRevisionId === "string"
  );
}

export function selectUncoveredAssetIdsForSync(
  incomingAssetIds: unknown,
  coveredAssetIds: ReadonlySet<string>,
): string[] {
  return normalizeManagedAssetIds(incomingAssetIds).filter((assetId) => !coveredAssetIds.has(assetId));
}

function collectCoveredCloudAssetIds(
  project: StoredProject | null,
  revisions: Iterable<StoredProjectRevision>,
): Set<string> {
  const coveredAssetIds = new Set<string>(normalizeManagedAssetIds(project?.assetIds));
  for (const revision of revisions) {
    for (const assetId of normalizeManagedAssetIds(revision.assetIds)) {
      coveredAssetIds.add(assetId);
    }
  }
  return coveredAssetIds;
}

async function listMissingOwnedAssetIds(
  ctx: any,
  ownerUserId: string,
  assetIds: readonly string[],
): Promise<string[]> {
  const uniqueIds = normalizeManagedAssetIds(assetIds);
  if (uniqueIds.length === 0) {
    return [];
  }

  const rows = await Promise.all(
    uniqueIds.map(async (assetId) => {
      return await ctx.db
        .query("projectAssets")
        .withIndex("by_ownerUserId_and_assetId", (q: any) => q.eq("ownerUserId", ownerUserId).eq("assetId", assetId))
        .first();
    }),
  );

  return uniqueIds.filter((_assetId, index) => !rows[index]);
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
    updatedAt?: number;
    contentHash: string;
    assetIds?: string[];
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

  const existingUpdatedAt = getRevisionUpdatedAt(existing);
  if (incoming.updatedAt > existingUpdatedAt) {
    return {
      action: "upload",
      reason: "local revision is newer",
    };
  }

  if (incoming.updatedAt < existingUpdatedAt) {
    return {
      action: "skip",
      reason: "cloud revision is newer",
    };
  }

  const existingFingerprint = buildRevisionMetadataFingerprint({
    contentHash: existing.contentHash,
    checkpointName: existing.checkpointName,
    reason: existing.reason,
    isCheckpoint: existing.isCheckpoint,
    assetIds: existing.assetIds ?? [],
  });
  const incomingFingerprint = buildRevisionMetadataFingerprint(incoming);

  if (incomingFingerprint === existingFingerprint) {
    return {
      action: "skip",
      reason: "cloud revision is newer or equal",
    };
  }

  if (incomingFingerprint > existingFingerprint) {
    return {
      action: "upload",
      reason: "same timestamp conflict resolved in favor of local revision metadata",
    };
  }

  return {
    action: "skip",
    reason: "same timestamp conflict resolved in favor of cloud revision metadata",
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

function summarizeRevisionSyncState(revisions: readonly StoredProjectRevision[]): RevisionSyncState {
  if (revisions.length === 0) {
    return createEmptyRevisionSyncState();
  }

  let latest = revisions[0];
  let revisionsUpdatedAt = getRevisionUpdatedAt(revisions[0]);
  for (const revision of revisions) {
    if (revision.createdAt > latest.createdAt) {
      latest = revision;
    }
    const candidateUpdatedAt = getRevisionUpdatedAt(revision);
    if (candidateUpdatedAt > revisionsUpdatedAt) {
      revisionsUpdatedAt = candidateUpdatedAt;
    }
  }

  return {
    revisionCount: revisions.length,
    latestRevisionId: latest.revisionId,
    latestRevisionCreatedAt: latest.createdAt,
    latestRevisionContentHash: latest.contentHash,
    revisionsUpdatedAt,
  };
}

async function listRevisionsForOwner(ctx: any, ownerUserId: string): Promise<StoredProjectRevision[]> {
  return (await ctx.db
    .query("projectRevisions")
    .withIndex("by_ownerUserId_and_createdAt", (q: any) => q.eq("ownerUserId", ownerUserId))
    .collect()) as StoredProjectRevision[];
}

function withRevisionSyncState<T extends Record<string, unknown>>(target: T, revisionState: RevisionSyncState): T & {
  revisionCount: number;
  latestRevisionId?: string;
  latestRevisionCreatedAt?: number;
  latestRevisionContentHash?: string;
  revisionsUpdatedAt?: number;
} {
  const next = {
    ...target,
    revisionCount: revisionState.revisionCount,
  } as T & {
    revisionCount: number;
    latestRevisionId?: string;
    latestRevisionCreatedAt?: number;
    latestRevisionContentHash?: string;
    revisionsUpdatedAt?: number;
  };

  if (revisionState.latestRevisionId !== null) {
    next.latestRevisionId = revisionState.latestRevisionId;
  }
  if (revisionState.latestRevisionCreatedAt !== null) {
    next.latestRevisionCreatedAt = revisionState.latestRevisionCreatedAt;
  }
  if (revisionState.latestRevisionContentHash !== null) {
    next.latestRevisionContentHash = revisionState.latestRevisionContentHash;
  }
  if (revisionState.revisionsUpdatedAt !== null) {
    next.revisionsUpdatedAt = revisionState.revisionsUpdatedAt;
  }

  return next;
}

function projectWithRevisionSyncState(project: StoredProject, revisionState: RevisionSyncState): StoredProject {
  const nextProject = withRevisionSyncState({
    ...project,
  }, revisionState) as StoredProject;

  if (revisionState.latestRevisionId === null) {
    delete nextProject.latestRevisionId;
    delete nextProject.latestRevisionCreatedAt;
    delete nextProject.latestRevisionContentHash;
  }
  if (revisionState.revisionsUpdatedAt === null) {
    delete nextProject.revisionsUpdatedAt;
  }

  return nextProject;
}

async function syncStoredProjectRevisionState(
  ctx: any,
  ownerUserId: string,
  projectLocalId: string,
): Promise<RevisionSyncState> {
  const projects = await listProjectsByLocalId(ctx, ownerUserId, projectLocalId);
  const project = pickCanonicalProject(projects);
  const revisionState = summarizeRevisionSyncState(
    await listRevisionsByProjectLocalId(ctx, ownerUserId, projectLocalId),
  );

  if (!project) {
    return revisionState;
  }

  await ctx.db.replace(project._id, projectWithRevisionSyncState(project, revisionState));
  return revisionState;
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

async function getProjectExplorerAssetIds(ctx: any, ownerUserId: string): Promise<string[]> {
  const record = await ctx.db
    .query('projectExplorerStates')
    .withIndex('by_ownerUserId', (q: any) => q.eq('ownerUserId', ownerUserId))
    .first();

  return normalizeManagedAssetIds(record?.assetIds);
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

  for (const assetId of await getProjectExplorerAssetIds(ctx, ownerUserId)) {
    if (candidateIds.has(assetId)) {
      referencedIds.add(assetId);
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

export async function garbageCollectOwnedProjectAssets(
  ctx: any,
  ownerUserId: string,
  touchedAssetIds: Iterable<string> = [],
): Promise<void> {
  await garbageCollectProjectAssets(ctx, ownerUserId, touchedAssetIds);
}

function toSummary(project: StoredProject) {
  const revisionState = revisionSyncStateFromProject(project);
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
    revisionCount?: number;
    latestRevisionId?: string;
    latestRevisionCreatedAt?: number;
    latestRevisionContentHash?: string;
    revisionsUpdatedAt?: number;
  } = {
    _id: project._id,
    localId: project.localId,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    schemaVersion: normalizeSchemaVersion(project.schemaVersion),
    revisionCount: revisionState.revisionCount,
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
  if (revisionState.latestRevisionId !== null) {
    summary.latestRevisionId = revisionState.latestRevisionId;
  }
  if (revisionState.latestRevisionCreatedAt !== null) {
    summary.latestRevisionCreatedAt = revisionState.latestRevisionCreatedAt;
  }
  if (revisionState.latestRevisionContentHash !== null) {
    summary.latestRevisionContentHash = revisionState.latestRevisionContentHash;
  }
  if (revisionState.revisionsUpdatedAt !== null) {
    summary.revisionsUpdatedAt = revisionState.revisionsUpdatedAt;
  }

  return summary;
}

async function toFull(ctx: any, project: StoredProject) {
  const revisionState = revisionSyncStateFromProject(project);
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
    revisionCount?: number;
    latestRevisionId?: string;
    latestRevisionCreatedAt?: number;
    latestRevisionContentHash?: string;
    revisionsUpdatedAt?: number;
    data?: string;
    dataUrl: string | null;
  } = {
    localId: project.localId,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    schemaVersion: normalizeSchemaVersion(project.schemaVersion),
    revisionCount: revisionState.revisionCount,
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
  if (revisionState.latestRevisionId !== null) {
    result.latestRevisionId = revisionState.latestRevisionId;
  }
  if (revisionState.latestRevisionCreatedAt !== null) {
    result.latestRevisionCreatedAt = revisionState.latestRevisionCreatedAt;
  }
  if (revisionState.latestRevisionContentHash !== null) {
    result.latestRevisionContentHash = revisionState.latestRevisionContentHash;
  }
  if (revisionState.revisionsUpdatedAt !== null) {
    result.revisionsUpdatedAt = revisionState.revisionsUpdatedAt;
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
    updatedAt: number;
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
    updatedAt: getRevisionUpdatedAt(revision),
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
    updatedAt: number;
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
    updatedAt: typeof payload.updatedAt === "number" && Number.isFinite(payload.updatedAt) ? payload.updatedAt : payload.createdAt,
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
    planRevisionSyncAction(existing, {
      revisionId: nextDocument.revisionId,
      createdAt: nextDocument.createdAt,
      updatedAt: nextDocument.updatedAt,
      schemaVersion: nextDocument.schemaVersion,
      contentHash: nextDocument.contentHash,
      assetIds: nextDocument.assetIds,
      reason: nextDocument.reason,
      checkpointName: nextDocument.checkpointName,
      isCheckpoint: nextDocument.isCheckpoint,
    }).action === "upload";

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
  revisionState: RevisionSyncState = createEmptyRevisionSyncState(),
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
    revisionCount: number;
    latestRevisionId?: string;
    latestRevisionCreatedAt?: number;
    latestRevisionContentHash?: string;
    revisionsUpdatedAt?: number;
  } = {
    ownerUserId,
    localId: payload.localId,
    name: payload.name,
    createdAt,
    updatedAt: payload.updatedAt,
    schemaVersion: normalizedSchemaVersion,
    revisionCount: revisionState.revisionCount,
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
  if (revisionState.latestRevisionId !== null) {
    base.latestRevisionId = revisionState.latestRevisionId;
  }
  if (revisionState.latestRevisionCreatedAt !== null) {
    base.latestRevisionCreatedAt = revisionState.latestRevisionCreatedAt;
  }
  if (revisionState.latestRevisionContentHash !== null) {
    base.latestRevisionContentHash = revisionState.latestRevisionContentHash;
  }
  if (revisionState.revisionsUpdatedAt !== null) {
    base.revisionsUpdatedAt = revisionState.revisionsUpdatedAt;
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
        cloudRevisionState: revisionSyncStateFromProject(existing),
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
        cloudRevisionState: revisionSyncStateFromProject(existing),
      };
    }

    const staleStorageId = payload.storageId
      ? existing.storageId && existing.storageId !== payload.storageId
        ? existing.storageId
        : undefined
      : existing.storageId;

    const nextDocument = toProjectDocument(
      ownerUserId,
      payload,
      incomingSchemaVersion,
      existing.createdAt,
      revisionSyncStateFromProject(existing),
    );
    await ctx.db.replace(existing._id, nextDocument);

    await cleanupStorage(ctx, staleStorageId);
    await garbageCollectProjectAssets(ctx, ownerUserId, [
      ...normalizeManagedAssetIds(existing.assetIds),
      ...normalizeManagedAssetIds(nextDocument.assetIds),
    ]);

    return {
      action: "updated" as const,
      id: existing._id,
      cloudRevisionState: revisionSyncStateFromProject(nextDocument),
    };
  }

  const nextDocument = toProjectDocument(
    ownerUserId,
    payload,
    incomingSchemaVersion,
    payload.createdAt,
    createEmptyRevisionSyncState(),
  );
  const id = await ctx.db.insert("projects", nextDocument);
  await garbageCollectProjectAssets(ctx, ownerUserId, normalizeManagedAssetIds(nextDocument.assetIds));

  return {
    action: "created" as const,
    id,
    cloudRevisionState: createEmptyRevisionSyncState(),
  };
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

export const getRevisionSyncState = query({
  args: { localId: v.string() },
  returns: revisionSyncStateValidator,
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const projects = await listProjectsByLocalId(ctx, ownerUserId, args.localId);
    const project = pickCanonicalProject(projects);
    if (!project) {
      return createEmptyRevisionSyncState();
    }
    if (hasStoredRevisionSyncState(project)) {
      return revisionSyncStateFromProject(project);
    }

    return summarizeRevisionSyncState(
      await listRevisionsByProjectLocalId(ctx, ownerUserId, args.localId),
    );
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
    let existingRevisions: StoredProjectRevision[] | null = null;
    let cloudRevisionState = createEmptyRevisionSyncState();
    if (project) {
      if (hasStoredRevisionSyncState(project)) {
        cloudRevisionState = revisionSyncStateFromProject(project);
      } else {
        existingRevisions = await listRevisionsByProjectLocalId(ctx, ownerUserId, args.project.localId);
        cloudRevisionState = summarizeRevisionSyncState(existingRevisions);
      }
    }

    if (projectPlan.action === "pull") {
      return {
        project: projectPlan,
        revisions: [],
        cloudRevisionState,
      };
    }

    const revisionsById = new Map<string, StoredProjectRevision>();
    if (project && args.revisions.length > 0) {
      existingRevisions ??= await listRevisionsByProjectLocalId(ctx, ownerUserId, args.project.localId);
      for (const revision of existingRevisions) {
        revisionsById.set(revision.revisionId, revision);
      }
    }

    const coveredAssetIds = collectCoveredCloudAssetIds(project, revisionsById.values());
    let plannedProject: {
      action: "upload" | "skip" | "pull";
      reason: string;
      missingAssetIds?: string[];
    } = { ...projectPlan };
    if (projectPlan.action === "upload") {
      const candidateProjectAssetIds = selectUncoveredAssetIdsForSync(args.project.assetIds, coveredAssetIds);
      const missingAssetIds = await listMissingOwnedAssetIds(ctx, ownerUserId, candidateProjectAssetIds);
      plannedProject = {
        ...plannedProject,
        missingAssetIds,
      };
      for (const assetId of normalizeManagedAssetIds(args.project.assetIds)) {
        coveredAssetIds.add(assetId);
      }
    }

    return {
      project: plannedProject,
      revisions: await Promise.all(args.revisions.map(async (revision) => {
        const revisionPlan = planRevisionSyncAction(revisionsById.get(revision.revisionId) ?? null, revision);
        const plannedRevision: {
          revisionId: string;
          action: "upload" | "skip";
          reason: string;
          missingAssetIds?: string[];
        } = {
          revisionId: revision.revisionId,
          ...revisionPlan,
        };

        if (revisionPlan.action !== "upload") {
          return plannedRevision;
        }

        const candidateRevisionAssetIds = selectUncoveredAssetIdsForSync(revision.assetIds, coveredAssetIds);
        const missingAssetIds = await listMissingOwnedAssetIds(ctx, ownerUserId, candidateRevisionAssetIds);
        for (const assetId of normalizeManagedAssetIds(revision.assetIds)) {
          coveredAssetIds.add(assetId);
        }

        return {
          ...plannedRevision,
          missingAssetIds,
        };
      })),
      cloudRevisionState,
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
        cloudRevisionState: result.cloudRevisionState,
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
    const touchedProjectIds = new Set<string>();

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
        touchedProjectIds.add(projectLocalId);
      } else if (result.action === "updated") {
        updated += 1;
        touchedProjectIds.add(projectLocalId);
      } else {
        skipped += 1;
      }
    }

    for (const projectLocalId of touchedProjectIds) {
      await syncStoredProjectRevisionState(ctx, ownerUserId, projectLocalId);
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
      updatedAt: Date.now(),
    });
    await syncStoredProjectRevisionState(ctx, ownerUserId, args.localId);
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
    await syncStoredProjectRevisionState(ctx, ownerUserId, args.localId);
    return { deleted: true };
  },
});
