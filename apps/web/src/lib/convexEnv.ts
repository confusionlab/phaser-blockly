function trimOrUndefined(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

export function getConvexCloudUrl(): string | null {
  const dev = trimOrUndefined(import.meta.env.VITE_CONVEX_URL_DEV);
  const prod = trimOrUndefined(import.meta.env.VITE_CONVEX_URL_PROD);
  const fallback = trimOrUndefined(import.meta.env.VITE_CONVEX_URL);

  // In production builds, require explicit prod URL to avoid silently writing to a dev deployment.
  if (import.meta.env.PROD) {
    return prod || null;
  }
  if (import.meta.env.DEV) {
    return dev || fallback || null;
  }
  return fallback || prod || dev || null;
}

export function getConvexSiteUrl(): string | null {
  const dev = trimOrUndefined(import.meta.env.VITE_CONVEX_SITE_URL_DEV);
  const prod = trimOrUndefined(import.meta.env.VITE_CONVEX_SITE_URL_PROD);
  const fallback = trimOrUndefined(import.meta.env.VITE_CONVEX_SITE_URL);

  if (import.meta.env.PROD) {
    if (prod) return prod;
  } else if (import.meta.env.DEV) {
    if (dev) return dev;
    if (fallback) return fallback;
  } else if (fallback) {
    return fallback;
  }

  // Keep deriving site URL from cloud URL as the last fallback.

  const cloudUrl = getConvexCloudUrl();
  if (!cloudUrl) return null;
  return cloudUrl.replace('.cloud', '.site');
}
