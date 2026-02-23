import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const boundsValidator = v.object({
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
});

const physicsValidator = v.object({
  enabled: v.boolean(),
  bodyType: v.union(v.literal("dynamic"), v.literal("static")),
  gravityY: v.number(),
  velocityX: v.number(),
  velocityY: v.number(),
  bounce: v.number(),
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
});

const objectLibrarySoundValidator = v.object({
  id: v.string(),
  name: v.string(),
  storageId: v.id("_storage"),
});

const objectLibraryCostumeWithUrlValidator = v.object({
  id: v.string(),
  name: v.string(),
  storageId: v.id("_storage"),
  bounds: v.optional(boundsValidator),
  url: v.union(v.string(), v.null()),
});

const objectLibrarySoundWithUrlValidator = v.object({
  id: v.string(),
  name: v.string(),
  storageId: v.id("_storage"),
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
  physics: v.optional(physicsValidator),
  collider: v.optional(colliderValidator),
  createdAt: v.number(),
});

export const list = query({
  args: {},
  returns: v.array(objectLibraryWithUrlsValidator),
  handler: async (ctx) => {
    const items = await ctx.db.query("objectLibrary").collect();

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
          ...item,
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
    physics: v.optional(physicsValidator),
    collider: v.optional(colliderValidator),
  },
  returns: v.id("objectLibrary"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("objectLibrary", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("objectLibrary") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.id);
    if (item) {
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
    await ctx.db.patch(args.id, { name: args.name });
    return null;
  },
});
