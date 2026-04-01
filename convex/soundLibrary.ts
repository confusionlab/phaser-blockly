import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  buildTemplateRenamePatch,
  buildUserTemplateMetadata,
  canMutateTemplateRow,
  findTemplateAssetRow,
  listVisibleTemplateRows,
  normalizeTemplateSchemaVersion,
  normalizeTemplateScope,
  requireAuthenticatedUserId,
  requireTemplateAssetRefs,
  resolveTemplateAssetUrl,
  templateScopeValidator,
} from "./templateLibrary";

const soundWithUrlValidator = v.object({
  _id: v.id("soundLibrary"),
  _creationTime: v.number(),
  scope: templateScopeValidator,
  schemaVersion: v.number(),
  name: v.string(),
  assetId: v.optional(v.string()),
  mimeType: v.optional(v.string()),
  size: v.optional(v.number()),
  duration: v.optional(v.number()),
  trimStart: v.optional(v.number()),
  trimEnd: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  url: v.union(v.string(), v.null()),
});

export const list = query({
  args: {},
  returns: v.array(soundWithUrlValidator),
  handler: async (ctx) => {
    const items = await listVisibleTemplateRows<{
      _id: Id<"soundLibrary">;
      _creationTime: number;
      ownerUserId?: string;
      scope?: "system" | "user";
      schemaVersion?: number;
      name: string;
      assetId?: string;
      storageId?: Id<"_storage">;
      mimeType?: string;
      size?: number;
      duration?: number;
      trimStart?: number;
      trimEnd?: number;
      createdAt: number;
      updatedAt?: number;
    }>(ctx, "soundLibrary");

    return await Promise.all(items.map(async (item) => {
      const scope = normalizeTemplateScope(item.scope, item.ownerUserId);
      const resolvedAsset = item.assetId
        ? await findTemplateAssetRow(ctx, {
            assetId: item.assetId,
            ownerUserId: item.ownerUserId,
            scope,
          })
        : null;

      return {
        _id: item._id,
        _creationTime: item._creationTime,
        scope,
        schemaVersion: normalizeTemplateSchemaVersion(item.schemaVersion),
        name: item.name,
        assetId: item.assetId,
        mimeType: resolvedAsset?.mimeType ?? item.mimeType,
        size: resolvedAsset?.size ?? item.size,
        duration: item.duration,
        trimStart: item.trimStart,
        trimEnd: item.trimEnd,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt ?? item.createdAt,
        url: item.assetId
          ? await resolveTemplateAssetUrl(ctx, {
              assetId: item.assetId,
              ownerUserId: item.ownerUserId,
              scope,
            })
          : (item.storageId ? await ctx.storage.getUrl(item.storageId) : null),
      };
    }));
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

export const create = mutation({
  args: {
    name: v.string(),
    assetId: v.string(),
    duration: v.optional(v.number()),
    trimStart: v.optional(v.number()),
    trimEnd: v.optional(v.number()),
  },
  returns: v.id("soundLibrary"),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    await requireTemplateAssetRefs(ctx, {
      ownerUserId,
      scope: "user",
      refs: [{ assetId: args.assetId, kind: "audio" }],
    });

    const asset = await findTemplateAssetRow(ctx, {
      assetId: args.assetId,
      ownerUserId,
      scope: "user",
    });

    return await ctx.db.insert("soundLibrary", {
      ...buildUserTemplateMetadata(ownerUserId),
      name: args.name,
      assetId: args.assetId,
      mimeType: asset?.mimeType,
      size: asset?.size,
      duration: args.duration,
      trimStart: args.trimStart,
      trimEnd: args.trimEnd,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("soundLibrary") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const item = await ctx.db.get(args.id);
    if (item && canMutateTemplateRow(item, ownerUserId)) {
      if (item.storageId) {
        await ctx.storage.delete(item.storageId);
      }
      await ctx.db.delete(args.id);
    }
    return null;
  },
});

export const rename = mutation({
  args: { id: v.id("soundLibrary"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const item = await ctx.db.get(args.id);
    if (!canMutateTemplateRow(item, ownerUserId)) {
      return null;
    }
    await ctx.db.patch(args.id, buildTemplateRenamePatch(args.name));
    return null;
  },
});
