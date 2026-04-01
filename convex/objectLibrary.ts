import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { boundsValidator, costumeDocumentValidator } from "./costumeValidators";

async function requireAuthenticatedUserId(ctx: any): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) {
    throw new Error("unauthenticated");
  }
  return identity.subject;
}

const physicsValidator = v.object({
  enabled: v.boolean(),
  bodyType: v.union(v.literal("dynamic"), v.literal("static")),
  gravityY: v.number(),
  velocityX: v.number(),
  velocityY: v.number(),
  bounce: v.number(),
  friction: v.number(),
  allowRotation: v.boolean(),
});

const colliderValidator = v.object({
  type: v.union(
    v.literal("none"),
    v.literal("box"),
    v.literal("circle"),
    v.literal("capsule"),
  ),
  offsetX: v.number(),
  offsetY: v.number(),
  width: v.number(),
  height: v.number(),
  radius: v.number(),
});

const variableValidator = v.object({
  id: v.string(),
  name: v.string(),
  type: v.union(
    v.literal("string"),
    v.literal("integer"),
    v.literal("float"),
    v.literal("boolean"),
  ),
  defaultValue: v.union(v.number(), v.string(), v.boolean()),
  scope: v.union(v.literal("global"), v.literal("local")),
  objectId: v.optional(v.string()),
});

const objectLibraryAssetRefValidator = v.object({
  assetId: v.string(),
  kind: v.union(v.literal("image"), v.literal("audio")),
});

const objectLibraryCostumeValidator = v.object({
  id: v.string(),
  name: v.string(),
  bounds: v.optional(boundsValidator),
  document: costumeDocumentValidator,
});

const objectLibrarySoundValidator = v.object({
  id: v.string(),
  name: v.string(),
  assetId: v.string(),
  duration: v.optional(v.number()),
  trimStart: v.optional(v.number()),
  trimEnd: v.optional(v.number()),
});

const storedObjectLibraryCostumeValidator = v.object({
  id: v.string(),
  name: v.string(),
  storageId: v.optional(v.id("_storage")),
  bounds: v.optional(boundsValidator),
  document: costumeDocumentValidator,
});

const storedObjectLibrarySoundValidator = v.object({
  id: v.string(),
  name: v.string(),
  assetId: v.optional(v.string()),
  storageId: v.optional(v.id("_storage")),
  duration: v.optional(v.number()),
  trimStart: v.optional(v.number()),
  trimEnd: v.optional(v.number()),
});

const objectLibraryAssetWithUrlValidator = v.object({
  assetId: v.string(),
  kind: v.union(v.literal("image"), v.literal("audio")),
  url: v.union(v.string(), v.null()),
});

const objectLibraryCostumeWithPreviewValidator = v.object({
  id: v.string(),
  name: v.string(),
  bounds: v.optional(boundsValidator),
  document: costumeDocumentValidator,
  previewUrl: v.union(v.string(), v.null()),
});

const objectLibrarySoundWithUrlValidator = v.object({
  id: v.string(),
  name: v.string(),
  assetId: v.optional(v.string()),
  duration: v.optional(v.number()),
  trimStart: v.optional(v.number()),
  trimEnd: v.optional(v.number()),
  url: v.union(v.string(), v.null()),
});

const objectLibraryWithUrlsValidator = v.object({
  _id: v.id("objectLibrary"),
  _creationTime: v.number(),
  name: v.string(),
  thumbnail: v.string(),
  assetRefs: v.array(objectLibraryAssetWithUrlValidator),
  costumes: v.array(objectLibraryCostumeWithPreviewValidator),
  sounds: v.array(objectLibrarySoundWithUrlValidator),
  blocklyXml: v.string(),
  currentCostumeIndex: v.optional(v.number()),
  physics: v.optional(physicsValidator),
  collider: v.optional(colliderValidator),
  localVariables: v.optional(v.array(variableValidator)),
  createdAt: v.number(),
});

type AssetKind = "image" | "audio";

function collectImageAssetRefsFromCostumeDocument(
  document: {
    layers?: Array<{
      kind?: unknown;
      bitmap?: { assetId?: unknown };
    }>;
  },
  refsById: Map<string, AssetKind>,
): void {
  for (const layer of document.layers ?? []) {
    if (layer.kind !== "bitmap") {
      continue;
    }
    const assetId = layer.bitmap?.assetId;
    if (typeof assetId !== "string" || assetId.trim().length === 0) {
      continue;
    }
    refsById.set(assetId, "image");
  }
}

function collectObjectLibraryAssetRefs(
  costumes: Array<{
    document: {
      layers?: Array<{
        kind?: unknown;
        bitmap?: { assetId?: unknown };
      }>;
    };
  }>,
  sounds: Array<{ assetId: string }>,
): Array<{ assetId: string; kind: AssetKind }> {
  const refsById = new Map<string, AssetKind>();

  for (const costume of costumes) {
    collectImageAssetRefsFromCostumeDocument(costume.document, refsById);
  }

  for (const sound of sounds) {
    if (typeof sound.assetId === "string" && sound.assetId.trim().length > 0) {
      refsById.set(sound.assetId, "audio");
    }
  }

  return Array.from(refsById.entries()).map(([assetId, kind]) => ({ assetId, kind }));
}

async function resolveOwnedProjectAssetUrl(
  ctx: any,
  ownerUserId: string,
  assetId: string,
): Promise<string | null> {
  const row = await ctx.db
    .query("projectAssets")
    .withIndex("by_ownerUserId_and_assetId", (q: any) => q.eq("ownerUserId", ownerUserId).eq("assetId", assetId))
    .first();

  if (!row) {
    return null;
  }

  return await ctx.storage.getUrl(row.storageId as Id<"_storage">);
}

async function requireReferencedAssets(
  ctx: any,
  ownerUserId: string,
  refs: Array<{ assetId: string; kind: AssetKind }>,
): Promise<void> {
  const uniqueRefs = Array.from(
    refs.reduce((map, ref) => {
      map.set(`${ref.kind}:${ref.assetId}`, ref);
      return map;
    }, new Map<string, { assetId: string; kind: AssetKind }>() ).values(),
  );

  const missingRefs: string[] = [];
  for (const ref of uniqueRefs) {
    const row = await ctx.db
      .query("projectAssets")
      .withIndex("by_ownerUserId_and_assetId", (q: any) => q.eq("ownerUserId", ownerUserId).eq("assetId", ref.assetId))
      .first();

    if (!row || row.kind !== ref.kind) {
      missingRefs.push(`${ref.kind}:${ref.assetId}`);
    }
  }

  if (missingRefs.length > 0) {
    throw new Error(`Missing object library asset refs: ${missingRefs.join(", ")}`);
  }
}

export const list = query({
  args: {},
  returns: v.array(objectLibraryWithUrlsValidator),
  handler: async (ctx) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const items = await ctx.db
      .query("objectLibrary")
      .withIndex("by_ownerUserId_and_createdAt", (q) => q.eq("ownerUserId", ownerUserId))
      .order("desc")
      .collect();

    return await Promise.all(
      items.map(async (item) => {
        const derivedAssetRefs = (item.assetRefs ?? collectObjectLibraryAssetRefs(
          item.costumes as Array<{ document: { layers?: Array<{ kind?: unknown; bitmap?: { assetId?: unknown } }> } }>,
          (item.sounds || [])
            .filter((sound): sound is typeof sound & { assetId: string } => typeof sound.assetId === "string" && sound.assetId.trim().length > 0)
            .map((sound) => ({ assetId: sound.assetId })),
        ));

        const resolvedAssetRefs = await Promise.all(
          derivedAssetRefs.map(async (ref) => ({
            assetId: ref.assetId,
            kind: ref.kind,
            url: await resolveOwnedProjectAssetUrl(ctx, ownerUserId, ref.assetId),
          })),
        );

        const resolvedAssetUrlById = new Map(resolvedAssetRefs.map((asset) => [asset.assetId, asset.url]));

        const costumes = await Promise.all(
          (item.costumes as Array<{
            id: string;
            name: string;
            storageId?: Id<"_storage">;
            bounds?: unknown;
            document: typeof costumeDocumentValidator.type;
          }>).map(async (costume) => ({
            id: costume.id,
            name: costume.name,
            bounds: costume.bounds,
            document: costume.document,
            previewUrl: costume.storageId ? await ctx.storage.getUrl(costume.storageId) : null,
          })),
        );

        const sounds = await Promise.all(
          (item.sounds as Array<{
            id: string;
            name: string;
            assetId?: string;
            storageId?: Id<"_storage">;
            duration?: number;
            trimStart?: number;
            trimEnd?: number;
          }>).map(async (sound) => ({
            id: sound.id,
            name: sound.name,
            assetId: sound.assetId,
            duration: sound.duration,
            trimStart: sound.trimStart,
            trimEnd: sound.trimEnd,
            url: sound.assetId
              ? (resolvedAssetUrlById.get(sound.assetId) ?? null)
              : (sound.storageId ? await ctx.storage.getUrl(sound.storageId) : null),
          })),
        );

        return {
          _id: item._id,
          _creationTime: item._creationTime,
          name: item.name,
          thumbnail: item.thumbnail,
          blocklyXml: item.blocklyXml,
          currentCostumeIndex: item.currentCostumeIndex,
          physics: item.physics,
          collider: item.collider,
          localVariables: item.localVariables,
          createdAt: item.createdAt,
          assetRefs: resolvedAssetRefs,
          costumes,
          sounds,
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
    thumbnail: v.string(),
    costumes: v.array(objectLibraryCostumeValidator),
    sounds: v.array(objectLibrarySoundValidator),
    blocklyXml: v.string(),
    currentCostumeIndex: v.number(),
    physics: v.optional(physicsValidator),
    collider: v.optional(colliderValidator),
    localVariables: v.array(variableValidator),
  },
  returns: v.id("objectLibrary"),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const assetRefs = collectObjectLibraryAssetRefs(args.costumes, args.sounds);
    await requireReferencedAssets(ctx, ownerUserId, assetRefs);

    return await ctx.db.insert("objectLibrary", {
      ownerUserId,
      name: args.name,
      thumbnail: args.thumbnail,
      assetRefs,
      costumes: args.costumes,
      sounds: args.sounds,
      blocklyXml: args.blocklyXml,
      currentCostumeIndex: args.currentCostumeIndex,
      physics: args.physics,
      collider: args.collider,
      localVariables: args.localVariables,
      createdAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("objectLibrary") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const item = await ctx.db.get(args.id);
    if (item && item.ownerUserId === ownerUserId) {
      for (const costume of item.costumes as Array<{ storageId?: Id<"_storage"> }>) {
        if (costume.storageId) {
          await ctx.storage.delete(costume.storageId);
        }
      }
      for (const sound of item.sounds as Array<{ storageId?: Id<"_storage"> }>) {
        if (sound.storageId) {
          await ctx.storage.delete(sound.storageId);
        }
      }
      await ctx.db.delete(args.id);
    }
    return null;
  },
});

export const rename = mutation({
  args: { id: v.id("objectLibrary"), name: v.string() },
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
