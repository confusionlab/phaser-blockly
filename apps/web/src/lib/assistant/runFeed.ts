export type RunFeedTone = 'normal' | 'warning';

export type RunFeedItem = {
  id: string;
  label: string;
  detail?: string;
  status: 'running' | 'completed';
  tone?: RunFeedTone;
  tool?: string;
};

const MAX_RUN_FEED_ITEMS = 12;

function trimRunFeed(items: RunFeedItem[]): RunFeedItem[] {
  return items.slice(-MAX_RUN_FEED_ITEMS);
}

export function appendCompletedRunFeedItem(
  items: RunFeedItem[],
  {
    id,
    label,
    detail,
    tone = 'normal',
  }: {
    id: string;
    label: string;
    detail?: string;
    tone?: RunFeedTone;
  },
): RunFeedItem[] {
  return trimRunFeed([
    ...items,
    {
      id,
      label,
      detail,
      status: 'completed',
      tone,
    },
  ]);
}

export function startToolRunFeedItem(
  items: RunFeedItem[],
  {
    id,
    tool,
    detail,
  }: {
    id: string;
    tool: string;
    detail?: string;
  },
): RunFeedItem[] {
  return trimRunFeed([
    ...items,
    {
      id,
      label: `Running ${tool}...`,
      detail,
      status: 'running',
      tone: 'normal',
      tool,
    },
  ]);
}

export function finishToolRunFeedItem(
  items: RunFeedItem[],
  {
    eventId,
    tool,
    label,
    detail,
    tone = 'normal',
  }: {
    eventId: string;
    tool: string;
    label: string;
    detail?: string;
    tone?: RunFeedTone;
  },
): RunFeedItem[] {
  const nextItems = [...items];

  for (let index = nextItems.length - 1; index >= 0; index -= 1) {
    const item = nextItems[index];
    if (item.status === 'running' && item.tool === tool) {
      nextItems[index] = {
        ...item,
        label,
        detail,
        status: 'completed',
        tone,
      };
      return trimRunFeed(nextItems);
    }
  }

  return trimRunFeed([
    ...nextItems,
    {
      id: eventId,
      label,
      detail,
      status: 'completed',
      tone,
      tool,
    },
  ]);
}
