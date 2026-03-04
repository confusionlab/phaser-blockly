function trimOrUndefined(value: string | undefined): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function resolveModeSpecificValue(devValue?: string, prodValue?: string): string | undefined {
  if (import.meta.env.DEV) {
    return trimOrUndefined(devValue);
  }
  if (import.meta.env.PROD) {
    return trimOrUndefined(prodValue);
  }
  return undefined;
}

export function getConvexCloudUrl(): string | null {
  const modeSpecific = resolveModeSpecificValue(
    import.meta.env.VITE_CONVEX_URL_DEV,
    import.meta.env.VITE_CONVEX_URL_PROD,
  );
  const fallback = trimOrUndefined(import.meta.env.VITE_CONVEX_URL);
  return modeSpecific || fallback || null;
}

export function getConvexSiteUrl(): string | null {
  const modeSpecific = resolveModeSpecificValue(
    import.meta.env.VITE_CONVEX_SITE_URL_DEV,
    import.meta.env.VITE_CONVEX_SITE_URL_PROD,
  );
  const fallback = trimOrUndefined(import.meta.env.VITE_CONVEX_SITE_URL);
  if (modeSpecific) return modeSpecific;
  if (fallback) return fallback;

  const cloudUrl = getConvexCloudUrl();
  if (!cloudUrl) return null;
  return cloudUrl.replace('.cloud', '.site');
}

