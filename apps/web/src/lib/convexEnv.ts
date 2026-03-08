function trimOrUndefined(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function getConvexCloudUrl(): string | null {
  return trimOrUndefined(import.meta.env.VITE_CONVEX_URL) ?? null;
}

export function getConvexSiteUrl(): string | null {
  const siteUrl = trimOrUndefined(import.meta.env.VITE_CONVEX_SITE_URL);
  if (siteUrl) return siteUrl;

  // Keep deriving site URL from cloud URL as the last fallback.

  const cloudUrl = getConvexCloudUrl();
  if (!cloudUrl) return null;
  return cloudUrl.replace('.cloud', '.site');
}
