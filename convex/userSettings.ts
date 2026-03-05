import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

async function requireAuthenticatedUserId(ctx: any): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("unauthenticated");
  }
  return identity.subject;
}

export const getMySettings = query({
  args: {},
  returns: v.union(
    v.null(),
    v.object({
      isDarkMode: v.optional(v.boolean()),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await requireAuthenticatedUserId(ctx);
    const doc = await ctx.db
      .query("userSettings")
      .withIndex("by_userId", (q: any) => q.eq("userId", userId))
      .first();

    if (!doc) {
      return null;
    }

    return {
      isDarkMode: doc.isDarkMode,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  },
});

export const updateMySettings = mutation({
  args: {
    isDarkMode: v.optional(v.boolean()),
  },
  returns: v.object({
    isDarkMode: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }),
  handler: async (ctx, args) => {
    const userId = await requireAuthenticatedUserId(ctx);
    const now = Date.now();
    const existing = await ctx.db
      .query("userSettings")
      .withIndex("by_userId", (q: any) => q.eq("userId", userId))
      .first();

    if (!existing) {
      const insertedId = await ctx.db.insert("userSettings", {
        userId,
        isDarkMode: args.isDarkMode,
        createdAt: now,
        updatedAt: now,
      });
      const inserted = await ctx.db.get(insertedId);
      if (!inserted) {
        throw new Error("failed_to_create_user_settings");
      }
      return {
        isDarkMode: inserted.isDarkMode,
        createdAt: inserted.createdAt,
        updatedAt: inserted.updatedAt,
      };
    }

    const patch: Record<string, unknown> = {
      updatedAt: now,
    };
    if (args.isDarkMode !== undefined) {
      patch.isDarkMode = args.isDarkMode;
    }

    await ctx.db.patch(existing._id, patch);
    const updated = await ctx.db.get(existing._id);
    if (!updated) {
      throw new Error("failed_to_update_user_settings");
    }
    return {
      isDarkMode: updated.isDarkMode,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  },
});
