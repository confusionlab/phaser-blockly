import { expect, test } from '@playwright/test';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import {
  compileAssistantBlockProgram,
  getAssistantBlockCatalog,
  searchAssistantBlocks,
  validateAssistantBlockProgram,
} from '../../../packages/ui-shared/src/assistantBlocks';

function installToolboxTestGlobals(): void {
  const globals = globalThis as {
    __APP_VERSION__?: string;
    localStorage?: { getItem: (key: string) => string | null };
    document?: { documentElement: { classList: { toggle: (className: string, enabled?: boolean) => void } } };
    window?: { matchMedia: (query: string) => { matches: boolean } };
  };
  globals.__APP_VERSION__ = 'test';
  globals.localStorage = { getItem: () => null };
  globals.document = {
    documentElement: {
      classList: {
        toggle: () => undefined,
      },
    },
  };
  globals.window = {
    matchMedia: () => ({ matches: false }),
  };
  const xmlGlobals = globalThis as {
    DOMParser?: typeof DOMParser;
    XMLSerializer?: typeof XMLSerializer;
  };
  xmlGlobals.DOMParser = DOMParser;
  xmlGlobals.XMLSerializer = XMLSerializer;
}

test.describe('assistant block catalog', () => {
  test('stays in sync with the registered toolbox block types', async () => {
    installToolboxTestGlobals();
    const { getToolboxRegisteredBlockTypes } = await import('../src/components/blockly/toolbox');
    const catalogTypes = getAssistantBlockCatalog()
      .map((entry) => entry.type)
      .sort((a, b) => a.localeCompare(b));
    const toolboxTypes = getToolboxRegisteredBlockTypes();

    expect(catalogTypes).toEqual(toolboxTypes);
  });

  test('searches blocks by behavior keywords without full toolbox dump in the tool result', () => {
    const results = searchAssistantBlocks({ query: 'size' }).map((entry) => entry.type);

    expect(results).toContain('looks_change_size');
    expect(results).toContain('looks_change_axis_scale');
    expect(results).toContain('looks_set_size');
  });

  test('camera target composes with generic x/y reporters', async () => {
    installToolboxTestGlobals();
    const Blockly = await import('blockly');
    const { javascriptGenerator } = await import('blockly/javascript');
    await import('../src/components/blockly/toolbox');
    const { registerCodeGenerators } = await import('../src/phaser/CodeGenerator');

    Blockly.utils.xml.injectDependencies({
      document: new DOMParser().parseFromString('<xml></xml>', 'text/xml') as unknown as Document,
      DOMParser,
      XMLSerializer,
    });
    registerCodeGenerators();

    const workspace = new Blockly.Workspace();
    const cameraGoTo = workspace.newBlock('camera_go_to');
    const cameraX = workspace.newBlock('sensing_object_x');
    const cameraXTarget = workspace.newBlock('target_camera');
    const cameraY = workspace.newBlock('sensing_object_y');
    const cameraYTarget = workspace.newBlock('target_camera');

    cameraX.getInput('OBJECT')?.connection?.connect(cameraXTarget.outputConnection);
    cameraY.getInput('OBJECT')?.connection?.connect(cameraYTarget.outputConnection);
    cameraGoTo.getInput('X')?.connection?.connect(cameraX.outputConnection);
    cameraGoTo.getInput('Y')?.connection?.connect(cameraY.outputConnection);

    const code = javascriptGenerator.workspaceToCode(workspace);
    workspace.dispose();
    expect(code).toContain('runtime.cameraGoTo(');
    expect(code).toContain('runtime.getTargetX((runtime.getCameraTarget()))');
    expect(code).toContain('runtime.getTargetY((runtime.getCameraTarget()))');
  });

  test('looks speak generates a sprite speech call', async () => {
    installToolboxTestGlobals();
    const Blockly = await import('blockly');
    const { javascriptGenerator } = await import('blockly/javascript');
    await import('../src/components/blockly/toolbox');
    const { registerCodeGenerators } = await import('../src/phaser/CodeGenerator');

    Blockly.utils.xml.injectDependencies({
      document: new DOMParser().parseFromString('<xml></xml>', 'text/xml') as unknown as Document,
      DOMParser,
      XMLSerializer,
    });
    registerCodeGenerators();

    const workspace = new Blockly.Workspace();
    const speak = workspace.newBlock('looks_speak');
    const text = workspace.newBlock('text');
    text.setFieldValue('Hello bubble', 'TEXT');
    speak.getInput('TEXT')?.connection?.connect(text.outputConnection);

    const code = javascriptGenerator.workspaceToCode(workspace);
    workspace.dispose();

    expect(code).toContain('sprite.speak(');
    expect(code).toContain('Hello bubble');
  });

  test('timed speech blocks generate awaited speech sessions', async () => {
    installToolboxTestGlobals();
    const Blockly = await import('blockly');
    const { javascriptGenerator } = await import('blockly/javascript');
    await import('../src/components/blockly/toolbox');
    const { registerCodeGenerators } = await import('../src/phaser/CodeGenerator');

    Blockly.utils.xml.injectDependencies({
      document: new DOMParser().parseFromString('<xml></xml>', 'text/xml') as unknown as Document,
      DOMParser,
      XMLSerializer,
    });
    registerCodeGenerators();

    const workspace = new Blockly.Workspace();

    const speakFor = workspace.newBlock('looks_speak_for_seconds');
    const text = workspace.newBlock('text');
    const seconds = workspace.newBlock('math_number');
    text.setFieldValue('Timed bubble', 'TEXT');
    seconds.setFieldValue('3', 'NUM');
    speakFor.getInput('TEXT')?.connection?.connect(text.outputConnection);
    speakFor.getInput('SECONDS')?.connection?.connect(seconds.outputConnection);

    const targetSpeakFor = workspace.newBlock('looks_target_speak_for_seconds');
    const target = workspace.newBlock('object_from_dropdown');
    const targetText = workspace.newBlock('text');
    const targetSeconds = workspace.newBlock('math_number');
    target.setFieldValue('hero-id', 'TARGET');
    targetText.setFieldValue('Target timed bubble', 'TEXT');
    targetSeconds.setFieldValue('2', 'NUM');
    targetSpeakFor.getInput('TARGET')?.connection?.connect(target.outputConnection);
    targetSpeakFor.getInput('TEXT')?.connection?.connect(targetText.outputConnection);
    targetSpeakFor.getInput('SECONDS')?.connection?.connect(targetSeconds.outputConnection);

    const code = javascriptGenerator.workspaceToCode(workspace);
    workspace.dispose();

    expect(code).toContain('await sprite.speakFor(');
    expect(code).toContain('await __targetSprite.speakFor(');
  });

  test('targeted speech blocks generate target sprite speech calls', async () => {
    installToolboxTestGlobals();
    const Blockly = await import('blockly');
    const { javascriptGenerator } = await import('blockly/javascript');
    await import('../src/components/blockly/toolbox');
    const { registerCodeGenerators } = await import('../src/phaser/CodeGenerator');

    Blockly.utils.xml.injectDependencies({
      document: new DOMParser().parseFromString('<xml></xml>', 'text/xml') as unknown as Document,
      DOMParser,
      XMLSerializer,
    });
    registerCodeGenerators();

    const workspace = new Blockly.Workspace();
    const speak = workspace.newBlock('looks_target_speak');
    const target = workspace.newBlock('object_from_dropdown');
    const text = workspace.newBlock('text');
    target.setFieldValue('hero-id', 'TARGET');
    text.setFieldValue('Hi there', 'TEXT');
    speak.getInput('TARGET')?.connection?.connect(target.outputConnection);
    speak.getInput('TEXT')?.connection?.connect(text.outputConnection);

    const stop = workspace.newBlock('looks_target_stop_speaking');
    const stopTarget = workspace.newBlock('object_from_dropdown');
    stopTarget.setFieldValue('hero-id', 'TARGET');
    stop.getInput('TARGET')?.connection?.connect(stopTarget.outputConnection);

    const code = javascriptGenerator.workspaceToCode(workspace);
    workspace.dispose();

    expect(code).toContain('runtime.getSprite(__targetId)?.speak(');
    expect(code).toContain('runtime.getSprite(__targetId)?.stopSpeaking()');
  });

  test('compiles typed block programs into Blockly XML', () => {
    const xml = compileAssistantBlockProgram({
      formatVersion: 1,
      blocks: [
        {
          type: 'event_game_start',
          statements: {
            NEXT: [
              {
                type: 'looks_change_axis_scale',
                fields: {
                  AXIS: 'VERTICAL',
                },
                values: {
                  SIZE: {
                    type: 'math_number',
                    fields: {
                      NUM: 10,
                    },
                  },
                },
              },
            ],
          },
        },
      ],
    });

    expect(xml).toContain('<block type="event_game_start">');
    expect(xml).toContain('<statement name="NEXT">');
    expect(xml).toContain('<block type="looks_change_axis_scale">');
    expect(xml).toContain('<field name="AXIS">VERTICAL</field>');
    expect(xml).toContain('<block type="math_number">');
  });

  test('rejects block programs with unsupported connection names', () => {
    const issues = validateAssistantBlockProgram({
      formatVersion: 1,
      blocks: [
        {
          type: 'looks_change_axis_scale',
          fields: {
            AXIS: 'HORIZONTAL',
          },
          values: {
            WRONG: {
              type: 'math_number',
              fields: {
                NUM: 10,
              },
            },
          },
        },
      ],
    });

    expect(issues).toContain('blocks[0].values.WRONG is not valid for block "looks_change_axis_scale".');
  });
});
