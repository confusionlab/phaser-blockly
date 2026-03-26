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

function buildMigratedCostumeDocument(costume: {
  document?: unknown;
  vectorDocument?: { fabricJson?: string } | null;
}): any {
  if (costume.document) {
    return costume.document;
  }

  const layerId = crypto.randomUUID();
  if (costume.vectorDocument?.fabricJson) {
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
          fabricJson: costume.vectorDocument.fabricJson,
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

const physicsValidator = v.object({
  enabled: v.boolean(),
  bodyType: v.union(v.literal("dynamic"), v.literal("static")),
  gravityY: v.number(),
  velocityX: v.number(),
  velocityY: v.number(),
  bounce: v.number(),
  friction: v.number(),
  allowRotation: v.boolean(),
});

const colliderValidator = v.object({
  type: v.union(
    v.literal("none"),
    v.literal("box"),
    v.literal("circle"),
    v.literal("capsule"),
  ),
  offsetX: v.number(),
  offsetY: v.number(),
  width: v.number(),
  height: v.number(),
  radius: v.number(),
});

const objectLibraryCostumeValidator = v.object({
  id: v.string(),
  name: v.string(),
  storageId: v.id("_storage"),
  bounds: v.optional(boundsValidator),
  document: costumeDocumentValidator,
});

const objectLibrarySoundValidator = v.object({
  id: v.string(),
  name: v.string(),
  storageId: v.id("_storage"),
  duration: v.optional(v.number()),
  trimStart: v.optional(v.number()),
  trimEnd: v.optional(v.number()),
});

const variableValidator = v.object({
  id: v.string(),
  name: v.string(),
  type: v.union(
    v.literal("string"),
    v.literal("integer"),
    v.literal("float"),
    v.literal("boolean"),
  ),
  defaultValue: v.union(v.number(), v.string(), v.boolean()),
  scope: v.union(v.literal("global"), v.literal("local")),
  objectId: v.optional(v.string()),
});

const objectLibraryCostumeWithUrlValidator = v.object({
  id: v.string(),
  name: v.string(),
  storageId: v.id("_storage"),
  bounds: v.optional(boundsValidator),
  document: costumeDocumentValidator,
  url: v.union(v.string(), v.null()),
});

const objectLibrarySoundWithUrlValidator = v.object({
  id: v.string(),
  name: v.string(),
  storageId: v.id("_storage"),
  duration: v.optional(v.number()),
  trimStart: v.optional(v.number()),
  trimEnd: v.optional(v.number()),
  url: v.union(v.string(), v.null()),
});

const objectLibraryWithUrlsValidator = v.object({
  _id: v.id("objectLibrary"),
  _creationTime: v.number(),
  name: v.string(),
  thumbnail: v.string(),
  costumes: v.array(objectLibraryCostumeWithUrlValidator),
  sounds: v.array(objectLibrarySoundWithUrlValidator),
  blocklyXml: v.string(),
  currentCostumeIndex: v.optional(v.number()),
  physics: v.optional(physicsValidator),
  collider: v.optional(colliderValidator),
  localVariables: v.optional(v.array(variableValidator)),
  createdAt: v.number(),
});

export const list = query({
  args: {},
  returns: v.array(objectLibraryWithUrlsValidator),
  handler: async (ctx) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const items = await ctx.db
      .query("objectLibrary")
      .withIndex("by_ownerUserId_and_createdAt", (q) => q.eq("ownerUserId", ownerUserId))
      .order("desc")
      .collect();

    return await Promise.all(
      items.map(async (item) => {
        const costumesWithUrls = await Promise.all(
          item.costumes.map(async (costume) => ({
            id: costume.id,
            name: costume.name,
            storageId: costume.storageId,
            bounds: costume.bounds,
            document: buildMigratedCostumeDocument(costume as { document?: unknown; vectorDocument?: { fabricJson?: string } | null }),
            url: await ctx.storage.getUrl(costume.storageId),
          })),
        );

        const soundsWithUrls = await Promise.all(
          item.sounds.map(async (sound) => ({
            ...sound,
            url: await ctx.storage.getUrl(sound.storageId),
          })),
        );

        return {
          _id: item._id,
          _creationTime: item._creationTime,
          name: item.name,
          thumbnail: item.thumbnail,
          blocklyXml: item.blocklyXml,
          currentCostumeIndex: item.currentCostumeIndex,
          physics: item.physics,
          collider: item.collider,
          localVariables: item.localVariables,
          createdAt: item.createdAt,
          costumes: costumesWithUrls,
          sounds: soundsWithUrls,
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
    thumbnail: v.string(),
    costumes: v.array(objectLibraryCostumeValidator),
    sounds: v.array(objectLibrarySoundValidator),
    blocklyXml: v.string(),
    currentCostumeIndex: v.number(),
    physics: v.optional(physicsValidator),
    collider: v.optional(colliderValidator),
    localVariables: v.array(variableValidator),
  },
  returns: v.id("objectLibrary"),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    return await ctx.db.insert("objectLibrary", {
      ownerUserId,
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("objectLibrary") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const item = await ctx.db.get(args.id);
    if (item && item.ownerUserId === ownerUserId) {
      for (const costume of item.costumes) {
        await ctx.storage.delete(costume.storageId);
      }
      for (const sound of item.sounds) {
        await ctx.storage.delete(sound.storageId);
      }
      await ctx.db.delete(args.id);
    }
    return null;
  },
});

export const rename = mutation({
  args: { id: v.id("objectLibrary"), name: v.string() },
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
      .query("objectLibrary")
      .withIndex("by_ownerUserId_and_createdAt", (q) => q.eq("ownerUserId", ownerUserId))
      .collect();

    let migrated = 0;
    let skipped = 0;

    for (const item of items) {
      const needsMigration = item.costumes.some((costume) => !(costume as { document?: unknown }).document);
      if (!needsMigration) {
        skipped += 1;
        continue;
      }

      await ctx.db.patch(item._id, {
        costumes: item.costumes.map((costume) => ({
          ...costume,
          document: buildMigratedCostumeDocument(costume as { document?: unknown; vectorDocument?: { fabricJson?: string } | null }),
        })),
      });
      migrated += 1;
    }

    return { migrated, skipped };
  },
});
