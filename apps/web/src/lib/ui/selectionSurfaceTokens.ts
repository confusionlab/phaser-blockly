export const selectionSurfaceClassNames = {
  selected: 'bg-[var(--editor-selection-surface-selected)]',
  dropTarget: 'bg-[var(--editor-selection-surface-drop-target)]',
  hover: 'bg-[var(--editor-selection-surface-hover)]',
  interactiveHover: 'hover:bg-[var(--editor-selection-surface-hover)]',
  hoverFocus: 'focus:bg-[var(--editor-selection-surface-hover)]',
} as const;
