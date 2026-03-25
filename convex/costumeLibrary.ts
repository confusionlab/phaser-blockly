import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { boundsValidator, costumeDocumentValidator } from "./costumeValidators";

async function requireAuthenticatedUserId(ctx: any): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("unauthenticated");
  }
  return identity.subject;
}

function buildMigratedDocument(item: {
  document?: unknown;
  vectorDocument?: { fabricJson?: string } | null;
}): any {
  if (item.document) {
    return item.document;
  }

  const layerId = crypto.randomUUID();
  if (item.vectorDocument?.fabricJson) {
    return {
      version: 1,
      activeLayerId: layerId,
      layers: [{
        id: layerId,
        name: "Layer 1",
        visible: true,
        locked: false,
        opacity: 1,
        blendMode: "normal" as const,
        mask: null,
        effects: [],
        kind: "vector" as const,
        vector: {
          engine: "fabric" as const,
          version: 1 as const,
          fabricJson: item.vectorDocument.fabricJson,
        },
      }],
    };
  }

  return {
    version: 1,
    activeLayerId: layerId,
    layers: [{
      id: layerId,
      name: "Layer 1",
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: "normal" as const,
      mask: null,
      effects: [],
      kind: "bitmap" as const,
      width: 1024,
      height: 1024,
      bitmap: {
        assetId: null,
      },
    }],
  };
}

const costumeWithUrlValidator = v.object({
  _id: v.id("costumeLibrary"),
  _creationTime: v.number(),
  name: v.string(),
  storageId: v.id("_storage"),
  thumbnail: v.string(),
  bounds: v.optional(boundsValidator),
  document: costumeDocumentValidator,
  mimeType: v.string(),
  size: v.number(),
  createdAt: v.number(),
  url: v.union(v.string(), v.null()),
});

export const list = query({
  args: {},
  returns: v.array(costumeWithUrlValidator),
  handler: async (ctx) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const items = await ctx.db
      .query("costumeLibrary")
      .withIndex("by_ownerUserId_and_createdAt", (q) => q.eq("ownerUserId", ownerUserId))
      .order("desc")
      .collect();

    return await Promise.all(
      items.map(async (item) => {
        const { ownerUserId: _ownerUserId, ...rest } = item;
        return {
          ...rest,
        url: await ctx.storage.getUrl(item.storageId),
        };
      }),
    );
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
    storageId: v.id("_storage"),
    thumbnail: v.string(),
    bounds: v.optional(boundsValidator),
    document: costumeDocumentValidator,
    mimeType: v.string(),
    size: v.number(),
  },
  returns: v.id("costumeLibrary"),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    return await ctx.db.insert("costumeLibrary", {
      ownerUserId,
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("costumeLibrary") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const item = await ctx.db.get(args.id);
    if (item && item.ownerUserId === ownerUserId) {
      await ctx.storage.delete(item.storageId);
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
    if (!item || item.ownerUserId !== ownerUserId) {
      return null;
    }
    await ctx.db.patch(args.id, { name: args.name });
    return null;
  },
});

export const migrateLegacyDocuments = mutation({
  args: {},
  returns: v.object({
    migrated: v.number(),
    skipped: v.number(),
  }),
  handler: async (ctx) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const items = await ctx.db
      .query("costumeLibrary")
      .withIndex("by_ownerUserId_and_createdAt", (q) => q.eq("ownerUserId", ownerUserId))
      .collect();

    let migrated = 0;
    let skipped = 0;

    for (const item of items) {
      if ((item as { document?: unknown }).document) {
        skipped += 1;
        continue;
      }

      await ctx.db.patch(item._id, {
        document: buildMigratedDocument(item as { document?: unknown; vectorDocument?: { fabricJson?: string } | null }),
      });
      migrated += 1;
    }

    return { migrated, skipped };
  },
});
