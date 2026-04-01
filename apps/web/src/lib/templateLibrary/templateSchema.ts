import { CURRENT_PROJECT_SCHEMA_VERSION } from '@/lib/persistence/schemaVersion';

export type TemplateLibraryScope = 'system' | 'user';

export function normalizeTemplateLibraryScope(scope: unknown): TemplateLibraryScope {
  return scope === 'system' ? 'system' : 'user';
}

export function assertSupportedTemplateSchemaVersion(
  schemaVersion: unknown,
  label = 'template',
): number {
  const normalized = typeof schemaVersion === 'number' && Number.isFinite(schemaVersion) && schemaVersion >= 1
    ? Math.floor(schemaVersion)
    : CURRENT_PROJECT_SCHEMA_VERSION;

  if (normalized > CURRENT_PROJECT_SCHEMA_VERSION) {
    throw new Error(
      `${label} requires schema v${normalized} but this app supports up to v${CURRENT_PROJECT_SCHEMA_VERSION}.`,
    );
  }

  return normalized;
}
