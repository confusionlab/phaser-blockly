import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { SCHEMA_VERSION } from "./schema";

const schemaVersionValidator = v.union(v.number(), v.string());

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
};

async function requireAuthenticatedUserId(ctx: any): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("unauthenticated");
  }
  return identity.subject;
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
  for (const project of projects) {
    if (project._id === keepId) {
      continue;
    }

    if (project.storageId && project.storageId !== keptStorageId) {
      storageIdsToDelete.add(project.storageId);
    }
    await ctx.db.delete(project._id);
  }

  for (const storageId of storageIdsToDelete) {
    await cleanupStorage(ctx, storageId);
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
  if (project.data !== undefined) {
    result.data = project.data;
  }

  return result;
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

    await ctx.db.replace(
      existing._id,
      toProjectDocument(ownerUserId, payload, incomingSchemaVersion, existing.createdAt),
    );

    await cleanupStorage(ctx, staleStorageId);

    return { action: "updated" as const, id: existing._id };
  }

  const id = await ctx.db.insert(
    "projects",
    toProjectDocument(ownerUserId, payload, incomingSchemaVersion, payload.createdAt),
  );

  return { action: "created" as const, id };
}

// List all projects from cloud
export const list = query({
  args: {},
  returns: v.array(projectSummaryValidator),
  handler: async (ctx) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
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

// Delete a project from cloud
export const remove = mutation({
  args: { localId: v.string() },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const projects = await listProjectsByLocalId(ctx, ownerUserId, args.localId);
    if (projects.length === 0) {
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

    return { deleted: true };
  },
});

// Get all full project data for sync down
export const listFull = query({
  args: {},
  returns: v.array(fullProjectValidator),
  handler: async (ctx) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const projects = await listProjectsForOwner(ctx, ownerUserId);
    const canonicalProjects = pickCanonicalProjectsByLocalId(projects);
    return await Promise.all(canonicalProjects.map((project) => toFull(ctx, project)));
  },
});
