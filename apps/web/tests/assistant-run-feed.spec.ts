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
      detail: 'sceneId=scene_penguin | objectId=object_penguin | name=\"penguin\"',
    });

    const completed = finishToolRunFeedItem(started, {
      eventId: 'evt-finish',
      tool: 'create_object',
      label: 'create_object: object: Crate',
      detail: 'object:object_penguin',
    });

    expect(completed).toEqual([
      {
        id: 'evt-start',
        label: 'create_object: object: Crate',
        detail: 'object:object_penguin',
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
      detail: 'sceneId=scene_penguin | objectId=object_penguin',
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
        detail: 'sceneId=scene_penguin | objectId=object_penguin',
        status: 'completed',
        tone: 'warning',
        tool: 'rename_object',
      },
    ]);
  });
});
