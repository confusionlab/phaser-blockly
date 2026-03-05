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

  test('accepts all supported semantic ops in one payload', () => {
    const payload = {
      intentSummary: 'Cover every semantic op',
      assumptions: [],
      semanticOps: [
        {
          op: 'create_event_flow',
          event: 'event_game_start',
          fields: { KEY: 'SPACE' },
          actions: [{ action: 'motion_change_x', inputs: { VALUE: 10 } }],
          index: 0,
        },
        {
          op: 'append_actions',
          flowSelector: {
            eventType: 'event_game_start',
            eventFieldEquals: { KEY: 'SPACE' },
            index: 0,
          },
          actions: [{ action: 'motion_change_y', inputs: { VALUE: -5 } }],
        },
        {
          op: 'replace_action',
          targetBlockId: 'block-1',
          action: { action: 'motion_set_x', inputs: { VALUE: 12 } },
        },
        {
          op: 'set_block_field',
          targetBlockId: 'block-2',
          field: 'TARGET',
          value: 'enemy-1',
        },
        {
          op: 'ensure_variable',
          scope: 'global',
          name: 'score',
          variableType: 'integer',
          defaultValue: 0,
        },
        {
          op: 'ensure_message',
          name: 'spawn_enemy',
        },
        {
          op: 'retarget_reference',
          referenceKind: 'object',
          from: 'old-target',
          to: 'new-target',
        },
        {
          op: 'delete_subtree',
          targetBlockId: 'block-3',
        },
      ],
    };

    const result = validateSemanticOpsPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.semanticOps).toHaveLength(8);
      expect(result.value.projectOps).toHaveLength(0);
    }
  });

  test('accepts all supported project ops in one payload', () => {
    const payload = {
      intentSummary: 'Cover every project op',
      assumptions: [],
      projectOps: [
        { op: 'rename_project', name: 'Arcade' },
        { op: 'create_scene', name: 'Boss' },
        { op: 'rename_scene', sceneId: 'scene-1', name: 'Arena' },
        { op: 'reorder_scenes', sceneIds: ['scene-2', 'scene-1'] },
        { op: 'create_object', sceneId: 'scene-1', name: 'Coin', x: 120, y: 240 },
        { op: 'rename_object', sceneId: 'scene-1', objectId: 'obj-1', name: 'Player' },
        { op: 'set_object_property', sceneId: 'scene-1', objectId: 'obj-1', property: 'visible', value: false },
        {
          op: 'set_object_physics',
          sceneId: 'scene-1',
          objectId: 'obj-1',
          physics: {
            enabled: true,
            bodyType: 'dynamic',
            gravityY: 1,
            velocityX: 0,
            velocityY: 0,
            bounce: 0.2,
            friction: 0.1,
            allowRotation: false,
          },
        },
        { op: 'set_object_collider_type', sceneId: 'scene-1', objectId: 'obj-1', colliderType: 'circle' },
        { op: 'create_folder', sceneId: 'scene-1', name: 'Enemies', parentId: null },
        { op: 'rename_folder', sceneId: 'scene-1', folderId: 'folder-1', name: 'Bosses' },
        { op: 'move_object_to_folder', sceneId: 'scene-1', objectId: 'obj-1', folderId: 'folder-1' },
        {
          op: 'add_costume_from_image_url',
          sceneId: 'scene-1',
          objectId: 'obj-1',
          name: 'sprite',
          imageUrl: 'https://example.com/sprite.png',
        },
        {
          op: 'add_costume_text_circle',
          sceneId: 'scene-1',
          objectId: 'obj-1',
          name: 'label',
          text: 'GO',
          fillColor: '#00ff00',
          textColor: '#111111',
        },
        { op: 'rename_costume', sceneId: 'scene-1', objectId: 'obj-1', costumeId: 'costume-1', name: 'idle' },
        { op: 'reorder_costumes', sceneId: 'scene-1', objectId: 'obj-1', costumeIds: ['costume-2', 'costume-1'] },
        { op: 'set_current_costume', sceneId: 'scene-1', objectId: 'obj-1', costumeId: 'costume-2' },
        { op: 'validate_project' },
      ],
    };

    const result = validateSemanticOpsPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.projectOps).toHaveLength(18);
      expect(result.value.semanticOps).toHaveLength(0);
    }
  });

  test('accepts common model-style alias fields', () => {
    const payload = {
      intentSummary: 'Alias shape payload',
      assumptions: [],
      semanticOps: [
        {
          type: 'create_event_flow',
          eventType: 'event_game_start',
          actions: [{ type: 'motion_change_x', inputs: { VALUE: 10 } }],
        },
        {
          op: 'append_actions',
          eventBlockId: 'event-1',
          actions: [{ blockType: 'motion_change_y', inputs: { VALUE: { shadow: { type: 'math_number', fields: { NUM: -5 } } } } }],
        },
        {
          op: 'replace_action',
          targetBlockId: 'action-1',
          action: { type: 'motion_set_x', inputs: { VALUE: 20 } },
        },
        {
          op: 'set_block_field',
          blockId: 'event-1',
          field: 'KEY',
          value: 'SPACE',
        },
        {
          op: 'delete_subtree',
          blockId: 'action-1',
        },
      ],
      projectOps: [
        {
          type: 'rename_scene',
          sceneId: 'scene-1',
          name: 'Arena',
        },
        {
          type: 'rename_object',
          sceneId: 'scene-1',
          objectId: 'obj-1',
          name: 'Hero',
        },
        {
          type: 'set_current_costume',
          sceneId: 'scene-1',
          objectId: 'obj-1',
          costumeId: 'costume-1',
        },
      ],
    };

    const result = validateSemanticOpsPayload(payload);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.semanticOps[0].op).toBe('create_event_flow');
      expect(result.value.semanticOps[1].op).toBe('append_actions');
      expect(result.value.semanticOps[1].flowSelector.eventBlockId).toBe('event-1');
      expect(result.value.semanticOps[3].op).toBe('set_block_field');
      expect(result.value.semanticOps[3].targetBlockId).toBe('event-1');
      expect(result.value.semanticOps[4].op).toBe('delete_subtree');
      expect(result.value.semanticOps[4].targetBlockId).toBe('action-1');
      expect(result.value.projectOps[0].op).toBe('rename_scene');
      expect(result.value.projectOps[1].op).toBe('rename_object');
      expect(result.value.projectOps[2].op).toBe('set_current_costume');
    }
  });

  test('rejects project op payloads with invalid field types', () => {
    const payload = {
      intentSummary: 'bad payload',
      assumptions: [],
      projectOps: [
        {
          op: 'set_object_property',
          sceneId: 'scene-1',
          objectId: 'obj-1',
          property: 'visible',
          value: { invalid: true },
        },
      ],
    };

    const result = validateSemanticOpsPayload(payload);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.join('\n')).toContain('projectOps[0].value');
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
