import { verifyWebhook } from "@clerk/backend/webhooks";
import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

type JsonRecord = Record<string, unknown>;

const SUBSCRIPTION_EVENT_TYPES = new Set([
  "subscriptionItem.active",
  "subscriptionItem.pastDue",
  "subscriptionItem.ended",
]);

function asRecord(value: unknown): JsonRecord | null {
  if (value && typeof value === "object") {
    return value as JsonRecord;
  }
  return null;
}

function readStringValue(record: JsonRecord | null, keys: string[]): string | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return null;
}

function readNumberValue(record: JsonRecord | null, keys: string[]): number | null {
  if (!record) {
    return null;
  }
  for (const key of keys) {
    const candidate = record[key];
    if (typeof candidate === "number" && Number.isFinite(candidate)) {
      return candidate;
    }
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      const parsed = Number(candidate);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }
  return null;
}

function toUtcMonthPeriodKey(timestampMs: number): string {
  const d = new Date(timestampMs);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function extractWebhookUserId(data: JsonRecord | null): string | null {
  if (!data) {
    return null;
  }
  const payer = asRecord(data.payer);
  return (
    readStringValue(payer, ["userId", "user_id", "id"])
    || readStringValue(data, ["userId", "user_id", "clerk_user_id"])
  );
}

function extractPlanSlug(data: JsonRecord | null): string {
  const plan = asRecord(data?.plan);
  return (
    readStringValue(plan, ["slug", "name"])
    || readStringValue(data, ["planSlug", "plan_slug", "slug"])
    || "free"
  ).toLowerCase();
}

function extractSubscriptionStatus(eventType: string, data: JsonRecord | null): string {
  const explicitStatus = readStringValue(data, ["status", "subscriptionStatus", "subscription_status"]);
  if (explicitStatus) {
    return explicitStatus;
  }
  if (eventType === "subscriptionItem.active") {
    return "active";
  }
  if (eventType === "subscriptionItem.pastDue") {
    return "past_due";
  }
  if (eventType === "subscriptionItem.ended") {
    return "ended";
  }
  return "inactive";
}

function extractPeriodEndsAt(data: JsonRecord | null): number | undefined {
  const epochSeconds = readNumberValue(data, ["periodEnd", "period_end", "currentPeriodEnd", "current_period_end"]);
  if (epochSeconds === null) {
    return undefined;
  }
  // Clerk webhooks typically send Unix seconds; normalize to ms.
  return epochSeconds > 10_000_000_000 ? Math.floor(epochSeconds) : Math.floor(epochSeconds * 1000);
}

function extractPeriodKey(data: JsonRecord | null, periodEndsAt: number | undefined): string {
  const periodStart = readNumberValue(data, [
    "periodStart",
    "period_start",
    "currentPeriodStart",
    "current_period_start",
  ]);
  if (periodStart !== null) {
    const normalizedStart = periodStart > 10_000_000_000 ? Math.floor(periodStart) : Math.floor(periodStart * 1000);
    return toUtcMonthPeriodKey(normalizedStart);
  }
  if (typeof periodEndsAt === "number" && Number.isFinite(periodEndsAt)) {
    return toUtcMonthPeriodKey(periodEndsAt);
  }
  return toUtcMonthPeriodKey(Date.now());
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

http.route({
  path: "/clerk/webhooks",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const event = await verifyWebhook(req);
      const eventType = event.type;

      if (!SUBSCRIPTION_EVENT_TYPES.has(eventType)) {
        return Response.json({ ok: true, ignored: true, reason: "unsupported_event_type" }, { status: 200 });
      }

      const data = asRecord(event.data);
      const userId = extractWebhookUserId(data);
      if (!userId) {
        return Response.json({ ok: true, ignored: true, reason: "missing_user_id" }, { status: 200 });
      }

      const planSlug = extractPlanSlug(data);
      const subscriptionStatus = extractSubscriptionStatus(eventType, data);
      const periodEndsAt = extractPeriodEndsAt(data);
      const periodKey = extractPeriodKey(data, periodEndsAt);
      const payloadHash = await sha256Hex(JSON.stringify(event.data));
      const eventId =
        req.headers.get("svix-id")
        || readStringValue(data, ["id", "subscriptionItemId", "subscription_item_id"])
        || `${eventType}:${payloadHash.slice(0, 24)}`;

      const result = await ctx.runMutation(internal.billing.processSubscriptionWebhook, {
        eventId,
        eventType,
        payloadHash,
        userId,
        planSlug,
        subscriptionStatus,
        periodKey,
        periodEndsAt,
      });

      return Response.json(
        {
          ok: true,
          deduped: result.deduped,
          balanceCredits: result.balanceCredits,
        },
        { status: 200 },
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "webhook_verification_failed";
      return Response.json({ ok: false, error: message }, { status: 401 });
    }
  }),
});

export default http;
