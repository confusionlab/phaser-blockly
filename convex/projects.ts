import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// List all projects from cloud
export const list = query({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    return projects.map((p) => ({
      _id: p._id,
      localId: p.localId,
      name: p.name,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      schemaVersion: p.schemaVersion,
    }));
  },
});

// Get a single project by localId
export const getByLocalId = query({
  args: { localId: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_localId", (q) => q.eq("localId", args.localId))
      .first();
    return project;
  },
});

// Get full project data by localId
export const getFullProject = query({
  args: { localId: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_localId", (q) => q.eq("localId", args.localId))
      .first();

    if (!project) return null;

    return {
      localId: project.localId,
      name: project.name,
      data: project.data,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      schemaVersion: project.schemaVersion,
    };
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
    schemaVersion: v.number(),
  },
  handler: async (ctx, args) => {
    // Check if project already exists in cloud
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_localId", (q) => q.eq("localId", args.localId))
      .first();

    if (existing) {
      // Only update if local version is newer
      if (args.updatedAt > existing.updatedAt) {
        await ctx.db.patch(existing._id, {
          name: args.name,
          data: args.data,
          updatedAt: args.updatedAt,
          schemaVersion: args.schemaVersion,
        });
        return { action: "updated", id: existing._id };
      }
      return { action: "skipped", id: existing._id, reason: "cloud version is newer" };
    } else {
      // Create new project in cloud
      const id = await ctx.db.insert("projects", {
        localId: args.localId,
        name: args.name,
        data: args.data,
        createdAt: args.createdAt,
        updatedAt: args.updatedAt,
        schemaVersion: args.schemaVersion,
      });
      return { action: "created", id };
    }
  },
});

// Sync multiple projects at once (batch sync on exit)
export const syncBatch = mutation({
  args: {
    projects: v.array(
      v.object({
        localId: v.string(),
        name: v.string(),
        data: v.string(),
        createdAt: v.number(),
        updatedAt: v.number(),
        schemaVersion: v.number(),
      })
    ),
  },
  handler: async (ctx, args) => {
    const results = [];

    for (const project of args.projects) {
      const existing = await ctx.db
        .query("projects")
        .withIndex("by_localId", (q) => q.eq("localId", project.localId))
        .first();

      if (existing) {
        if (project.updatedAt > existing.updatedAt) {
          await ctx.db.patch(existing._id, {
            name: project.name,
            data: project.data,
            updatedAt: project.updatedAt,
            schemaVersion: project.schemaVersion,
          });
          results.push({ localId: project.localId, action: "updated" });
        } else {
          results.push({ localId: project.localId, action: "skipped" });
        }
      } else {
        await ctx.db.insert("projects", {
          localId: project.localId,
          name: project.name,
          data: project.data,
          createdAt: project.createdAt,
          updatedAt: project.updatedAt,
          schemaVersion: project.schemaVersion,
        });
        results.push({ localId: project.localId, action: "created" });
      }
    }

    return results;
  },
});

// Delete a project from cloud
export const remove = mutation({
  args: { localId: v.string() },
  handler: async (ctx, args) => {
    const project = await ctx.db
      .query("projects")
      .withIndex("by_localId", (q) => q.eq("localId", args.localId))
      .first();

    if (project) {
      await ctx.db.delete(project._id);
      return { deleted: true };
    }
    return { deleted: false };
  },
});

// Get all full project data for sync down
export const listFull = query({
  args: {},
  handler: async (ctx) => {
    const projects = await ctx.db.query("projects").collect();
    return projects.map((p) => ({
      localId: p.localId,
      name: p.name,
      data: p.data,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      schemaVersion: p.schemaVersion,
    }));
  },
});
