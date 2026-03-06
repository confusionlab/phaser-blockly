import { expect, test } from '@playwright/test';
import { createAssistantProjectSnapshot } from '../src/lib/assistant/projectState';
import { createDefaultGameObject, createDefaultProject } from '../src/types';
import { buildAssistantRunInputText } from '../../../packages/ui-shared/src/assistantConversation';
import { buildAssistantModelSnapshot } from '../../../packages/ui-shared/src/assistantReadModel';

test.describe('assistant model snapshot', () => {
  test('buildAssistantModelSnapshot strips raw Blockly XML and exposes logic summary', () => {
    const project = createDefaultProject('Snapshot Fixture');
    const scene = project.scenes[0]!;
    const hero = createDefaultGameObject('Hero');
    hero.blocklyXml = `
      <xml xmlns="https://developers.google.com/blockly/xml">
        <block type="event_game_start"></block>
      </xml>
    `.trim();
    scene.objects = [hero];

    const snapshot = createAssistantProjectSnapshot(project);
    const modelSnapshot = buildAssistantModelSnapshot(snapshot);
    const sceneModel = modelSnapshot.state.scenes[0]!;
    const objectModel = sceneModel.objects[0]!;

    expect(JSON.stringify(modelSnapshot)).not.toContain('blocklyXml');
    expect(objectModel.logic.hasLogic).toBe(true);
    expect(objectModel.logic.editableWith).toBe('set_object_logic');
    expect(objectModel.logic.blockTypes).toEqual(['event_game_start']);
  });

  test('buildAssistantRunInputText uses the sanitized snapshot', () => {
    const project = createDefaultProject('Prompt Fixture');
    const scene = project.scenes[0]!;
    const hero = createDefaultGameObject('Hero');
    hero.blocklyXml = '<xml><block type="event_forever"></block></xml>';
    scene.objects = [hero];

    const snapshot = createAssistantProjectSnapshot(project);
    const prompt = buildAssistantRunInputText({
      mode: 'mutate',
      requestText: 'Add jump controls',
      snapshot,
      conversationHistory: [],
    });

    expect(prompt).toContain('Sanitized project snapshot JSON');
    expect(prompt).not.toContain('blocklyXml');
    expect(prompt).toContain('Stored Blockly logic');
  });
});
