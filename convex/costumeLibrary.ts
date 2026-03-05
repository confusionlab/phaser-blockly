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

const costumeWithUrlValidator = v.object({
  _id: v.id("costumeLibrary"),
  _creationTime: v.number(),
  name: v.string(),
  storageId: v.id("_storage"),
  thumbnail: v.string(),
  bounds: v.optional(boundsValidator),
  editorMode: v.optional(editorModeValidator),
  vectorDocument: v.optional(vectorDocumentValidator),
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
    editorMode: v.optional(editorModeValidator),
    vectorDocument: v.optional(vectorDocumentValidator),
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
