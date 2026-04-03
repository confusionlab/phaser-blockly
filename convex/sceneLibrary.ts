import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { migrateLegacySceneTemplate, sceneTemplateValidator } from "./libraryValidators";
import {
  buildTemplateRenamePatch,
  buildUserTemplateMetadata,
  canMutateTemplateRow,
  listVisibleTemplateRows,
  normalizeTemplateSchemaVersion,
  normalizeTemplateScope,
  requireAuthenticatedUserId,
  requireTemplateAssetRefs,
  resolveTemplateAssetUrl,
  templateScopeValidator,
} from "./templateLibrary";

const sceneLibraryAssetRefValidator = v.object({
  assetId: v.string(),
  kind: v.union(v.literal("image"), v.literal("audio"), v.literal("background")),
});

const sceneLibraryAssetWithUrlValidator = v.object({
  assetId: v.string(),
  kind: v.union(v.literal("image"), v.literal("audio"), v.literal("background")),
  url: v.union(v.string(), v.null()),
});

const sceneLibraryEntryValidator = v.object({
  _id: v.id("sceneLibrary"),
  _creationTime: v.number(),
  scope: templateScopeValidator,
  schemaVersion: v.number(),
  name: v.string(),
  thumbnail: v.string(),
  assetRefs: v.array(sceneLibraryAssetWithUrlValidator),
  template: sceneTemplateValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const list = query({
  args: {},
  returns: v.array(sceneLibraryEntryValidator),
  handler: async (ctx) => {
    const items = await listVisibleTemplateRows<{
      _id: Id<"sceneLibrary">;
      _creationTime: number;
      ownerUserId?: string;
      scope?: "system" | "user";
      schemaVersion?: number;
      name: string;
      thumbnail: string;
      assetRefs: Array<{ assetId: string; kind: "image" | "audio" | "background" }>;
      template: typeof sceneTemplateValidator.type;
      createdAt: number;
      updatedAt?: number;
    }>(ctx, "sceneLibrary");

    return await Promise.all(items.map(async (item) => ({
      _id: item._id,
      _creationTime: item._creationTime,
      scope: normalizeTemplateScope(item.scope, item.ownerUserId),
      schemaVersion: normalizeTemplateSchemaVersion(item.schemaVersion),
      name: item.name,
      thumbnail: item.thumbnail,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt ?? item.createdAt,
      template: migrateLegacySceneTemplate(item.template),
      assetRefs: await Promise.all(
        item.assetRefs.map(async (asset) => ({
          assetId: asset.assetId,
          kind: asset.kind,
          url: await resolveTemplateAssetUrl(ctx, {
            assetId: asset.assetId,
            ownerUserId: item.ownerUserId,
            scope: normalizeTemplateScope(item.scope, item.ownerUserId),
          }),
        })),
      ),
    })));
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    thumbnail: v.string(),
    assetRefs: v.array(sceneLibraryAssetRefValidator),
    template: sceneTemplateValidator,
  },
  returns: v.id("sceneLibrary"),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    await requireTemplateAssetRefs(ctx, {
      ownerUserId,
      scope: "user",
      refs: args.assetRefs,
    });
    return await ctx.db.insert("sceneLibrary", {
      ...buildUserTemplateMetadata(ownerUserId),
      name: args.name,
      thumbnail: args.thumbnail,
      assetRefs: args.assetRefs,
      template: args.template,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("sceneLibrary") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const item = await ctx.db.get(args.id);
    if (canMutateTemplateRow(item, ownerUserId)) {
      await ctx.db.delete(args.id);
    }
    return null;
  },
});

export const rename = mutation({
  args: { id: v.id("sceneLibrary"), name: v.string() },
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
