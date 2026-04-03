import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { boundsValidator, costumeDocumentValidator } from "./costumeValidators";
import {
  colliderValidator,
  costumeValidator,
  migrateLegacyTemplateVariables,
  physicsValidator,
  soundValidator,
  variableValidator,
} from "./libraryValidators";
import {
  buildTemplateRenamePatch,
  buildUserTemplateMetadata,
  canMutateTemplateRow,
  listVisibleTemplateRows,
  normalizeTemplateSchemaVersion,
  normalizeTemplateScope,
  requireAuthenticatedUserId,
  requireTemplateAssetRefs,
  resolveTemplateAssetUrl,
  templateScopeValidator,
} from "./templateLibrary";

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
  scope: templateScopeValidator,
  schemaVersion: v.number(),
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
  updatedAt: v.number(),
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

function normalizeBounds(
  bounds: unknown,
): { x: number; y: number; width: number; height: number } | undefined {
  if (!bounds || typeof bounds !== "object") {
    return undefined;
  }

  const maybe = bounds as { x?: unknown; y?: unknown; width?: unknown; height?: unknown };
  if (
    typeof maybe.x !== "number" ||
    typeof maybe.y !== "number" ||
    typeof maybe.width !== "number" ||
    typeof maybe.height !== "number"
  ) {
    return undefined;
  }

  return {
    x: maybe.x,
    y: maybe.y,
    width: maybe.width,
    height: maybe.height,
  };
}

export const list = query({
  args: {},
  returns: v.array(objectLibraryWithUrlsValidator),
  handler: async (ctx) => {
    const items = await listVisibleTemplateRows<{
      _id: Id<"objectLibrary">;
      _creationTime: number;
      ownerUserId?: string;
      scope?: "system" | "user";
      schemaVersion?: number;
      name: string;
      thumbnail: string;
      assetRefs?: Array<{ assetId: string; kind: AssetKind }>;
      costumes: Array<{
        id: string;
        name: string;
        storageId?: Id<"_storage">;
        bounds?: unknown;
        document: typeof costumeDocumentValidator.type;
      }>;
      sounds: Array<{
        id: string;
        name: string;
        assetId?: string;
        storageId?: Id<"_storage">;
        duration?: number;
        trimStart?: number;
        trimEnd?: number;
      }>;
      blocklyXml: string;
      currentCostumeIndex?: number;
      physics?: typeof physicsValidator.type;
      collider?: typeof colliderValidator.type;
      localVariables?: Array<typeof variableValidator.type>;
      createdAt: number;
      updatedAt?: number;
    }>(ctx, "objectLibrary");

    return await Promise.all(
      items.map(async (item) => {
        const scope = normalizeTemplateScope(item.scope, item.ownerUserId);
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
            url: await resolveTemplateAssetUrl(ctx, {
              assetId: ref.assetId,
              ownerUserId: item.ownerUserId,
              scope,
            }),
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
            bounds: normalizeBounds(costume.bounds),
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
          scope,
          schemaVersion: normalizeTemplateSchemaVersion(item.schemaVersion),
          name: item.name,
          thumbnail: item.thumbnail,
          blocklyXml: item.blocklyXml,
          currentCostumeIndex: item.currentCostumeIndex,
          physics: item.physics,
          collider: item.collider,
          localVariables: item.localVariables
            ? migrateLegacyTemplateVariables(item.localVariables)
            : undefined,
          createdAt: item.createdAt,
          updatedAt: item.updatedAt ?? item.createdAt,
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
    costumes: v.array(costumeValidator),
    sounds: v.array(soundValidator),
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
    await requireTemplateAssetRefs(ctx, {
      ownerUserId,
      scope: "user",
      refs: assetRefs,
    });

    return await ctx.db.insert("objectLibrary", {
      ...buildUserTemplateMetadata(ownerUserId),
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
    });
  },
});

export const remove = mutation({
  args: { id: v.id("objectLibrary") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const item = await ctx.db.get(args.id);
    if (item && canMutateTemplateRow(item, ownerUserId)) {
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
    if (!canMutateTemplateRow(item, ownerUserId)) {
      return null;
    }
    await ctx.db.patch(args.id, buildTemplateRenamePatch(args.name));
    return null;
  },
});
