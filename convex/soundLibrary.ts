import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

async function requireAuthenticatedUserId(ctx: any): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("unauthenticated");
  }
  return identity.subject;
}

const soundWithUrlValidator = v.object({
  _id: v.id("soundLibrary"),
  _creationTime: v.number(),
  name: v.string(),
  storageId: v.id("_storage"),
  mimeType: v.string(),
  size: v.number(),
  duration: v.optional(v.number()),
  createdAt: v.number(),
  url: v.union(v.string(), v.null()),
});

export const list = query({
  args: {},
  returns: v.array(soundWithUrlValidator),
  handler: async (ctx) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const items = await ctx.db
      .query("soundLibrary")
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
    mimeType: v.string(),
    size: v.number(),
    duration: v.optional(v.number()),
  },
  returns: v.id("soundLibrary"),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    return await ctx.db.insert("soundLibrary", {
      ownerUserId,
      ...args,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("soundLibrary") },
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
  args: { id: v.id("soundLibrary"), name: v.string() },
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
