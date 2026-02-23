import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

const libraryItemWithUrlValidator = v.object({
  _id: v.id("library"),
  _creationTime: v.number(),
  name: v.string(),
  type: v.union(v.literal("image"), v.literal("sound")),
  storageId: v.id("_storage"),
  thumbnail: v.optional(v.string()),
  mimeType: v.string(),
  size: v.number(),
  url: v.union(v.string(), v.null()),
});

export const list = query({
  args: { type: v.optional(v.union(v.literal("image"), v.literal("sound"))) },
  returns: v.array(libraryItemWithUrlValidator),
  handler: async (ctx, args) => {
    const itemType = args.type;
    const items = itemType !== undefined
      ? await ctx.db.query("library").withIndex("by_type", (q) => q.eq("type", itemType)).collect()
      : await ctx.db.query("library").collect();

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
    type: v.union(v.literal("image"), v.literal("sound")),
    storageId: v.id("_storage"),
    thumbnail: v.optional(v.string()),
    mimeType: v.string(),
    size: v.number(),
  },
  returns: v.id("library"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("library", args);
  },
});

export const remove = mutation({
  args: { id: v.id("library") },
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
  args: { id: v.id("library"), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.id, { name: args.name });
    return null;
  },
});
