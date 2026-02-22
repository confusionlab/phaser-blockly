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
  friction: v.number(),
  allowRotation: v.boolean(),
});

const colliderValidator = v.object({
  type: v.union(
    v.literal("none"),
    v.literal("box"),
    v.literal("circle"),
    v.literal("capsule")
  ),
  offsetX: v.number(),
  offsetY: v.number(),
  width: v.number(),
  height: v.number(),
  radius: v.number(),
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const items = await ctx.db.query("objectLibrary").collect();

    return Promise.all(
      items.map(async (item) => {
        // Resolve URLs for all costumes
        const costumesWithUrls = await Promise.all(
          item.costumes.map(async (costume) => ({
            ...costume,
            url: await ctx.storage.getUrl(costume.storageId),
          }))
        );

        // Resolve URLs for all sounds
        const soundsWithUrls = await Promise.all(
          item.sounds.map(async (sound) => ({
            ...sound,
            url: await ctx.storage.getUrl(sound.storageId),
          }))
        );

        return {
          ...item,
          costumes: costumesWithUrls,
          sounds: soundsWithUrls,
        };
      })
    );
  },
});

export const generateUploadUrl = mutation({
  handler: async (ctx) => {
    return await ctx.storage.generateUploadUrl();
  },
});

export const create = mutation({
  args: {
    name: v.string(),
    thumbnail: v.string(),
    costumes: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        storageId: v.id("_storage"),
        bounds: v.optional(boundsValidator),
      })
    ),
    sounds: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        storageId: v.id("_storage"),
      })
    ),
    blocklyXml: v.string(),
    physics: v.optional(physicsValidator),
    collider: v.optional(colliderValidator),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("objectLibrary", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("objectLibrary") },
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.id);
    if (item) {
      // Delete all costume storage files
      for (const costume of item.costumes) {
        await ctx.storage.delete(costume.storageId);
      }
      // Delete all sound storage files
      for (const sound of item.sounds) {
        await ctx.storage.delete(sound.storageId);
      }
      // Delete the database record
      await ctx.db.delete(args.id);
    }
  },
});

export const rename = mutation({
  args: { id: v.id("objectLibrary"), name: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { name: args.name });
  },
});
