import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { boundsValidator, costumeDocumentValidator } from "./costumeValidators";
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

const costumeLibraryAssetWithUrlValidator = v.object({
  assetId: v.string(),
  kind: v.literal("image"),
  url: v.union(v.string(), v.null()),
});

const costumeWithUrlValidator = v.object({
  _id: v.id("costumeLibrary"),
  _creationTime: v.number(),
  scope: templateScopeValidator,
  schemaVersion: v.number(),
  name: v.string(),
  thumbnail: v.string(),
  bounds: v.optional(boundsValidator),
  document: costumeDocumentValidator,
  assetRefs: v.array(costumeLibraryAssetWithUrlValidator),
  imageUrl: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

function collectCostumeAssetRefs(
  document: {
    layers?: Array<{
      kind?: unknown;
      bitmap?: { assetId?: unknown };
    }>;
  },
): Array<{ assetId: string; kind: "image" }> {
  const refsById = new Map<string, { assetId: string; kind: "image" }>();
  for (const layer of document.layers ?? []) {
    if (layer.kind !== "bitmap") {
      continue;
    }
    const assetId = layer.bitmap?.assetId;
    if (typeof assetId !== "string" || assetId.trim().length === 0) {
      continue;
    }
    refsById.set(assetId, { assetId, kind: "image" });
  }
  return Array.from(refsById.values());
}

export const list = query({
  args: {},
  returns: v.array(costumeWithUrlValidator),
  handler: async (ctx) => {
    const items = await listVisibleTemplateRows<{
      _id: Id<"costumeLibrary">;
      _creationTime: number;
      ownerUserId?: string;
      scope?: "system" | "user";
      schemaVersion?: number;
      name: string;
      thumbnail: string;
      bounds?: { x: number; y: number; width: number; height: number };
      document: typeof costumeDocumentValidator.type;
      assetRefs?: Array<{ assetId: string; kind: "image" }>;
      storageId?: Id<"_storage">;
      createdAt: number;
      updatedAt?: number;
    }>(ctx, "costumeLibrary");

    return await Promise.all(items.map(async (item) => {
      const scope = normalizeTemplateScope(item.scope, item.ownerUserId);
      const assetRefs = item.assetRefs ?? collectCostumeAssetRefs(item.document);
      const resolvedAssetRefs = await Promise.all(assetRefs.map(async (asset) => ({
        assetId: asset.assetId,
        kind: asset.kind,
        url: await resolveTemplateAssetUrl(ctx, {
          assetId: asset.assetId,
          ownerUserId: item.ownerUserId,
          scope,
        }),
      })));

      return {
        _id: item._id,
        _creationTime: item._creationTime,
        scope,
        schemaVersion: normalizeTemplateSchemaVersion(item.schemaVersion),
        name: item.name,
        thumbnail: item.thumbnail,
        bounds: item.bounds,
        document: item.document,
        assetRefs: resolvedAssetRefs,
        imageUrl: resolvedAssetRefs.find((asset) => asset.url)?.url ?? (
          item.storageId ? await ctx.storage.getUrl(item.storageId) : null
        ),
        createdAt: item.createdAt,
        updatedAt: item.updatedAt ?? item.createdAt,
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
    thumbnail: v.string(),
    bounds: v.optional(boundsValidator),
    document: costumeDocumentValidator,
  },
  returns: v.id("costumeLibrary"),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const assetRefs = collectCostumeAssetRefs(args.document);
    await requireTemplateAssetRefs(ctx, {
      ownerUserId,
      scope: "user",
      refs: assetRefs,
    });

    return await ctx.db.insert("costumeLibrary", {
      ...buildUserTemplateMetadata(ownerUserId),
      name: args.name,
      thumbnail: args.thumbnail,
      bounds: args.bounds,
      document: args.document,
      assetRefs,
    });
  },
});

export const remove = mutation({
  args: { id: v.id("costumeLibrary") },
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
  args: { id: v.id("costumeLibrary"), name: v.string() },
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
