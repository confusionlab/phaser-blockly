const AUTH_SESSION_HINT_STORAGE_KEY = 'pochacoding-auth-session-hint';
const AUTH_SESSION_HINT_VERSION = 1;
const AUTH_SESSION_HINT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type StorageReader = Pick<Storage, 'getItem'> | null | undefined;
type StorageWriter = Pick<Storage, 'setItem' | 'removeItem'> | null | undefined;

type AuthSessionHintRecord = {
  version: number;
  lastAuthenticatedAt: number;
};

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function parseAuthSessionHint(raw: string | null): AuthSessionHintRecord | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<AuthSessionHintRecord>;
    if (
      parsed.version !== AUTH_SESSION_HINT_VERSION
      || !isFiniteTimestamp(parsed.lastAuthenticatedAt)
    ) {
      return null;
    }

    return {
      version: parsed.version,
      lastAuthenticatedAt: parsed.lastAuthenticatedAt,
    };
  } catch {
    return null;
  }
}

export function hasRecentAuthenticatedSessionHint(
  storage: StorageReader,
  now = Date.now(),
): boolean {
  if (!storage) {
    return false;
  }

  const record = parseAuthSessionHint(storage.getItem(AUTH_SESSION_HINT_STORAGE_KEY));
  if (!record) {
    return false;
  }

  return now - record.lastAuthenticatedAt <= AUTH_SESSION_HINT_MAX_AGE_MS;
}

export function persistAuthenticatedSessionHint(
  storage: StorageWriter,
  now = Date.now(),
): void {
  if (!storage) {
    return;
  }

  storage.setItem(
    AUTH_SESSION_HINT_STORAGE_KEY,
    JSON.stringify({
      version: AUTH_SESSION_HINT_VERSION,
      lastAuthenticatedAt: now,
    } satisfies AuthSessionHintRecord),
  );
}

export function clearAuthenticatedSessionHint(storage: StorageWriter): void {
  storage?.removeItem(AUTH_SESSION_HINT_STORAGE_KEY);
}

export function shouldWarmStartProjectExplorer(options: {
  hasRecentSessionHint: boolean;
  isAuthenticated: boolean;
  isLoading: boolean;
  pathname: string;
}): boolean {
  return (
    options.hasRecentSessionHint
    && options.isLoading
    && !options.isAuthenticated
    && options.pathname === '/'
  );
}
