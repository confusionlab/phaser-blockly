import { expect, test } from '@playwright/test';
import { validateSemanticOpsPayload } from '../src/lib/llm/semanticOps';

test.describe('LLM semantic op payload validation', () => {
  test('accepts valid payload', () => {
    const payload = {
      intentSummary: 'When game starts, move right.',
      assumptions: ['Object has at least one sound.'],
      semanticOps: [
        {
          op: 'create_event_flow',
          event: 'event_game_start',
          actions: [
            {
              action: 'motion_change_x',
              inputs: { VALUE: 10 },
            },
          ],
        },
      ],
    };

    const result = validateSemanticOpsPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.semanticOps).toHaveLength(1);
      expect(result.value.semanticOps[0].op).toBe('create_event_flow');
    }
  });

  test('rejects unsupported operations', () => {
    const payload = {
      intentSummary: 'Bad op',
      assumptions: [],
      semanticOps: [
        {
          op: 'wire_raw_socket',
        },
      ],
    };

    const result = validateSemanticOpsPayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('unsupported op');
    }
  });

  test('rejects malformed action payloads', () => {
    const payload = {
      intentSummary: 'Malformed',
      assumptions: [],
      semanticOps: [
        {
          op: 'append_actions',
          flowSelector: {
            eventType: 'event_game_start',
          },
          actions: [
            {
              action: 'motion_change_x',
              inputs: {
                VALUE: {
                  block: '',
                },
              },
            },
          ],
        },
      ],
    };

    const result = validateSemanticOpsPayload(payload);
    expect(result.ok).toBe(false);
  });

  test('accepts valid projectOps payload', () => {
    const payload = {
      intentSummary: 'Rename project and create a scene',
      assumptions: [],
      projectOps: [
        {
          op: 'rename_project',
          name: 'Arcade Demo',
        },
        {
          op: 'create_scene',
          name: 'Stage 2',
        },
      ],
    };

    const result = validateSemanticOpsPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.projectOps).toHaveLength(2);
      expect(result.value.projectOps[0].op).toBe('rename_project');
      expect(result.value.semanticOps).toHaveLength(0);
    }
  });

  test('rejects payloads with neither semanticOps nor projectOps', () => {
    const payload = {
      intentSummary: 'Do something',
      assumptions: [],
    };

    const result = validateSemanticOpsPayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('semanticOps or projectOps');
    }
  });
});
