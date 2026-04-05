export type EditorSelectionRgb = {
  r: number;
  g: number;
  b: number;
};

export type ResolvedEditorSelectionTokens = {
  accent: string;
  accentRgb: EditorSelectionRgb;
  fill: string;
  fillAlpha: number;
  handleFill: string;
  handleStroke: string;
};

export const DEFAULT_EDITOR_SELECTION_RGB: EditorSelectionRgb = {
  r: 14,
  g: 165,
  b: 233,
};

export const DEFAULT_EDITOR_SELECTION_FILL_ALPHA = 0.08;
export const DEFAULT_EDITOR_SELECTION_ACCENT = toCssRgb(DEFAULT_EDITOR_SELECTION_RGB);
export const DEFAULT_EDITOR_SELECTION_FILL = createSelectionFillCss(
  DEFAULT_EDITOR_SELECTION_RGB,
  DEFAULT_EDITOR_SELECTION_FILL_ALPHA,
);
export const DEFAULT_EDITOR_SELECTION_HANDLE_FILL = '#ffffff';
export const DEFAULT_EDITOR_SELECTION_HANDLE_STROKE = DEFAULT_EDITOR_SELECTION_ACCENT;

function toCssRgb(rgb: EditorSelectionRgb) {
  return `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
}

export function createSelectionFillCss(
  rgb: EditorSelectionRgb,
  alpha: number = DEFAULT_EDITOR_SELECTION_FILL_ALPHA,
) {
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
}

function parseRgbChannels(value: string): EditorSelectionRgb | null {
  const normalized = value
    .trim()
    .replace(/rgba?\(/gi, '')
    .replace(/\)/g, '')
    .replace(/\//g, ' ')
    .replace(/,/g, ' ');

  if (!normalized) {
    return null;
  }

  const channels = normalized
    .split(/\s+/)
    .map((segment) => Number.parseFloat(segment))
    .filter((channel) => Number.isFinite(channel));

  if (channels.length < 3) {
    return null;
  }

  return {
    r: Math.max(0, Math.min(255, Math.round(channels[0]!))),
    g: Math.max(0, Math.min(255, Math.round(channels[1]!))),
    b: Math.max(0, Math.min(255, Math.round(channels[2]!))),
  };
}

function getRootStyle() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  return window.getComputedStyle(document.documentElement);
}

function readRootVar(style: CSSStyleDeclaration | null, name: string) {
  return style?.getPropertyValue(name).trim() ?? '';
}

export function getResolvedEditorSelectionTokens(): ResolvedEditorSelectionTokens {
  const rootStyle = getRootStyle();
  const accentRgb = parseRgbChannels(readRootVar(rootStyle, '--editor-selection-accent-rgb'))
    ?? DEFAULT_EDITOR_SELECTION_RGB;
  const accent = readRootVar(rootStyle, '--editor-selection-accent')
    || toCssRgb(accentRgb);
  const parsedFillAlpha = Number.parseFloat(readRootVar(rootStyle, '--editor-selection-fill-alpha'));
  const fillAlpha = Number.isFinite(parsedFillAlpha) && parsedFillAlpha >= 0
    ? parsedFillAlpha
    : DEFAULT_EDITOR_SELECTION_FILL_ALPHA;
  const fill = readRootVar(rootStyle, '--editor-selection-accent-fill')
    || createSelectionFillCss(accentRgb, fillAlpha);
  const handleFill = readRootVar(rootStyle, '--editor-selection-handle-fill')
    || DEFAULT_EDITOR_SELECTION_HANDLE_FILL;
  const handleStroke = readRootVar(rootStyle, '--editor-selection-handle-stroke')
    || accent;

  return {
    accent,
    accentRgb,
    fill,
    fillAlpha,
    handleFill,
    handleStroke,
  };
}

export function rgbToPhaserColor(rgb: EditorSelectionRgb) {
  return (rgb.r << 16) | (rgb.g << 8) | rgb.b;
}
