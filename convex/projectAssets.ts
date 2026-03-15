import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const assetKindValidator = v.union(
  v.literal("image"),
  v.literal("audio"),
  v.literal("background"),
);

async function requireAuthenticatedUserId(ctx: any): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("unauthenticated");
  }
  return identity.subject;
}

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireAuthenticatedUserId(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const listMissing = query({
  args: {
    assetIds: v.array(v.string()),
  },
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const uniqueIds = Array.from(new Set(args.assetIds.filter((assetId) => assetId.trim().length > 0)));
    if (uniqueIds.length === 0) {
      return [];
    }

    const rows = await Promise.all(uniqueIds.map(async (assetId) => {
      return await ctx.db
        .query("projectAssets")
        .withIndex("by_ownerUserId_and_assetId", (q) => q.eq("ownerUserId", ownerUserId).eq("assetId", assetId))
        .first();
    }));

    return uniqueIds.filter((_assetId, index) => !rows[index]);
  },
});

export const upsert = mutation({
  args: {
    assetId: v.string(),
    kind: assetKindValidator,
    mimeType: v.string(),
    size: v.number(),
    storageId: v.id("_storage"),
  },
  returns: v.object({
    assetId: v.string(),
    storageId: v.id("_storage"),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const existing = await ctx.db
      .query("projectAssets")
      .withIndex("by_ownerUserId_and_assetId", (q) => q.eq("ownerUserId", ownerUserId).eq("assetId", args.assetId))
      .first();

    if (existing) {
      if (existing.storageId !== args.storageId) {
        await ctx.storage.delete(args.storageId);
      }
      return {
        assetId: existing.assetId,
        storageId: existing.storageId,
      };
    }

    await ctx.db.insert("projectAssets", {
      ownerUserId,
      assetId: args.assetId,
      kind: args.kind,
      mimeType: args.mimeType,
      size: args.size,
      storageId: args.storageId,
      createdAt: Date.now(),
    });

    return {
      assetId: args.assetId,
      storageId: args.storageId,
    };
  },
});

export const getMany = query({
  args: {
    assetIds: v.array(v.string()),
  },
  returns: v.array(v.object({
    assetId: v.string(),
    kind: assetKindValidator,
    mimeType: v.string(),
    size: v.number(),
    storageId: v.id("_storage"),
    url: v.union(v.string(), v.null()),
  })),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const uniqueIds = Array.from(new Set(args.assetIds.filter((assetId) => assetId.trim().length > 0)));
    if (uniqueIds.length === 0) {
      return [];
    }

    const rows = await Promise.all(uniqueIds.map(async (assetId) => {
      return await ctx.db
        .query("projectAssets")
        .withIndex("by_ownerUserId_and_assetId", (q) => q.eq("ownerUserId", ownerUserId).eq("assetId", assetId))
        .first();
    }));

    const existingRows = rows.filter((row): row is NonNullable<typeof row> => row !== null);
    return await Promise.all(existingRows.map(async (row) => ({
      assetId: row.assetId,
      kind: row.kind,
      mimeType: row.mimeType,
      size: row.size,
      storageId: row.storageId as Id<"_storage">,
      url: await ctx.storage.getUrl(row.storageId),
    })));
  },
});
