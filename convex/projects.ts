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
});

const fullProjectValidator = v.object({
  localId: v.string(),
  name: v.string(),
  data: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  schemaVersion: v.number(),
  appVersion: v.optional(v.string()),
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

type SyncPayload = {
  localId: string;
  name: string;
  data: string;
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

function toSummary(project: {
  _id: Id<"projects">;
  localId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number | string;
  appVersion?: string;
}) {
  return {
    _id: project._id,
    localId: project.localId,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    schemaVersion: normalizeSchemaVersion(project.schemaVersion),
    appVersion: project.appVersion,
  };
}

function toFull(project: {
  localId: string;
  name: string;
  data: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: number | string;
  appVersion?: string;
}) {
  return {
    localId: project.localId,
    name: project.name,
    data: project.data,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    schemaVersion: normalizeSchemaVersion(project.schemaVersion),
    appVersion: project.appVersion,
  };
}

async function upsertProject(ctx: any, payload: SyncPayload) {
  const incomingSchemaVersion = normalizeSchemaVersion(payload.schemaVersion);

  const existing = await ctx.db
    .query("projects")
    .withIndex("by_localId", (q: any) => q.eq("localId", payload.localId))
    .unique();

  if (existing) {
    const existingSchemaVersion = normalizeSchemaVersion(existing.schemaVersion);
    const shouldUpdate =
      payload.updatedAt > existing.updatedAt ||
      incomingSchemaVersion > existingSchemaVersion;

    if (shouldUpdate) {
      await ctx.db.patch(existing._id, {
        name: payload.name,
        data: payload.data,
        updatedAt: payload.updatedAt,
        schemaVersion: incomingSchemaVersion,
        appVersion: payload.appVersion,
      });
      return { action: "updated" as const, id: existing._id };
    }

    return {
      action: "skipped" as const,
      id: existing._id,
      reason: "cloud version is newer or equal",
    };
  }

  const id = await ctx.db.insert("projects", {
    localId: payload.localId,
    name: payload.name,
    data: payload.data,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    schemaVersion: incomingSchemaVersion,
    appVersion: payload.appVersion,
  });

  return { action: "created" as const, id };
}

// List all projects from cloud
export const list = query({
  args: {},
  returns: v.array(projectSummaryValidator),
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    return projects.map(toSummary);
  },
});

// Get a single project by localId
export const getByLocalId = query({
  args: { localId: v.string() },
  returns: v.union(projectSummaryValidator, v.null()),
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_localId", (q) => q.eq("localId", args.localId))
      .unique();

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
    const project = await ctx.db
      .query("projects")
      .withIndex("by_localId", (q) => q.eq("localId", args.localId))
      .unique();

    if (!project) {
      return null;
    }

    return toFull(project);
  },
});

// Sync a project to cloud (upsert based on localId)
export const sync = mutation({
  args: {
    localId: v.string(),
    name: v.string(),
    data: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    schemaVersion: v.optional(schemaVersionValidator),
    appVersion: v.optional(v.string()),
  },
  returns: syncResultValidator,
  handler: async (ctx, args) => {
    return await upsertProject(ctx, args);
  },
});

// Sync multiple projects at once
export const syncBatch = mutation({
  args: {
    projects: v.array(
      v.object({
        localId: v.string(),
        name: v.string(),
        data: v.string(),
        createdAt: v.number(),
        updatedAt: v.number(),
        schemaVersion: v.optional(schemaVersionValidator),
        appVersion: v.optional(v.string()),
      }),
    ),
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
  args: {
    localId: v.string(),
    name: v.string(),
    data: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    schemaVersion: v.optional(schemaVersionValidator),
    appVersion: v.optional(v.string()),
  },
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
    const project = await ctx.db
      .query("projects")
      .withIndex("by_localId", (q) => q.eq("localId", args.localId))
      .unique();

    if (!project) {
      return { deleted: false };
    }

    await ctx.db.delete(project._id);
    return { deleted: true };
  },
});

// Get all full project data for sync down
export const listFull = query({
  args: {},
  returns: v.array(fullProjectValidator),
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    return projects.map(toFull);
  },
});
