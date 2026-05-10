export type CostumeEditorProvider = 'pocha' | 'scratch';

const COSTUME_EDITOR_PROVIDER_STORAGE_KEY = 'pochacoding:costume-editor-provider';

function normalizeCostumeEditorProvider(value: unknown): CostumeEditorProvider | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'scratch' || normalized === 'scratch-paint' || normalized === 'penguin') {
    return 'scratch';
  }
  if (normalized === 'pocha' || normalized === 'default') {
    return 'pocha';
  }
  return null;
}

function readRuntimeCostumeEditorProviderOverride(): CostumeEditorProvider | null {
  if (typeof window === 'undefined') {
    return null;
  }
  if (!import.meta.env.DEV && import.meta.env.VITE_E2E_AUTH_BYPASS !== '1') {
    return null;
  }

  try {
    return normalizeCostumeEditorProvider(window.localStorage.getItem(COSTUME_EDITOR_PROVIDER_STORAGE_KEY));
  } catch {
    return null;
  }
}

export function getCostumeEditorProvider(): CostumeEditorProvider {
  return (
    readRuntimeCostumeEditorProviderOverride()
    ?? normalizeCostumeEditorProvider(import.meta.env.VITE_COSTUME_EDITOR_PROVIDER)
    ?? 'pocha'
  );
}

export { COSTUME_EDITOR_PROVIDER_STORAGE_KEY };
