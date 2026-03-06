import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  DEFAULT_ASSISTANT_MODEL_MODE,
} from "../packages/ui-shared/src/assistantModels";

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
      assistantModelMode: v.optional(v.union(v.literal("fast"), v.literal("smart"))),
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
      assistantModelMode: doc.assistantModelMode ?? DEFAULT_ASSISTANT_MODEL_MODE,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  },
});

export const updateMySettings = mutation({
  args: {
    isDarkMode: v.optional(v.boolean()),
    assistantModelMode: v.optional(v.union(v.literal("fast"), v.literal("smart"))),
  },
  returns: v.object({
    isDarkMode: v.optional(v.boolean()),
    assistantModelMode: v.optional(v.union(v.literal("fast"), v.literal("smart"))),
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
        assistantModelMode: args.assistantModelMode ?? DEFAULT_ASSISTANT_MODEL_MODE,
        createdAt: now,
        updatedAt: now,
      });
      const inserted = await ctx.db.get(insertedId);
      if (!inserted) {
        throw new Error("failed_to_create_user_settings");
      }
      return {
        isDarkMode: inserted.isDarkMode,
        assistantModelMode: inserted.assistantModelMode ?? DEFAULT_ASSISTANT_MODEL_MODE,
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
    if (args.assistantModelMode !== undefined) {
      patch.assistantModelMode = args.assistantModelMode;
    }

    await ctx.db.patch(existing._id, patch);
    const updated = await ctx.db.get(existing._id);
    if (!updated) {
      throw new Error("failed_to_update_user_settings");
    }
    return {
      isDarkMode: updated.isDarkMode,
      assistantModelMode: updated.assistantModelMode ?? DEFAULT_ASSISTANT_MODEL_MODE,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    };
  },
});
