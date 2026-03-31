import Color from 'color';

const MIN_VISIBLE_ALPHA = 0.01;
const OPAQUE_ALPHA_THRESHOLD = 0.995;
const SWATCH_OUTLINE_MIN_CONTRAST = 1.35;
const SWATCH_OUTLINE_MAX_DELTA = 18;
type ColorInstance = ReturnType<typeof Color>;

function parseColorValue(value: string | null | undefined): ColorInstance | null {
  if (!value) {
    return null;
  }

  try {
    return Color(value);
  } catch {
    return null;
  }
}

function compositeForegroundOverBackground(
  foreground: ColorInstance,
  background: ColorInstance,
): ColorInstance {
  const foregroundAlpha = foreground.alpha();
  const backgroundAlpha = background.alpha();
  const outputAlpha = foregroundAlpha + backgroundAlpha * (1 - foregroundAlpha);

  if (outputAlpha <= MIN_VISIBLE_ALPHA) {
    return Color.rgb(0, 0, 0).alpha(0);
  }

  const [foregroundRed, foregroundGreen, foregroundBlue] = foreground.rgb().array();
  const [backgroundRed, backgroundGreen, backgroundBlue] = background.rgb().array();

  const mixChannel = (foregroundChannel: number, backgroundChannel: number) =>
    (foregroundChannel * foregroundAlpha +
      backgroundChannel * backgroundAlpha * (1 - foregroundAlpha)) /
    outputAlpha;

  return Color.rgb(
    mixChannel(foregroundRed, backgroundRed),
    mixChannel(foregroundGreen, backgroundGreen),
    mixChannel(foregroundBlue, backgroundBlue),
  ).alpha(outputAlpha);
}

function getContrastRatio(foreground: ColorInstance, background: ColorInstance): number {
  const foregroundLuminosity = foreground.luminosity();
  const backgroundLuminosity = background.luminosity();
  const lighter = Math.max(foregroundLuminosity, backgroundLuminosity);
  const darker = Math.min(foregroundLuminosity, backgroundLuminosity);
  return (lighter + 0.05) / (darker + 0.05);
}

function getLabDistance(first: ColorInstance, second: ColorInstance): number {
  const [firstLightness, firstA, firstB] = first.lab().array();
  const [secondLightness, secondA, secondB] = second.lab().array();
  return Math.sqrt(
    (firstLightness - secondLightness) ** 2 +
      (firstA - secondA) ** 2 +
      (firstB - secondB) ** 2,
  );
}

export function getBackgroundSampleElements(element: HTMLElement | null): HTMLElement[] {
  const elements: HTMLElement[] = [];
  let current = element;

  while (current) {
    elements.push(current);
    current = current.parentElement;
  }

  return elements;
}

export function resolveElementSurfaceColor(element: HTMLElement | null): string | null {
  if (typeof window === 'undefined') {
    return null;
  }

  let resolvedSurface: ColorInstance | null = null;

  for (const sampleElement of getBackgroundSampleElements(element)) {
    const backgroundColor = parseColorValue(window.getComputedStyle(sampleElement).backgroundColor);
    if (!backgroundColor || backgroundColor.alpha() <= MIN_VISIBLE_ALPHA) {
      continue;
    }

    resolvedSurface = resolvedSurface
      ? compositeForegroundOverBackground(resolvedSurface, backgroundColor)
      : backgroundColor;

    if (resolvedSurface.alpha() >= OPAQUE_ALPHA_THRESHOLD) {
      break;
    }
  }

  if (!resolvedSurface) {
    return null;
  }

  return resolvedSurface.rgb().string();
}

export function resolveAdaptiveSwatchOutlineColor(
  swatchColorValue: string,
  surfaceColorValue: string | null | undefined,
): string | null {
  const swatchColor = parseColorValue(swatchColorValue);
  const surfaceColor = parseColorValue(surfaceColorValue);

  if (!swatchColor || !surfaceColor) {
    return null;
  }

  const visibleSwatchColor =
    swatchColor.alpha() >= OPAQUE_ALPHA_THRESHOLD
      ? swatchColor
      : compositeForegroundOverBackground(swatchColor, surfaceColor);
  const contrastRatio = getContrastRatio(visibleSwatchColor, surfaceColor);
  const labDistance = getLabDistance(visibleSwatchColor, surfaceColor);

  if (
    contrastRatio >= SWATCH_OUTLINE_MIN_CONTRAST &&
    labDistance >= SWATCH_OUTLINE_MAX_DELTA
  ) {
    return null;
  }

  const outlineBaseColor =
    surfaceColor.luminosity() < 0.35
      ? Color('#ffffff').alpha(0.52)
      : Color('#0f172a').alpha(0.22);

  return outlineBaseColor.rgb().string();
}
