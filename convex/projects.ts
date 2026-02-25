import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
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
});

type StoredProject = {
  _id: Id<"projects">;
  localId: string;
  name: string;
  storageId?: Id<"_storage">;
  data?: string;
  dataSizeBytes?: number;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number | string;
  appVersion?: string;
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
};

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

function toSummary(project: StoredProject) {
  const summary: {
    _id: Id<"projects">;
    localId: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    schemaVersion: number;
    appVersion?: string;
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
  payload: SyncPayload,
  normalizedSchemaVersion: number,
  createdAt: number,
) {
  const base: {
    localId: string;
    name: string;
    createdAt: number;
    updatedAt: number;
    schemaVersion: number;
    appVersion?: string;
    dataSizeBytes?: number;
  } = {
    localId: payload.localId,
    name: payload.name,
    createdAt,
    updatedAt: payload.updatedAt,
    schemaVersion: normalizedSchemaVersion,
  };

  if (payload.appVersion !== undefined) {
    base.appVersion = payload.appVersion;
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

async function upsertProject(ctx: any, payload: SyncPayload) {
  const incomingSchemaVersion = normalizeSchemaVersion(payload.schemaVersion);

  const existing = (await ctx.db
    .query("projects")
    .withIndex("by_localId", (q: any) => q.eq("localId", payload.localId))
    .unique()) as StoredProject | null;

  if (existing) {
    const existingSchemaVersion = normalizeSchemaVersion(existing.schemaVersion);
    const shouldUpdate =
      payload.updatedAt > existing.updatedAt ||
      incomingSchemaVersion > existingSchemaVersion;

    if (!shouldUpdate) {
      // Uploaded storage blobs should not be orphaned when updates are skipped.
      const uploadedStorageId =
        payload.storageId && payload.storageId !== existing.storageId
          ? payload.storageId
          : undefined;
      await cleanupStorage(ctx, uploadedStorageId);
      return {
        action: "skipped" as const,
        id: existing._id,
        reason: "cloud version is newer or equal",
      };
    }

    const staleStorageId = payload.storageId
      ? existing.storageId && existing.storageId !== payload.storageId
        ? existing.storageId
        : undefined
      : existing.storageId;

    await ctx.db.replace(
      existing._id,
      toProjectDocument(payload, incomingSchemaVersion, existing.createdAt),
    );

    await cleanupStorage(ctx, staleStorageId);

    return { action: "updated" as const, id: existing._id };
  }

  const id = await ctx.db.insert(
    "projects",
    toProjectDocument(payload, incomingSchemaVersion, payload.createdAt),
  );

  return { action: "created" as const, id };
}

// List all projects from cloud
export const list = query({
  args: {},
  returns: v.array(projectSummaryValidator),
  handler: async (ctx) => {
    const projects = (await ctx.db.query("projects").collect()) as StoredProject[];
    return projects.map(toSummary);
  },
});

// Get a single project by localId
export const getByLocalId = query({
  args: { localId: v.string() },
  returns: v.union(projectSummaryValidator, v.null()),
  handler: async (ctx, args) => {
    const project = (await ctx.db
      .query("projects")
      .withIndex("by_localId", (q) => q.eq("localId", args.localId))
      .unique()) as StoredProject | null;

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
    const project = (await ctx.db
      .query("projects")
      .withIndex("by_localId", (q) => q.eq("localId", args.localId))
      .unique()) as StoredProject | null;

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
    return await ctx.storage.generateUploadUrl();
  },
});

// Sync a project to cloud (upsert based on localId)
export const sync = mutation({
  args: syncPayloadValidator,
  returns: syncResultValidator,
  handler: async (ctx, args) => {
    return await upsertProject(ctx, args);
  },
});

// Sync multiple projects at once
export const syncBatch = mutation({
  args: {
    projects: v.array(syncPayloadValidator),
  },
  returns: v.array(syncBatchResultValidator),
  handler: async (ctx, args) => {
    const results = [];

    for (const project of args.projects) {
      const result = await upsertProject(ctx, project);
      results.push({
        localId: project.localId,
        action: result.action,
        reason: result.reason,
      });
    }

    return results;
  },
});

// Internal mutation for sync beacons
export const syncBeacon = internalMutation({
  args: syncPayloadValidator,
  returns: v.null(),
  handler: async (ctx, args) => {
    await upsertProject(ctx, args);
    return null;
  },
});

// Delete a project from cloud
export const remove = mutation({
  args: { localId: v.string() },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args) => {
    const project = (await ctx.db
      .query("projects")
      .withIndex("by_localId", (q) => q.eq("localId", args.localId))
      .unique()) as StoredProject | null;

    if (!project) {
      return { deleted: false };
    }

    await cleanupStorage(ctx, project.storageId);
    await ctx.db.delete(project._id);
    return { deleted: true };
  },
});

// Get all full project data for sync down
export const listFull = query({
  args: {},
  returns: v.array(fullProjectValidator),
  handler: async (ctx) => {
    const projects = (await ctx.db.query("projects").collect()) as StoredProject[];
    return await Promise.all(projects.map((project) => toFull(ctx, project)));
  },
});
