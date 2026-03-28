import { v } from 'convex/values';

import { mutation, query } from './_generated/server';
import { garbageCollectOwnedProjectAssets } from './projects';

const projectExplorerStateValidator = v.object({
  stateJson: v.string(),
  updatedAt: v.number(),
  contentHash: v.string(),
  assetIds: v.optional(v.array(v.string())),
});

const projectExplorerFolderValidator = v.object({
  id: v.string(),
  name: v.string(),
  parentId: v.union(v.string(), v.null()),
  createdAt: v.number(),
  updatedAt: v.number(),
  trashedAt: v.optional(v.number()),
});

const projectExplorerProjectMetaValidator = v.object({
  projectId: v.string(),
  folderId: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
  trashedAt: v.optional(v.number()),
  thumbnailAssetId: v.optional(v.string()),
  thumbnailVisualSignature: v.optional(v.string()),
});

const projectExplorerCatalogValidator = v.object({
  updatedAt: v.number(),
  folders: v.array(projectExplorerFolderValidator),
  projects: v.array(projectExplorerProjectMetaValidator),
  assetIds: v.array(v.string()),
});

function normalizeTimestamp(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  return fallback;
}

function normalizeOptionalTimestamp(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  return undefined;
}

function normalizeString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') {
    return fallback;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

function normalizeOptionalString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function parseProjectExplorerCatalog(stateJson: string, fallbackUpdatedAt: number) {
  const now = normalizeTimestamp(fallbackUpdatedAt, Date.now());
  let parsed: any = null;
  try {
    parsed = JSON.parse(stateJson);
  } catch {
    parsed = null;
  }

  const rawFolders = Array.isArray(parsed?.folders) ? parsed.folders : [];
  const foldersById = new Map<string, {
    id: string;
    name: string;
    parentId: string | null;
    createdAt: number;
    updatedAt: number;
    trashedAt?: number;
  }>();

  for (const rawFolder of rawFolders) {
    if (!rawFolder || typeof rawFolder !== 'object') {
      continue;
    }

    const id = normalizeString(rawFolder.id, '');
    if (!id) {
      continue;
    }

    const createdAt = normalizeTimestamp(rawFolder.createdAt, now);
    const updatedAt = normalizeTimestamp(rawFolder.updatedAt, createdAt);
    foldersById.set(id, {
      id,
      name: normalizeString(rawFolder.name, 'Untitled folder'),
      parentId: id === 'root'
        ? null
        : typeof rawFolder.parentId === 'string'
          ? rawFolder.parentId
          : 'root',
      createdAt,
      updatedAt,
      trashedAt: normalizeOptionalTimestamp(rawFolder.trashedAt),
    });
  }

  const existingRoot = foldersById.get('root');
  foldersById.set('root', {
    id: 'root',
    name: 'Home',
    parentId: null,
    createdAt: existingRoot?.createdAt ?? now,
    updatedAt: existingRoot?.updatedAt ?? now,
  });

  const folders = Array.from(foldersById.values())
    .map((folder) => {
      if (folder.id === 'root') {
        return {
          ...folder,
          parentId: null,
          trashedAt: undefined,
        };
      }

      if (!folder.parentId || folder.parentId === folder.id || !foldersById.has(folder.parentId)) {
        return {
          ...folder,
          parentId: 'root',
        };
      }

      return folder;
    })
    .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));

  const validFolderIds = new Set(folders.map((folder) => folder.id));
  const rawProjects = Array.isArray(parsed?.projects) ? parsed.projects : [];
  const projectsById = new Map<string, {
    projectId: string;
    folderId: string;
    createdAt: number;
    updatedAt: number;
    trashedAt?: number;
    thumbnailAssetId?: string;
    thumbnailVisualSignature?: string;
  }>();

  for (const rawProject of rawProjects) {
    if (!rawProject || typeof rawProject !== 'object') {
      continue;
    }

    const projectId = normalizeString(rawProject.projectId, '');
    if (!projectId) {
      continue;
    }

    const createdAt = normalizeTimestamp(rawProject.createdAt, now);
    const updatedAt = normalizeTimestamp(rawProject.updatedAt, createdAt);
    const folderId = typeof rawProject.folderId === 'string' && validFolderIds.has(rawProject.folderId)
      ? rawProject.folderId
      : 'root';

    projectsById.set(projectId, {
      projectId,
      folderId,
      createdAt,
      updatedAt,
      trashedAt: normalizeOptionalTimestamp(rawProject.trashedAt),
      thumbnailAssetId: normalizeOptionalString(rawProject.thumbnailAssetId),
      thumbnailVisualSignature: normalizeOptionalString(rawProject.thumbnailVisualSignature),
    });
  }

  const projects = Array.from(projectsById.values())
    .sort((left, right) => left.createdAt - right.createdAt || left.projectId.localeCompare(right.projectId));

  const assetIds = Array.from(
    new Set(
      projects
        .map((project) => project.thumbnailAssetId)
        .filter((assetId): assetId is string => typeof assetId === 'string' && assetId.length > 0),
    ),
  );

  return {
    updatedAt: now,
    folders,
    projects,
    assetIds,
  };
}

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

export const getCatalog = query({
  args: {},
  returns: v.union(projectExplorerCatalogValidator, v.null()),
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

    return parseProjectExplorerCatalog(record.stateJson, record.updatedAt);
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
