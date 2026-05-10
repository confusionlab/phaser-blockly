import { useEffect, useState } from 'react';

export type CostumeEditorProvider = 'pocha' | 'scratch';

const COSTUME_EDITOR_PROVIDER_STORAGE_KEY = 'pochacoding:costume-editor-provider';
const COSTUME_EDITOR_PROVIDER_CHANGE_EVENT = 'pochacoding:costume-editor-provider-change';

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

export function setCostumeEditorProvider(provider: CostumeEditorProvider): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(COSTUME_EDITOR_PROVIDER_STORAGE_KEY, provider);
  window.dispatchEvent(new CustomEvent(COSTUME_EDITOR_PROVIDER_CHANGE_EVENT, {
    detail: { provider },
  }));
}

export function useCostumeEditorProvider(): CostumeEditorProvider {
  const [provider, setProvider] = useState(() => getCostumeEditorProvider());

  useEffect(() => {
    const handleChange = () => setProvider(getCostumeEditorProvider());
    window.addEventListener(COSTUME_EDITOR_PROVIDER_CHANGE_EVENT, handleChange);
    window.addEventListener('storage', handleChange);
    return () => {
      window.removeEventListener(COSTUME_EDITOR_PROVIDER_CHANGE_EVENT, handleChange);
      window.removeEventListener('storage', handleChange);
    };
  }, []);

  return provider;
}

export { COSTUME_EDITOR_PROVIDER_STORAGE_KEY };
