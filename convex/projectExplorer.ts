import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { garbageCollectOwnedProjectAssets } from './projects';

const projectExplorerStateValidator = v.object({
  stateJson: v.string(),
  updatedAt: v.number(),
  contentHash: v.string(),
  assetIds: v.optional(v.array(v.string())),
});

async function requireAuthenticatedUserId(ctx: any): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error('unauthenticated');
  }
  return identity.subject;
}

export const get = query({
  args: {},
  returns: v.union(projectExplorerStateValidator, v.null()),
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return null;
    }

    const record = await ctx.db
      .query('projectExplorerStates')
      .withIndex('by_ownerUserId', (query) => query.eq('ownerUserId', identity.subject))
      .first();

    if (!record) {
      return null;
    }

    return {
      stateJson: record.stateJson,
      updatedAt: record.updatedAt,
      contentHash: record.contentHash,
      assetIds: record.assetIds,
    };
  },
});

export const sync = mutation({
  args: projectExplorerStateValidator,
  returns: v.object({
    action: v.union(v.literal('created'), v.literal('updated'), v.literal('skipped')),
    reason: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const existing = await ctx.db
      .query('projectExplorerStates')
      .withIndex('by_ownerUserId', (query) => query.eq('ownerUserId', ownerUserId))
      .first();

    if (!existing) {
      await ctx.db.insert('projectExplorerStates', {
        ownerUserId,
        stateJson: args.stateJson,
        updatedAt: args.updatedAt,
        contentHash: args.contentHash,
        assetIds: args.assetIds,
      });
      await garbageCollectOwnedProjectAssets(ctx, ownerUserId, args.assetIds ?? []);
      return { action: 'created' as const };
    }

    if (args.updatedAt < existing.updatedAt) {
      return { action: 'skipped' as const, reason: 'cloud explorer state is newer' };
    }

    if (args.updatedAt === existing.updatedAt && args.contentHash === existing.contentHash) {
      return { action: 'skipped' as const, reason: 'already in sync' };
    }

    if (args.updatedAt === existing.updatedAt && args.contentHash < existing.contentHash) {
      return { action: 'skipped' as const, reason: 'cloud explorer state wins timestamp tie' };
    }

    await ctx.db.patch(existing._id, {
      stateJson: args.stateJson,
      updatedAt: args.updatedAt,
      contentHash: args.contentHash,
      assetIds: args.assetIds,
    });
    await garbageCollectOwnedProjectAssets(ctx, ownerUserId, [
      ...(existing.assetIds ?? []),
      ...(args.assetIds ?? []),
    ]);

    return { action: 'updated' as const };
  },
});
