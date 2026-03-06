import { expect, test } from '@playwright/test';
import {
  createAssistantProjectSnapshot,
  createAssistantProjectVersion,
} from '../src/lib/assistant/projectState';
import { createDefaultGameObject, createDefaultProject } from '../src/types';
import { buildAssistantRunInputText } from '../../../packages/ui-shared/src/assistantConversation';
import { buildAssistantModelSnapshot } from '../../../packages/ui-shared/src/assistantReadModel';

test.describe('assistant model snapshot', () => {
  test('createAssistantProjectVersion matches the snapshot version without building prompt state', () => {
    const project = createDefaultProject('Version Fixture');
    const projectVersion = createAssistantProjectVersion(project);
    const snapshot = createAssistantProjectSnapshot(project);

    expect(projectVersion).toBe(snapshot.projectVersion);
  });

  test('createAssistantProjectSnapshot redacts asset payloads and buildAssistantModelSnapshot exposes readable logic projections', () => {
    const project = createDefaultProject('Snapshot Fixture');
    const scene = project.scenes[0]!;
    const hero = createDefaultGameObject('Hero');
    const costumeAsset = 'data:image/png;base64,COSTUME_PAYLOAD_SHOULD_NOT_LEAK';
    const soundAsset = 'data:audio/wav;base64,SOUND_PAYLOAD_SHOULD_NOT_LEAK';
    const backgroundAsset = 'data:image/png;base64,BACKGROUND_PAYLOAD_SHOULD_NOT_LEAK';

    hero.costumes = [
      {
        id: 'costume_hero_pose',
        name: 'Hero Pose',
        assetId: costumeAsset,
      },
    ];
    hero.sounds = [
      {
        id: 'sound_jump',
        name: 'Jump',
        assetId: soundAsset,
        trimStart: 0.1,
        trimEnd: 0.9,
        duration: 1.2,
      },
    ];
    hero.blocklyXml = `
      <xml xmlns="https://developers.google.com/blockly/xml">
        <block type="event_game_start"></block>
      </xml>
    `.trim();
    scene.objects = [hero];
    scene.background = {
      type: 'image',
      value: backgroundAsset,
      scrollFactor: { x: 0.5, y: 1 },
    };

    const snapshot = createAssistantProjectSnapshot(project);
    snapshot.state.scenes[0]!.objects[0]!.generatedJs = [
      '(function(runtime, spriteId, sprite) {',
      'runtime.onGameStart(spriteId, async function(sprite) {',
      '});',
      '})',
    ].join('\n');
    const snapshotJson = JSON.stringify(snapshot);
    const modelSnapshot = buildAssistantModelSnapshot(snapshot);
    const sceneModel = modelSnapshot.state.scenes[0]!;
    const objectModel = sceneModel.objects[0]!;

    expect(snapshotJson).not.toContain(costumeAsset);
    expect(snapshotJson).not.toContain(soundAsset);
    expect(snapshotJson).not.toContain(backgroundAsset);
    expect(JSON.stringify(modelSnapshot)).not.toContain('blocklyXml');
    expect(JSON.stringify(modelSnapshot)).not.toContain('assetId');
    expect(JSON.stringify(modelSnapshot)).not.toContain('spriteAssetId');
    expect(sceneModel.background).toEqual({
      type: 'image',
      hasAsset: true,
      scrollFactor: { x: 0.5, y: 1 },
    });
    expect(objectModel.costumes).toEqual([
      {
        id: 'costume_hero_pose',
        name: 'Hero Pose',
      },
    ]);
    expect(objectModel.sounds).toEqual([
      {
        id: 'sound_jump',
        name: 'Jump',
        trimStart: 0.1,
        trimEnd: 0.9,
        duration: 1.2,
      },
    ]);
    expect(objectModel.logic.hasLogic).toBe(true);
    expect(objectModel.logic.editableWith).toBe('set_object_logic');
    expect(objectModel.logic.blockTypes).toEqual(['event_game_start']);
    expect(objectModel.logic.generatedCode).toContain('runtime.onGameStart');
    expect(objectModel.logic.generatedCodeTruncated).toBe(false);
  });

  test('buildAssistantRunInputText uses the sanitized snapshot', () => {
    const project = createDefaultProject('Prompt Fixture');
    const scene = project.scenes[0]!;
    const hero = createDefaultGameObject('Hero');
    hero.blocklyXml = '<xml><block type="event_forever"></block></xml>';
    hero.sounds = [
      {
        id: 'sound_prompt',
        name: 'Prompt Sound',
        assetId: 'data:audio/wav;base64,PROMPT_SOUND_SHOULD_NOT_LEAK',
      },
    ];
    scene.objects = [hero];

    const snapshot = createAssistantProjectSnapshot(project);
    snapshot.state.scenes[0]!.objects[0]!.generatedJs = [
      '(function(runtime, spriteId, sprite) {',
      'runtime.forever(sprite.id, async function(sprite) {',
      '});',
      '})',
    ].join('\n');
    const prompt = buildAssistantRunInputText({
      mode: 'mutate',
      requestText: 'Add jump controls',
      snapshot,
      conversationHistory: [],
    });

    expect(prompt).toContain('Project snapshot (sanitized, readable):');
    expect(prompt).toContain('Project overview: scenes=1 objects=1 components=0');
    expect(prompt).toContain('Active scene:');
    expect(prompt).toContain('Standalone objects: Hero');
    expect(prompt).toContain('Logic owners in active scene:');
    expect(prompt).toContain('Additional context can be fetched with tools: get_scene, get_object, get_component, search_blocks, get_block_details');
    expect(prompt).not.toContain('Available blocks (compact catalog):');
    expect(prompt).not.toContain('blocklyXml');
    expect(prompt).not.toContain('data:image');
    expect(prompt).not.toContain('data:audio');
    expect(prompt).not.toContain('assetId');
    expect(prompt).not.toContain('spriteAssetId');
    expect(prompt).toContain('Project: "Prompt Fixture"');
    expect(prompt).toContain('Generated JS:');
    expect(prompt).toContain('runtime.forever');
  });
});
