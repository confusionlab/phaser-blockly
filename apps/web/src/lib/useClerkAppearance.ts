import { useMemo } from 'react';
import { createClerkAppearance } from '@/lib/clerkAppearance';
import { useEditorStore } from '@/store/editorStore';

export function useClerkAppearance() {
  const isDarkMode = useEditorStore((state) => state.isDarkMode);

  return useMemo(
    () => createClerkAppearance(isDarkMode ? 'dark' : 'light'),
    [isDarkMode],
  );
}
