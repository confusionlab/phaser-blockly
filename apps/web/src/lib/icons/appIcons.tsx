import { createElement } from 'react';

type AppIconSvgTag = 'circle' | 'ellipse' | 'line' | 'path' | 'polygon' | 'polyline' | 'rect';

type AppIconSvgNode = {
  tag: AppIconSvgTag;
  attrs: Record<string, number | string>;
};

type AppIconSource =
  | {
      kind: 'nodes';
      nodes: readonly AppIconSvgNode[];
    }
  | {
      // Raw SVG markup keeps it easy to drop in hand-authored personal icons later.
      kind: 'markup';
      markup: string;
    };

type AppIconDefinition = {
  source: AppIconSource;
  viewBox?: string;
  fill?: string;
  stroke?: string;
  strokeLinecap?: 'butt' | 'round' | 'square';
  strokeLinejoin?: 'bevel' | 'miter' | 'round';
  strokeWidth?: number;
};

type AppIconRenderOptions = {
  color?: string;
  size?: number;
};

export type AppIconName =
  | 'blocklyEventClick'
  | 'blocklyEventForever'
  | 'blocklyEventInventory'
  | 'blocklyEventKey'
  | 'blocklyEventStart'
  | 'blocklyEventWorld'
  | 'blocklyStagePicker'
  | 'variableBoolean'
  | 'variableFloat'
  | 'variableInteger'
  | 'variableString';

export type AppIconProps = AppIconRenderOptions & {
  className?: string;
  decorative?: boolean;
  name: AppIconName;
  title?: string;
};

const LUCIDE_DEFAULTS = {
  fill: 'none',
  stroke: 'currentColor',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  strokeWidth: 2,
  viewBox: '0 0 24 24',
} as const satisfies Omit<AppIconDefinition, 'source'>;

function defineAppIcon(definition: AppIconDefinition): AppIconDefinition {
  return definition;
}

const APP_ICONS = {
  blocklyEventStart: defineAppIcon({
    ...LUCIDE_DEFAULTS,
    source: {
      kind: 'nodes',
      nodes: [
        {
          tag: 'path',
          attrs: {
            d: 'M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528',
          },
        },
      ],
    },
  }),
  blocklyEventKey: defineAppIcon({
    ...LUCIDE_DEFAULTS,
    source: {
      kind: 'nodes',
      nodes: [
        {
          tag: 'path',
          attrs: {
            d: 'M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z',
          },
        },
        {
          tag: 'circle',
          attrs: {
            cx: 16.5,
            cy: 7.5,
            fill: 'currentColor',
            r: 0.5,
          },
        },
      ],
    },
  }),
  blocklyEventClick: defineAppIcon({
    ...LUCIDE_DEFAULTS,
    source: {
      kind: 'nodes',
      nodes: [
        { tag: 'path', attrs: { d: 'M14 4.1 12 6' } },
        { tag: 'path', attrs: { d: 'm5.1 8-2.9-.8' } },
        { tag: 'path', attrs: { d: 'm6 12-1.9 2' } },
        { tag: 'path', attrs: { d: 'M7.2 2.2 8 5.1' } },
        {
          tag: 'path',
          attrs: {
            d: 'M9.037 9.69a.498.498 0 0 1 .653-.653l11 4.5a.5.5 0 0 1-.074.949l-4.349 1.041a1 1 0 0 0-.74.739l-1.04 4.35a.5.5 0 0 1-.95.074z',
          },
        },
      ],
    },
  }),
  blocklyEventWorld: defineAppIcon({
    ...LUCIDE_DEFAULTS,
    source: {
      kind: 'nodes',
      nodes: [
        { tag: 'circle', attrs: { cx: 12, cy: 12, r: 10 } },
        { tag: 'path', attrs: { d: 'M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20' } },
        { tag: 'path', attrs: { d: 'M2 12h20' } },
      ],
    },
  }),
  blocklyEventInventory: defineAppIcon({
    ...LUCIDE_DEFAULTS,
    source: {
      kind: 'nodes',
      nodes: [
        { tag: 'path', attrs: { d: 'M4 10a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z' } },
        { tag: 'path', attrs: { d: 'M8 10h8' } },
        { tag: 'path', attrs: { d: 'M8 18h8' } },
        { tag: 'path', attrs: { d: 'M8 22v-6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v6' } },
        { tag: 'path', attrs: { d: 'M9 6V4a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2' } },
      ],
    },
  }),
  blocklyEventForever: defineAppIcon({
    ...LUCIDE_DEFAULTS,
    source: {
      kind: 'nodes',
      nodes: [
        { tag: 'path', attrs: { d: 'M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8' } },
        { tag: 'path', attrs: { d: 'M21 3v5h-5' } },
      ],
    },
  }),
  blocklyStagePicker: defineAppIcon({
    ...LUCIDE_DEFAULTS,
    source: {
      kind: 'nodes',
      nodes: [
        { tag: 'circle', attrs: { cx: 12, cy: 12, r: 10 } },
        { tag: 'circle', attrs: { cx: 12, cy: 12, r: 6 } },
        { tag: 'circle', attrs: { cx: 12, cy: 12, r: 2 } },
      ],
    },
  }),
  variableString: defineAppIcon({
    ...LUCIDE_DEFAULTS,
    source: {
      kind: 'nodes',
      nodes: [
        { tag: 'path', attrs: { d: 'M12 4v16' } },
        { tag: 'path', attrs: { d: 'M4 7V5a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v2' } },
        { tag: 'path', attrs: { d: 'M9 20h6' } },
      ],
    },
  }),
  variableInteger: defineAppIcon({
    ...LUCIDE_DEFAULTS,
    source: {
      kind: 'nodes',
      nodes: [
        { tag: 'line', attrs: { x1: 4, x2: 20, y1: 9, y2: 9 } },
        { tag: 'line', attrs: { x1: 4, x2: 20, y1: 15, y2: 15 } },
        { tag: 'line', attrs: { x1: 10, x2: 8, y1: 3, y2: 21 } },
        { tag: 'line', attrs: { x1: 16, x2: 14, y1: 3, y2: 21 } },
      ],
    },
  }),
  variableFloat: defineAppIcon({
    ...LUCIDE_DEFAULTS,
    source: {
      kind: 'markup',
      markup: `
        <line x1="4" x2="16" y1="9" y2="9" />
        <line x1="4" x2="16" y1="15" y2="15" />
        <line x1="10" x2="8" y1="3" y2="21" />
        <line x1="16" x2="14" y1="3" y2="21" />
        <circle cx="20" cy="18" r="1.6" fill="currentColor" stroke="none" />
      `,
    },
  }),
  variableBoolean: defineAppIcon({
    ...LUCIDE_DEFAULTS,
    source: {
      kind: 'nodes',
      nodes: [
        {
          tag: 'path',
          attrs: {
            d: 'M2.7 10.3a2.41 2.41 0 0 0 0 3.41l7.59 7.59a2.41 2.41 0 0 0 3.41 0l7.59-7.59a2.41 2.41 0 0 0 0-3.41l-7.59-7.59a2.41 2.41 0 0 0-3.41 0Z',
          },
        },
      ],
    },
  }),
} as const satisfies Record<AppIconName, AppIconDefinition>;

function escapeXmlAttribute(value: number | string): string {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function renderIconMarkup(source: AppIconSource, color = 'currentColor'): string {
  if (source.kind === 'markup') {
    return source.markup.trim();
  }

  return source.nodes
    .map(({ attrs, tag }) => {
      const resolvedAttrs: Record<string, number | string> = { ...attrs };
      const resolvedStroke = resolvePaintValue(
        typeof resolvedAttrs.stroke === 'string' ? resolvedAttrs.stroke : undefined,
        color,
        color,
      );
      const resolvedFill = resolvePaintValue(
        typeof resolvedAttrs.fill === 'string' ? resolvedAttrs.fill : undefined,
        color,
        'none',
      );

      if (!('stroke' in resolvedAttrs) && resolvedStroke !== 'none') {
        resolvedAttrs.stroke = resolvedStroke;
      } else if (typeof resolvedAttrs.stroke === 'string') {
        resolvedAttrs.stroke = resolvedStroke;
      }

      if (!('fill' in resolvedAttrs)) {
        resolvedAttrs.fill = resolvedFill;
      } else if (typeof resolvedAttrs.fill === 'string') {
        resolvedAttrs.fill = resolvedFill;
      }

      const attrString = Object.entries(resolvedAttrs)
        .map(([key, value]) => `${key}="${escapeXmlAttribute(value)}"`)
        .join(' ');
      return `<${tag} ${attrString} />`;
    })
    .join('');
}

function resolveIconDefinition(name: AppIconName): AppIconDefinition {
  return APP_ICONS[name];
}

function resolvePaintValue(value: string | undefined, color: string, fallback: string): string {
  if (!value) return fallback;
  return value === 'currentColor' ? color : value;
}

export function renderAppIconSvg(name: AppIconName, options: AppIconRenderOptions = {}): string {
  const { color = 'currentColor', size = 16 } = options;
  const definition = resolveIconDefinition(name);
  const markup = renderIconMarkup(definition.source, color);

  return [
    '<svg xmlns="http://www.w3.org/2000/svg"',
    ` width="${size}"`,
    ` height="${size}"`,
    ` viewBox="${definition.viewBox ?? '0 0 24 24'}"`,
    ` fill="${resolvePaintValue(definition.fill, color, 'none')}"`,
    ` stroke="${resolvePaintValue(definition.stroke, color, color)}"`,
    ` stroke-width="${definition.strokeWidth ?? 2}"`,
    ` stroke-linecap="${definition.strokeLinecap ?? 'round'}"`,
    ` stroke-linejoin="${definition.strokeLinejoin ?? 'round'}"`,
    ' aria-hidden="true"',
    ` color="${color}">`,
    markup,
    '</svg>',
  ].join('');
}

export function getAppIconDataUri(name: AppIconName, options: AppIconRenderOptions = {}): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(renderAppIconSvg(name, options))}`;
}

export function AppIcon({
  className,
  color = 'currentColor',
  decorative = true,
  name,
  size = 16,
  title,
}: AppIconProps) {
  const definition = resolveIconDefinition(name);
  const sharedProps = {
    'aria-hidden': decorative ? true : undefined,
    'aria-label': decorative ? undefined : title,
    className,
    fill: resolvePaintValue(definition.fill, color, 'none'),
    height: size,
    role: decorative ? undefined : 'img',
    stroke: resolvePaintValue(definition.stroke, color, color),
    strokeLinecap: definition.strokeLinecap ?? 'round',
    strokeLinejoin: definition.strokeLinejoin ?? 'round',
    strokeWidth: definition.strokeWidth ?? 2,
    viewBox: definition.viewBox ?? '0 0 24 24',
    width: size,
    xmlns: 'http://www.w3.org/2000/svg',
  };

  if (definition.source.kind === 'markup') {
    return (
      <svg
        {...sharedProps}
        dangerouslySetInnerHTML={{ __html: renderIconMarkup(definition.source) }}
      />
    );
  }

  return (
    <svg {...sharedProps}>
      {!decorative && title ? <title>{title}</title> : null}
      {definition.source.nodes.map((node, index) => createElement(node.tag, { key: `${name}-${index}`, ...node.attrs }))}
    </svg>
  );
}
