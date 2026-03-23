import { expect, test } from '@playwright/test';
import { createAssistantProjectSnapshot } from '../src/lib/assistant/projectState';
import { createDefaultGameObject, createDefaultProject } from '../src/types';
import {
  formatAssistantModelObjectDetail,
  formatAssistantMutationResult,
  formatAssistantToolError,
} from '../../../packages/ui-shared/src/assistantModelText';
import { buildAssistantModelObject } from '../../../packages/ui-shared/src/assistantReadModel';

test.describe('assistant model text', () => {
  test('formats object detail as readable text instead of raw JSON', () => {
    const project = createDefaultProject('Text Fixture');
    const hero = createDefaultGameObject('Hero');
    hero.blocklyXml = '<xml><block type="event_forever"></block></xml>';
    project.scenes[0]!.objects = [hero];
    const snapshot = createAssistantProjectSnapshot(project);
    const snapshotHero = snapshot.state.scenes[0]!.objects[0]!;
    snapshotHero.generatedJs = [
      '(function(runtime, spriteId, sprite) {',
      'runtime.forever(sprite.id, async function(sprite) {',
      '});',
      '})',
    ].join('\n');

    const text = formatAssistantModelObjectDetail({
      ...buildAssistantModelObject(snapshotHero),
      logicOwner: { type: 'object', objectId: hero.id },
    });

    expect(text).toContain('Object "Hero"');
    expect(text).toContain('Motion: isMoving=false');
    expect(text).toContain('Logic owner: object');
    expect(text).toContain('Generated JS:');
    expect(text).toContain('runtime.forever');
    expect(text).not.toContain('blocklyXml');
    expect(text).not.toContain('"id"');
  });

  test('formats mutation results without dumping operation JSON', () => {
    const project = createDefaultProject('Mutation Fixture');
    const snapshot = createAssistantProjectSnapshot(project);

    const text = formatAssistantMutationResult({
      operation: {
        kind: 'rename_object',
        sceneId: 'scene_game',
        objectId: 'object_hero',
        name: 'Hero',
      },
      createdEntities: [],
      affectedEntityIds: ['scene_game', 'object_hero'],
      validationIssues: [],
      stateSummary: {
        projectId: snapshot.projectId,
        projectName: snapshot.state.project.name,
        sceneCount: snapshot.state.scenes.length,
        objectCount: snapshot.state.scenes.reduce((count, scene) => count + scene.objects.length, 0),
        folderCount: snapshot.state.scenes.reduce((count, scene) => count + scene.objectFolders.length, 0),
        componentCount: snapshot.state.components.length,
        scenes: snapshot.state.scenes.map((scene) => ({
          id: scene.id,
          name: scene.name,
          objectCount: scene.objects.length,
          folderCount: scene.objectFolders.length,
        })),
      },
    });

    expect(text).toContain('Mutation staged successfully: rename_object');
    expect(text).toContain('Affected IDs: scene_game, object_hero');
    expect(text).toContain('Validation issues: none');
    expect(text).not.toContain('"kind"');
  });

  test('formats tool errors without dumping structured detail objects', () => {
    const text = formatAssistantToolError({
      code: 'component_backed_object',
      message: 'Object "hero" is component-backed. Edit the component instead.',
      details: {
        componentId: 'component_player',
        retryable: false,
        nested: { ignored: true },
      },
    });

    expect(text).toContain('Tool error [component_backed_object]');
    expect(text).toContain('Details: componentId=component_player, retryable=false');
    expect(text).not.toContain('"componentId"');
    expect(text).not.toContain('nested');
  });
});
