import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

async function requireAuthenticatedUserId(ctx: any): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("unauthenticated");
  }
  return identity.subject;
}

const boundsValidator = v.object({
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
});

const editorModeValidator = v.union(v.literal("bitmap"), v.literal("vector"));

const vectorDocumentValidator = v.object({
  version: v.literal(1),
  fabricJson: v.string(),
});

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
  editorMode: v.optional(editorModeValidator),
  vectorDocument: v.optional(vectorDocumentValidator),
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
  editorMode: v.optional(editorModeValidator),
  vectorDocument: v.optional(vectorDocumentValidator),
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
            ...costume,
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
