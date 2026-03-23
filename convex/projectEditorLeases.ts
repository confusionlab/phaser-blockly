import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

const LEASE_STALE_AFTER_MS = 30_000;

type StoredProjectEditorLease = {
  _id: Id<"projectEditorLeases">;
  ownerUserId: string;
  projectLocalId: string;
  editorSessionId: string;
  acquiredAt: number;
  heartbeatAt: number;
};

const leaseStatusValidator = v.object({
  state: v.union(
    v.literal("available"),
    v.literal("held_by_current"),
    v.literal("held_by_other"),
  ),
  activeEditorSessionId: v.union(v.string(), v.null()),
  heartbeatAt: v.union(v.number(), v.null()),
  staleAt: v.union(v.number(), v.null()),
});

const acquireLeaseResultValidator = v.object({
  status: v.union(v.literal("acquired"), v.literal("taken_over"), v.literal("blocked")),
  activeEditorSessionId: v.string(),
  heartbeatAt: v.number(),
  staleAt: v.number(),
});

async function requireAuthenticatedUserId(ctx: any): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("unauthenticated");
  }
  return identity.subject;
}

async function listProjectLeases(
  ctx: any,
  ownerUserId: string,
  projectLocalId: string,
): Promise<StoredProjectEditorLease[]> {
  return (await ctx.db
    .query("projectEditorLeases")
    .withIndex("by_ownerUserId_and_projectLocalId", (q: any) =>
      q.eq("ownerUserId", ownerUserId).eq("projectLocalId", projectLocalId),
    )
    .collect()) as StoredProjectEditorLease[];
}

function pickCanonicalLease(leases: StoredProjectEditorLease[]): StoredProjectEditorLease | null {
  if (leases.length === 0) {
    return null;
  }

  return leases.slice(1).reduce((best, candidate) => {
    if (candidate.heartbeatAt !== best.heartbeatAt) {
      return candidate.heartbeatAt > best.heartbeatAt ? candidate : best;
    }
    if (candidate.acquiredAt !== best.acquiredAt) {
      return candidate.acquiredAt > best.acquiredAt ? candidate : best;
    }
    return String(candidate._id).localeCompare(String(best._id)) > 0 ? candidate : best;
  }, leases[0]);
}

async function cleanupDuplicateLeases(
  ctx: any,
  ownerUserId: string,
  projectLocalId: string,
  keepId: Id<"projectEditorLeases">,
) {
  const leases = await listProjectLeases(ctx, ownerUserId, projectLocalId);
  for (const lease of leases) {
    if (lease._id === keepId) {
      continue;
    }
    await ctx.db.delete(lease._id);
  }
}

function isLeaseActive(lease: StoredProjectEditorLease | null, now: number): boolean {
  return !!lease && now - lease.heartbeatAt < LEASE_STALE_AFTER_MS;
}

function toLeaseStatus(
  lease: StoredProjectEditorLease | null,
  editorSessionId: string,
  now: number,
) {
  if (!lease || !isLeaseActive(lease, now)) {
    return {
      state: "available" as const,
      activeEditorSessionId: null,
      heartbeatAt: null,
      staleAt: null,
    };
  }

  const activeLease = lease;

  return {
    state: activeLease.editorSessionId === editorSessionId ? "held_by_current" as const : "held_by_other" as const,
    activeEditorSessionId: activeLease.editorSessionId,
    heartbeatAt: activeLease.heartbeatAt,
    staleAt: activeLease.heartbeatAt + LEASE_STALE_AFTER_MS,
  };
}

export const getStatus = query({
  args: {
    projectLocalId: v.string(),
    editorSessionId: v.string(),
  },
  returns: leaseStatusValidator,
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const leases = await listProjectLeases(ctx, ownerUserId, args.projectLocalId);
    const lease = pickCanonicalLease(leases);
    return toLeaseStatus(lease, args.editorSessionId, Date.now());
  },
});

export const acquire = mutation({
  args: {
    projectLocalId: v.string(),
    editorSessionId: v.string(),
    force: v.optional(v.boolean()),
  },
  returns: acquireLeaseResultValidator,
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const now = Date.now();
    const leases = await listProjectLeases(ctx, ownerUserId, args.projectLocalId);
    const current = pickCanonicalLease(leases);

    if (current) {
      await cleanupDuplicateLeases(ctx, ownerUserId, args.projectLocalId, current._id);
    }

    const active = isLeaseActive(current, now) ? current : null;
    if (active && active.editorSessionId !== args.editorSessionId && !args.force) {
      return {
        status: "blocked" as const,
        activeEditorSessionId: active.editorSessionId,
        heartbeatAt: active.heartbeatAt,
        staleAt: active.heartbeatAt + LEASE_STALE_AFTER_MS,
      };
    }

    if (current) {
      const status =
        active && active.editorSessionId !== args.editorSessionId ? "taken_over" as const : "acquired" as const;
      await ctx.db.patch(current._id, {
        editorSessionId: args.editorSessionId,
        acquiredAt: status === "taken_over" ? now : current.acquiredAt,
        heartbeatAt: now,
      });
      return {
        status,
        activeEditorSessionId: args.editorSessionId,
        heartbeatAt: now,
        staleAt: now + LEASE_STALE_AFTER_MS,
      };
    }

    await ctx.db.insert("projectEditorLeases", {
      ownerUserId,
      projectLocalId: args.projectLocalId,
      editorSessionId: args.editorSessionId,
      acquiredAt: now,
      heartbeatAt: now,
    });

    return {
      status: "acquired" as const,
      activeEditorSessionId: args.editorSessionId,
      heartbeatAt: now,
      staleAt: now + LEASE_STALE_AFTER_MS,
    };
  },
});

export const heartbeat = mutation({
  args: {
    projectLocalId: v.string(),
    editorSessionId: v.string(),
  },
  returns: v.object({
    ok: v.boolean(),
    staleAt: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const leases = await listProjectLeases(ctx, ownerUserId, args.projectLocalId);
    const current = pickCanonicalLease(leases);
    if (!current || current.editorSessionId !== args.editorSessionId) {
      return { ok: false, staleAt: null };
    }

    const now = Date.now();
    await cleanupDuplicateLeases(ctx, ownerUserId, args.projectLocalId, current._id);
    await ctx.db.patch(current._id, {
      heartbeatAt: now,
    });
    return { ok: true, staleAt: now + LEASE_STALE_AFTER_MS };
  },
});

export const release = mutation({
  args: {
    projectLocalId: v.string(),
    editorSessionId: v.string(),
  },
  returns: v.object({ released: v.boolean() }),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const leases = await listProjectLeases(ctx, ownerUserId, args.projectLocalId);
    let released = false;
    for (const lease of leases) {
      if (lease.editorSessionId !== args.editorSessionId) {
        continue;
      }
      await ctx.db.delete(lease._id);
      released = true;
    }
    return { released };
  },
});
