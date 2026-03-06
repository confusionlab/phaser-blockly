export type RunFeedTone = 'normal' | 'warning';

export type RunFeedItem = {
  id: string;
  label: string;
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
    tone = 'normal',
  }: {
    id: string;
    label: string;
    tone?: RunFeedTone;
  },
): RunFeedItem[] {
  return trimRunFeed([
    ...items,
    {
      id,
      label,
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
  }: {
    id: string;
    tool: string;
  },
): RunFeedItem[] {
  return trimRunFeed([
    ...items,
    {
      id,
      label: `Running ${tool}...`,
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
    tone = 'normal',
  }: {
    eventId: string;
    tool: string;
    label: string;
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
      status: 'completed',
      tone,
      tool,
    },
  ]);
}
