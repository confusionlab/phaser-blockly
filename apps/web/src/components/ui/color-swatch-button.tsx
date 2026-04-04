import Color from 'color';
import * as React from 'react';

import { cn } from '@/lib/utils';

interface RgbaColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

interface SwatchOutlineState {
  color: string;
  visible: boolean;
}

const LIGHT_SURFACE_OUTLINE = 'rgba(15, 23, 42, 0.24)';
const DARK_SURFACE_OUTLINE = 'rgba(255, 255, 255, 0.72)';
const MIN_SWATCH_SURFACE_CONTRAST = 1.35;
const FALLBACK_LIGHT_SURFACE: RgbaColor = { red: 255, green: 255, blue: 255, alpha: 1 };
const FALLBACK_DARK_SURFACE: RgbaColor = { red: 17, green: 17, blue: 17, alpha: 1 };

function parseResolvedColor(value: string | null | undefined): RgbaColor | null {
  if (!value) {
    return null;
  }

  try {
    const color = Color(value);
    const [red, green, blue] = color.rgb().array();
    return {
      red,
      green,
      blue,
      alpha: color.alpha(),
    };
  } catch {
    return null;
  }
}

function compositeColor(foreground: RgbaColor, background: RgbaColor): RgbaColor {
  const alpha = foreground.alpha + background.alpha * (1 - foreground.alpha);
  if (alpha <= 0) {
    return { red: 0, green: 0, blue: 0, alpha: 0 };
  }

  return {
    red: Math.round(
      ((foreground.red * foreground.alpha) + (background.red * background.alpha * (1 - foreground.alpha))) / alpha,
    ),
    green: Math.round(
      ((foreground.green * foreground.alpha) + (background.green * background.alpha * (1 - foreground.alpha))) / alpha,
    ),
    blue: Math.round(
      ((foreground.blue * foreground.alpha) + (background.blue * background.alpha * (1 - foreground.alpha))) / alpha,
    ),
    alpha,
  };
}

function toOpaqueColor(color: RgbaColor, background: RgbaColor): RgbaColor {
  if (color.alpha >= 0.999) {
    return { ...color, alpha: 1 };
  }

  return compositeColor(color, background);
}

function toLinearChannel(channel: number): number {
  const normalized = channel / 255;
  if (normalized <= 0.04045) {
    return normalized / 12.92;
  }

  return ((normalized + 0.055) / 1.055) ** 2.4;
}

function getRelativeLuminance(color: RgbaColor): number {
  return (
    0.2126 * toLinearChannel(color.red)
    + 0.7152 * toLinearChannel(color.green)
    + 0.0722 * toLinearChannel(color.blue)
  );
}

function getContrastRatio(a: RgbaColor, b: RgbaColor): number {
  const lighter = Math.max(getRelativeLuminance(a), getRelativeLuminance(b));
  const darker = Math.min(getRelativeLuminance(a), getRelativeLuminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function resolveFallbackSurfaceColor(document: Document): RgbaColor {
  const root = document.documentElement;
  const colorScheme = document.defaultView?.getComputedStyle(root).colorScheme ?? '';
  return root.classList.contains('dark') || colorScheme.includes('dark')
    ? FALLBACK_DARK_SURFACE
    : FALLBACK_LIGHT_SURFACE;
}

function resolveSurfaceColor(surface: HTMLElement | null): RgbaColor {
  if (!surface) {
    return FALLBACK_LIGHT_SURFACE;
  }

  const view = surface.ownerDocument.defaultView;
  if (!view) {
    return resolveFallbackSurfaceColor(surface.ownerDocument);
  }

  const layers: RgbaColor[] = [];

  for (let current: HTMLElement | null = surface; current; current = current.parentElement) {
    const layer = parseResolvedColor(view.getComputedStyle(current).backgroundColor);
    if (layer && layer.alpha > 0) {
      layers.push(layer);
    }
  }

  return layers.reverse().reduce(
    (resolvedSurface, layer) => compositeColor(layer, resolvedSurface),
    resolveFallbackSurfaceColor(surface.ownerDocument),
  );
}

function getSwatchOutlineState(value: string, surface: RgbaColor): SwatchOutlineState {
  const swatch = parseResolvedColor(value);
  if (!swatch) {
    return { visible: false, color: LIGHT_SURFACE_OUTLINE };
  }

  const displayedSwatch = toOpaqueColor(swatch, surface);
  const needsOutline = getContrastRatio(displayedSwatch, surface) < MIN_SWATCH_SURFACE_CONTRAST;
  const outlineColor = getRelativeLuminance(surface) < 0.42 ? DARK_SURFACE_OUTLINE : LIGHT_SURFACE_OUTLINE;

  return {
    color: outlineColor,
    visible: needsOutline,
  };
}

function assignButtonRef(
  ref: React.ForwardedRef<HTMLButtonElement>,
  node: HTMLButtonElement | null,
) {
  if (typeof ref === 'function') {
    ref(node);
    return;
  }

  if (ref) {
    ref.current = node;
  }
}

export interface ColorSwatchButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  mixed?: boolean;
  swatchClassName?: string;
  value: string;
}

export const ColorSwatchButton = React.forwardRef<HTMLButtonElement, ColorSwatchButtonProps>(
  function ColorSwatchButton(
    {
      className,
      mixed = false,
      style,
      swatchClassName,
      type = 'button',
      value,
      ...props
    },
    forwardedRef,
  ) {
    const buttonRef = React.useRef<HTMLButtonElement | null>(null);
    const [outlineState, setOutlineState] = React.useState<SwatchOutlineState>({
      color: LIGHT_SURFACE_OUTLINE,
      visible: false,
    });

    const updateOutline = React.useCallback(() => {
      const button = buttonRef.current;
      if (!button) {
        return;
      }

      const nextState = getSwatchOutlineState(value, resolveSurfaceColor(button));
      setOutlineState((currentState) => (
        currentState.visible === nextState.visible && currentState.color === nextState.color
          ? currentState
          : nextState
      ));
    }, [value]);

    const handleRef = React.useCallback((node: HTMLButtonElement | null) => {
      buttonRef.current = node;
      assignButtonRef(forwardedRef, node);
    }, [forwardedRef]);

    React.useLayoutEffect(() => {
      updateOutline();
    });

    React.useEffect(() => {
      const button = buttonRef.current;
      const view = button?.ownerDocument.defaultView;
      if (!button || !view) {
        return;
      }

      const observedElements = [
        button,
        button.parentElement,
        button.ownerDocument.body,
        button.ownerDocument.documentElement,
      ].filter((element): element is HTMLElement => !!element);

      const mutationObserver = new MutationObserver(() => {
        updateOutline();
      });

      observedElements.forEach((element) => {
        mutationObserver.observe(element, {
          attributes: true,
          attributeFilter: ['class', 'style', 'data-theme'],
        });
      });

      const resizeObserver = typeof ResizeObserver === 'function'
        ? new ResizeObserver(() => {
          updateOutline();
        })
        : null;
      observedElements.forEach((element) => resizeObserver?.observe(element));

      const mediaQuery = view.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => {
        updateOutline();
      };

      if (typeof mediaQuery.addEventListener === 'function') {
        mediaQuery.addEventListener('change', handleChange);
      } else {
        mediaQuery.addListener(handleChange);
      }
      view.addEventListener('resize', handleChange);

      return () => {
        mutationObserver.disconnect();
        resizeObserver?.disconnect();
        if (typeof mediaQuery.removeEventListener === 'function') {
          mediaQuery.removeEventListener('change', handleChange);
        } else {
          mediaQuery.removeListener(handleChange);
        }
        view.removeEventListener('resize', handleChange);
      };
    }, [updateOutline]);

    return (
      <button
        ref={handleRef}
        type={type}
        className={cn(
          'inline-flex shrink-0 items-center justify-center overflow-hidden p-0 align-middle',
          className,
        )}
        style={style}
        {...props}
      >
        <span
          className={cn('relative block size-full rounded-md', swatchClassName)}
          style={{
            backgroundColor: value,
            boxShadow: outlineState.visible ? `inset 0 0 0 1px ${outlineState.color}` : undefined,
          }}
          data-outline-visible={outlineState.visible ? 'true' : 'false'}
          aria-hidden="true"
        >
          {mixed ? (
            <span
              className="absolute inset-0 flex items-center justify-center text-[13px] font-semibold leading-none text-foreground"
              aria-hidden="true"
            >
              ?
            </span>
          ) : null}
        </span>
      </button>
    );
  },
);

ColorSwatchButton.displayName = 'ColorSwatchButton';
