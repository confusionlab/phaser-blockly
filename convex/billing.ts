import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

const PLAN_MONTHLY_CREDITS: Record<string, number> = {
  free: 100,
  creator: 3000,
  pro: 12000,
};

function resolveMonthlyCredits(planSlug: string): number {
  const normalized = planSlug.trim().toLowerCase();
  return PLAN_MONTHLY_CREDITS[normalized] ?? PLAN_MONTHLY_CREDITS.free;
}

function currentMonthPeriodKey(now = Date.now()): string {
  const d = new Date(now);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

async function ensureWalletDocument(ctx: any, userId: string) {
  const existing = await ctx.db
    .query("wallets")
    .withIndex("by_userId", (q: any) => q.eq("userId", userId))
    .unique();
  if (existing) {
    return existing;
  }

  const now = Date.now();
  const walletId = await ctx.db.insert("wallets", {
    userId,
    planSlug: "free",
    subscriptionStatus: "inactive",
    balanceCredits: 0,
    activePeriodKey: currentMonthPeriodKey(now),
    periodEndsAt: undefined,
    createdAt: now,
    updatedAt: now,
  });
  return await ctx.db.get(walletId);
}

async function hasLedgerReference(ctx: any, userId: string, referenceId: string): Promise<boolean> {
  const existing = await ctx.db
    .query("creditLedger")
    .withIndex("by_userId_and_referenceId", (q: any) => q.eq("userId", userId).eq("referenceId", referenceId))
    .unique();
  return !!existing;
}

async function appendLedgerEntry(
  ctx: any,
  args: {
    userId: string;
    delta: number;
    reason: string;
    referenceId: string;
    balanceAfter: number;
    metadataJson?: string;
  },
) {
  await ctx.db.insert("creditLedger", {
    userId: args.userId,
    delta: args.delta,
    reason: args.reason,
    referenceId: args.referenceId,
    balanceAfter: args.balanceAfter,
    metadataJson: args.metadataJson,
    createdAt: Date.now(),
  });
}

async function applyPeriodGrantInternal(
  ctx: any,
  args: {
    userId: string;
    wallet: any;
    planSlug: string;
    periodKey: string;
    reasonPrefix: string;
  },
): Promise<{ balanceCredits: number; granted: boolean }> {
  const grantReferenceId = `${args.reasonPrefix}:${args.planSlug}:${args.periodKey}`;
  const alreadyGranted = await hasLedgerReference(ctx, args.userId, grantReferenceId);
  if (alreadyGranted) {
    return {
      balanceCredits: args.wallet.balanceCredits,
      granted: false,
    };
  }

  const monthlyCredits = resolveMonthlyCredits(args.planSlug);
  const balanceCredits = args.wallet.balanceCredits + monthlyCredits;
  await ctx.db.patch(args.wallet._id, {
    balanceCredits,
    activePeriodKey: args.periodKey,
    updatedAt: Date.now(),
  });
  await appendLedgerEntry(ctx, {
    userId: args.userId,
    delta: monthlyCredits,
    reason: "period_grant",
    referenceId: grantReferenceId,
    balanceAfter: balanceCredits,
    metadataJson: JSON.stringify({
      planSlug: args.planSlug,
      periodKey: args.periodKey,
    }),
  });
  return {
    balanceCredits,
    granted: true,
  };
}

async function requireAuthenticatedUserId(ctx: any): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("unauthenticated");
  }
  return identity.subject;
}

export const getWalletSummary = query({
  args: {},
  returns: v.object({
    planSlug: v.string(),
    subscriptionStatus: v.string(),
    balanceCredits: v.number(),
    activePeriodKey: v.optional(v.string()),
    periodEndsAt: v.optional(v.number()),
    canRunManagedAssistant: v.boolean(),
  }),
  handler: async (ctx) => {
    const userId = await requireAuthenticatedUserId(ctx);
    const wallet = await ensureWalletDocument(ctx, userId);
    if (!wallet) {
      throw new Error("wallet_not_found");
    }

    // Free tier grants monthly credits by calendar month.
    if (wallet.planSlug === "free") {
      const periodKey = currentMonthPeriodKey();
      await applyPeriodGrantInternal(ctx, {
        userId,
        wallet,
        planSlug: "free",
        periodKey,
        reasonPrefix: "grant",
      });
    }

    const refreshed = await ensureWalletDocument(ctx, userId);
    if (!refreshed) {
      throw new Error("wallet_not_found_after_refresh");
    }

    return {
      planSlug: refreshed.planSlug,
      subscriptionStatus: refreshed.subscriptionStatus,
      balanceCredits: refreshed.balanceCredits,
      activePeriodKey: refreshed.activePeriodKey,
      periodEndsAt: refreshed.periodEndsAt,
      canRunManagedAssistant: refreshed.balanceCredits > 0,
    };
  },
});

export const ensureWallet = internalMutation({
  args: {
    userId: v.string(),
  },
  returns: v.object({
    userId: v.string(),
    planSlug: v.string(),
    subscriptionStatus: v.string(),
    balanceCredits: v.number(),
    activePeriodKey: v.optional(v.string()),
    periodEndsAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    const wallet = await ensureWalletDocument(ctx, args.userId);
    if (!wallet) {
      throw new Error("wallet_not_found");
    }
    return {
      userId: wallet.userId,
      planSlug: wallet.planSlug,
      subscriptionStatus: wallet.subscriptionStatus,
      balanceCredits: wallet.balanceCredits,
      activePeriodKey: wallet.activePeriodKey,
      periodEndsAt: wallet.periodEndsAt,
    };
  },
});

export const applyPeriodGrant = internalMutation({
  args: {
    userId: v.string(),
    planSlug: v.string(),
    periodKey: v.string(),
    reasonPrefix: v.optional(v.string()),
  },
  returns: v.object({
    balanceCredits: v.number(),
    granted: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const wallet = await ensureWalletDocument(ctx, args.userId);
    if (!wallet) {
      throw new Error("wallet_not_found");
    }
    return await applyPeriodGrantInternal(ctx, {
      userId: args.userId,
      wallet,
      planSlug: args.planSlug,
      periodKey: args.periodKey,
      reasonPrefix: args.reasonPrefix ?? "grant",
    });
  },
});

export const processSubscriptionWebhook = internalMutation({
  args: {
    eventId: v.string(),
    eventType: v.string(),
    payloadHash: v.string(),
    userId: v.string(),
    planSlug: v.string(),
    subscriptionStatus: v.string(),
    periodKey: v.optional(v.string()),
    periodEndsAt: v.optional(v.number()),
  },
  returns: v.object({
    deduped: v.boolean(),
    balanceCredits: v.number(),
  }),
  handler: async (ctx, args) => {
    const existingEvent = await ctx.db
      .query("billingEvents")
      .withIndex("by_eventId", (q: any) => q.eq("eventId", args.eventId))
      .unique();
    if (existingEvent) {
      const existingWallet = await ensureWalletDocument(ctx, args.userId);
      if (!existingWallet) {
        throw new Error("wallet_missing_for_dedupe");
      }
      return {
        deduped: true,
        balanceCredits: existingWallet.balanceCredits,
      };
    }

    await ctx.db.insert("billingEvents", {
      eventId: args.eventId,
      eventType: args.eventType,
      payloadHash: args.payloadHash,
      processedAt: Date.now(),
    });

    const wallet = await ensureWalletDocument(ctx, args.userId);
    if (!wallet) {
      throw new Error("wallet_not_found");
    }
    const now = Date.now();
    const normalizedStatus = args.subscriptionStatus.trim().toLowerCase();
    const shouldGrantPaidPlanCredits =
      normalizedStatus === "active"
      || normalizedStatus === "past_due"
      || normalizedStatus === "trialing";
    const effectivePlanSlug = shouldGrantPaidPlanCredits ? args.planSlug : "free";

    await ctx.db.patch(wallet._id, {
      planSlug: effectivePlanSlug,
      subscriptionStatus: args.subscriptionStatus,
      periodEndsAt: args.periodEndsAt,
      activePeriodKey: args.periodKey ?? wallet.activePeriodKey,
      updatedAt: now,
    });

    const refreshed = (await ctx.db.get(wallet._id)) as any;
    if (!refreshed) {
      throw new Error("wallet_not_found_after_patch");
    }

    if (!shouldGrantPaidPlanCredits) {
      return {
        deduped: false,
        balanceCredits: refreshed.balanceCredits,
      };
    }

    const grantPeriodKey = args.periodKey ?? currentMonthPeriodKey(now);
    const grantResult = await applyPeriodGrantInternal(ctx, {
      userId: args.userId,
      wallet: refreshed,
      planSlug: effectivePlanSlug,
      periodKey: grantPeriodKey,
      reasonPrefix: "grant_sub",
    });

    return {
      deduped: false,
      balanceCredits: grantResult.balanceCredits,
    };
  },
});

export const reserveCredits = internalMutation({
  args: {
    userId: v.string(),
    amount: v.number(),
    referenceId: v.string(),
  },
  returns: v.object({
    reserved: v.boolean(),
    balanceCredits: v.number(),
    planSlug: v.string(),
    periodEndsAt: v.optional(v.number()),
  }),
  handler: async (ctx, args) => {
    if (args.amount <= 0) {
      throw new Error("invalid_credit_amount");
    }
    const reservationReferenceId = `reserve:${args.referenceId}`;
    const existingReservation = await hasLedgerReference(ctx, args.userId, reservationReferenceId);

    const wallet = await ensureWalletDocument(ctx, args.userId);
    if (!wallet) {
      throw new Error("wallet_not_found");
    }
    let workingWallet = wallet;

    if (workingWallet.planSlug === "free") {
      const periodKey = currentMonthPeriodKey();
      await applyPeriodGrantInternal(ctx, {
        userId: args.userId,
        wallet: workingWallet,
        planSlug: "free",
        periodKey,
        reasonPrefix: "grant",
      });
      const refreshed = await ensureWalletDocument(ctx, args.userId);
      if (refreshed) {
        workingWallet = refreshed;
      }
    }

    if (existingReservation) {
      return {
        reserved: true,
        balanceCredits: workingWallet.balanceCredits,
        planSlug: workingWallet.planSlug,
        periodEndsAt: workingWallet.periodEndsAt,
      };
    }

    if (workingWallet.balanceCredits < args.amount) {
      return {
        reserved: false,
        balanceCredits: workingWallet.balanceCredits,
        planSlug: workingWallet.planSlug,
        periodEndsAt: workingWallet.periodEndsAt,
      };
    }

    const nextBalance = workingWallet.balanceCredits - args.amount;
    await ctx.db.patch(workingWallet._id, {
      balanceCredits: nextBalance,
      updatedAt: Date.now(),
    });
    await appendLedgerEntry(ctx, {
      userId: args.userId,
      delta: -args.amount,
      reason: "reserve",
      referenceId: reservationReferenceId,
      balanceAfter: nextBalance,
    });

    return {
      reserved: true,
      balanceCredits: nextBalance,
      planSlug: workingWallet.planSlug,
      periodEndsAt: workingWallet.periodEndsAt,
    };
  },
});

export const commitReservedCredits = internalMutation({
  args: {
    userId: v.string(),
    referenceId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const commitReferenceId = `commit:${args.referenceId}`;
    const alreadyCommitted = await hasLedgerReference(ctx, args.userId, commitReferenceId);
    if (alreadyCommitted) {
      return null;
    }

    const wallet = await ensureWalletDocument(ctx, args.userId);
    if (!wallet) {
      throw new Error("wallet_not_found");
    }

    await appendLedgerEntry(ctx, {
      userId: args.userId,
      delta: 0,
      reason: "commit",
      referenceId: commitReferenceId,
      balanceAfter: wallet.balanceCredits,
    });
    return null;
  },
});

export const refundReservedCredits = internalMutation({
  args: {
    userId: v.string(),
    amount: v.number(),
    referenceId: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.amount <= 0) {
      return null;
    }
    const refundReferenceId = `refund:${args.referenceId}`;
    const alreadyRefunded = await hasLedgerReference(ctx, args.userId, refundReferenceId);
    if (alreadyRefunded) {
      return null;
    }

    const wallet = await ensureWalletDocument(ctx, args.userId);
    if (!wallet) {
      throw new Error("wallet_not_found");
    }

    const nextBalance = wallet.balanceCredits + args.amount;
    await ctx.db.patch(wallet._id, {
      balanceCredits: nextBalance,
      updatedAt: Date.now(),
    });
    await appendLedgerEntry(ctx, {
      userId: args.userId,
      delta: args.amount,
      reason: "refund",
      referenceId: refundReferenceId,
      balanceAfter: nextBalance,
    });
    return null;
  },
});
