import { expect, test } from '@playwright/test';
import {
  appendCompletedRunFeedItem,
  finishToolRunFeedItem,
  startToolRunFeedItem,
} from '../src/lib/assistant/runFeed';

test.describe('Assistant run feed', () => {
  test('replaces a running tool entry with its completed state', () => {
    const started = startToolRunFeedItem([], {
      id: 'evt-start',
      tool: 'create_object',
    });

    const completed = finishToolRunFeedItem(started, {
      eventId: 'evt-finish',
      tool: 'create_object',
      label: 'create_object: object: Crate',
    });

    expect(completed).toEqual([
      {
        id: 'evt-start',
        label: 'create_object: object: Crate',
        status: 'completed',
        tone: 'normal',
        tool: 'create_object',
      },
    ]);
  });

  test('appends a completed tool entry when no matching running row exists', () => {
    const items = appendCompletedRunFeedItem([], {
      id: 'evt-context',
      label: 'Context prepared.',
    });

    const completed = finishToolRunFeedItem(items, {
      eventId: 'evt-finish',
      tool: 'rename_object',
      label: 'rename_object: Affected 1 item(s).',
      tone: 'warning',
    });

    expect(completed).toEqual([
      {
        id: 'evt-context',
        label: 'Context prepared.',
        status: 'completed',
        tone: 'normal',
      },
      {
        id: 'evt-finish',
        label: 'rename_object: Affected 1 item(s).',
        status: 'completed',
        tone: 'warning',
        tool: 'rename_object',
      },
    ]);
  });
});
