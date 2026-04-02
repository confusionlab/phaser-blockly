import { v } from "convex/values";

export const TEMPLATE_SCHEMA_VERSION = 11;

export const templateScopeValidator = v.union(
  v.literal("system"),
  v.literal("user"),
);

export type TemplateScope = "system" | "user";

type TemplateRowBase = {
  ownerUserId?: string;
  scope?: TemplateScope;
  createdAt: number;
  _creationTime?: number;
};

export async function getOptionalAuthenticatedUserId(ctx: any): Promise<string | null> {
  const identity = await ctx.auth.getUserIdentity();
  return identity?.subject ?? null;
}

export async function requireAuthenticatedUserId(ctx: any): Promise<string> {
  const ownerUserId = await getOptionalAuthenticatedUserId(ctx);
  if (!ownerUserId) {
    throw new Error("unauthenticated");
  }
  return ownerUserId;
}

export function normalizeTemplateScope(scope: unknown, ownerUserId?: unknown): TemplateScope {
  if (scope === "system") {
    return "system";
  }
  if (scope === "user") {
    return "user";
  }
  return typeof ownerUserId === "string" && ownerUserId.length > 0 ? "user" : "system";
}

export function normalizeTemplateSchemaVersion(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed) && parsed >= 1) {
      return Math.floor(parsed);
    }
  }
  return TEMPLATE_SCHEMA_VERSION;
}

export function buildUserTemplateMetadata(ownerUserId: string): {
  ownerUserId: string;
  scope: TemplateScope;
  schemaVersion: number;
  createdAt: number;
  updatedAt: number;
} {
  const now = Date.now();
  return {
    ownerUserId,
    scope: "user",
    schemaVersion: TEMPLATE_SCHEMA_VERSION,
    createdAt: now,
    updatedAt: now,
  };
}

export function buildTemplateRenamePatch(name: string): {
  name: string;
  updatedAt: number;
} {
  return {
    name,
    updatedAt: Date.now(),
  };
}

export function canMutateTemplateRow(
  row: Pick<TemplateRowBase, "ownerUserId" | "scope"> | null | undefined,
  ownerUserId: string,
): boolean {
  if (!row) {
    return false;
  }
  return normalizeTemplateScope(row.scope, row.ownerUserId) === "user" && row.ownerUserId === ownerUserId;
}

export async function listVisibleTemplateRows<T extends TemplateRowBase>(
  ctx: any,
  tableName: "costumeLibrary" | "soundLibrary" | "objectLibrary" | "sceneLibrary",
): Promise<T[]> {
  const ownerUserId = await getOptionalAuthenticatedUserId(ctx);
  const [systemRows, userRows] = await Promise.all([
    ctx.db
      .query(tableName)
      .withIndex("by_scope_and_createdAt", (q: any) => q.eq("scope", "system"))
      .order("desc")
      .collect(),
    ownerUserId
      ? ctx.db
          .query(tableName)
          .withIndex("by_ownerUserId_and_createdAt", (q: any) => q.eq("ownerUserId", ownerUserId))
          .order("desc")
          .collect()
      : Promise.resolve([]),
  ]);

  return [...systemRows, ...userRows]
    .sort((left: T, right: T) => {
      const createdDelta = right.createdAt - left.createdAt;
      if (createdDelta !== 0) {
        return createdDelta;
      }
      return (right._creationTime ?? 0) - (left._creationTime ?? 0);
    }) as T[];
}

export async function resolveTemplateAssetUrl(
  ctx: any,
  options: {
    assetId: string;
    ownerUserId?: string;
    scope?: TemplateScope;
  },
): Promise<string | null> {
  const row = await findTemplateAssetRow(ctx, options);
  if (!row) {
    return null;
  }
  return await ctx.storage.getUrl(row.storageId);
}

export async function findTemplateAssetRow(
  ctx: any,
  options: {
    assetId: string;
    ownerUserId?: string;
    scope?: TemplateScope;
  },
): Promise<{
  assetId: string;
  kind: string;
  mimeType: string;
  size: number;
  storageId: any;
} | null> {
  const scope = normalizeTemplateScope(options.scope, options.ownerUserId);
  return scope === "system"
    ? await ctx.db
        .query("projectAssets")
        .withIndex("by_scope_and_assetId", (q: any) => q.eq("scope", "system").eq("assetId", options.assetId))
        .first()
    : await ctx.db
        .query("projectAssets")
        .withIndex("by_ownerUserId_and_assetId", (q: any) =>
          q.eq("ownerUserId", options.ownerUserId).eq("assetId", options.assetId),
        )
        .first();
}

export async function requireTemplateAssetRefs(
  ctx: any,
  options: {
    ownerUserId: string;
    scope?: TemplateScope;
    refs: Array<{ assetId: string; kind: string }>;
  },
): Promise<void> {
  const scope = normalizeTemplateScope(options.scope, options.ownerUserId);
  const uniqueRefs = Array.from(
    options.refs.reduce((map, ref) => {
      map.set(`${ref.kind}:${ref.assetId}`, ref);
      return map;
    }, new Map<string, { assetId: string; kind: string }>()).values(),
  );

  const missingRefs: string[] = [];
  for (const ref of uniqueRefs) {
    const row = scope === "system"
      ? await ctx.db
          .query("projectAssets")
          .withIndex("by_scope_and_assetId", (q: any) => q.eq("scope", "system").eq("assetId", ref.assetId))
          .first()
      : await ctx.db
          .query("projectAssets")
          .withIndex("by_ownerUserId_and_assetId", (q: any) =>
            q.eq("ownerUserId", options.ownerUserId).eq("assetId", ref.assetId),
          )
          .first();

    if (!row || row.kind !== ref.kind) {
      missingRefs.push(`${ref.kind}:${ref.assetId}`);
    }
  }

  if (missingRefs.length > 0) {
    throw new Error(`Missing template asset refs: ${missingRefs.join(", ")}`);
  }
}
