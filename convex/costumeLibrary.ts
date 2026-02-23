import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const boundsValidator = v.object({
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
});

const costumeWithUrlValidator = v.object({
  _id: v.id("costumeLibrary"),
  _creationTime: v.number(),
  name: v.string(),
  storageId: v.id("_storage"),
  thumbnail: v.string(),
  bounds: v.optional(boundsValidator),
  mimeType: v.string(),
  size: v.number(),
  createdAt: v.number(),
  url: v.union(v.string(), v.null()),
});

export const list = query({
  args: {},
  returns: v.array(costumeWithUrlValidator),
  handler: async (ctx) => {
    const items = await ctx.db.query("costumeLibrary").collect();

    return await Promise.all(
      items.map(async (item) => ({
        ...item,
        url: await ctx.storage.getUrl(item.storageId),
      })),
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
    storageId: v.id("_storage"),
    thumbnail: v.string(),
    bounds: v.optional(boundsValidator),
    mimeType: v.string(),
    size: v.number(),
  },
  returns: v.id("costumeLibrary"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("costumeLibrary", {
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("costumeLibrary") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get(args.id);
    if (item) {
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
    await ctx.db.patch(args.id, { name: args.name });
    return null;
  },
});
