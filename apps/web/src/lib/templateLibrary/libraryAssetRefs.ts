import type { Id } from '@convex-generated/dataModel';
import {
  getManagedAssetBlob,
  getManagedAssetMetadata,
  hasManagedAsset,
  storeManagedAsset,
  type ManagedAssetKind,
} from '@/db/database';
import { assetSourceToBlob } from '@/utils/convexHelpers';

export interface LibraryAssetRef {
  assetId: string;
  kind: ManagedAssetKind;
}

interface CloudAssetApi {
  listMissingAssetIds: (assetIds: string[]) => Promise<string[]>;
  generateUploadUrl: () => Promise<string>;
  upsertAsset: (args: {
    assetId: string;
    kind: ManagedAssetKind;
    mimeType: string;
    size: number;
    storageId: Id<'_storage'>;
  }) => Promise<unknown>;
}

export function collectUniqueLibraryAssetRefs<T extends LibraryAssetRef>(refs: Iterable<T>): T[] {
  return Array.from(
    Array.from(refs).reduce((map, ref) => {
      map.set(`${ref.kind}:${ref.assetId}`, ref);
      return map;
    }, new Map<string, T>()).values(),
  );
}

async function uploadManagedAssetToCloud(
  assetId: string,
  generateUploadUrl: () => Promise<string>,
): Promise<{ storageId: string; mimeType: string; size: number }> {
  const blob = await getManagedAssetBlob(assetId);
  const metadata = await getManagedAssetMetadata(assetId);
  if (!blob || !metadata) {
    throw new Error(`Missing managed asset ${assetId}`);
  }

  const uploadUrl = await generateUploadUrl();
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': metadata.mimeType },
    body: blob,
  });

  if (!response.ok) {
    throw new Error(`Asset upload failed (${response.status})`);
  }

  const result = (await response.json()) as { storageId: string };
  return {
    storageId: result.storageId,
    mimeType: metadata.mimeType,
    size: metadata.size,
  };
}

export async function ensureLibraryAssetRefsInCloud<T extends LibraryAssetRef>(
  refs: Iterable<T>,
  api: CloudAssetApi,
): Promise<void> {
  const uniqueRefs = collectUniqueLibraryAssetRefs(refs);
  if (uniqueRefs.length === 0) {
    return;
  }

  const missingAssetIds = new Set(await api.listMissingAssetIds(uniqueRefs.map((ref) => ref.assetId)));
  for (const ref of uniqueRefs) {
    if (!missingAssetIds.has(ref.assetId)) {
      continue;
    }

    const upload = await uploadManagedAssetToCloud(ref.assetId, api.generateUploadUrl);
    await api.upsertAsset({
      assetId: ref.assetId,
      kind: ref.kind,
      mimeType: upload.mimeType,
      size: upload.size,
      storageId: upload.storageId as Id<'_storage'>,
    });
  }
}

export async function ensureLibraryAssetsAvailableLocally<T extends LibraryAssetRef & { url?: string | null }>(
  refs: Iterable<T>,
): Promise<void> {
  for (const asset of refs) {
    if (await hasManagedAsset(asset.assetId)) {
      continue;
    }
    if (!asset.url) {
      throw new Error(`Library asset ${asset.assetId} is unavailable`);
    }
    const blob = await assetSourceToBlob(asset.url);
    await storeManagedAsset(asset.assetId, blob, asset.kind);
  }
}
