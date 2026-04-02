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

  test('toolbox visibility filtering hides advanced flyout blocks without removing supported block types', async () => {
    installToolboxTestGlobals();
    const { getToolboxConfig, getToolboxRegisteredBlockTypes } = await import('../src/components/blockly/toolbox');

    const allToolboxTypes = getToolboxRegisteredBlockTypes();
    const basicToolboxTypes = getToolboxRegisteredBlockTypes({ includeAdvancedBlocks: false });
    const advancedToolbox = getToolboxConfig({ includeAdvancedBlocks: true });
    const basicToolbox = getToolboxConfig({ includeAdvancedBlocks: false });
    const sensingCategory = advancedToolbox.contents.find((category) => category.name === 'Sensing');
    const debugCategory = basicToolbox.contents.find((category) => category.name === 'Debug');
    const targetsCategory = basicToolbox.contents.find((category) => category.name === 'Targets');

    expect(allToolboxTypes).toContain('debug_console_log');
    expect(allToolboxTypes).toContain('control_group_block');
    expect(allToolboxTypes).toContain('target_camera');
    expect(allToolboxTypes).toContain('operator_mathop');
    expect(allToolboxTypes).toContain('looks_speak');
    expect(allToolboxTypes).toContain('sensing_all_touching_objects');
    expect(allToolboxTypes).toContain('sensing_touching_direction_value');
    expect(allToolboxTypes).toContain('event_when_touching_direction_value');
    expect(allToolboxTypes).toContain('physics_set_bounce');
    expect(allToolboxTypes).toContain('physics_set_friction');
    expect(basicToolboxTypes).not.toContain('debug_console_log');
    expect(basicToolboxTypes).not.toContain('control_group_block');
    expect(basicToolboxTypes).not.toContain('target_camera');
    expect(basicToolboxTypes).not.toContain('operator_mathop');
    expect(basicToolboxTypes).not.toContain('operator_mod');
    expect(basicToolboxTypes).not.toContain('physics_set_bounce');
    expect(basicToolboxTypes).not.toContain('physics_set_friction');
    expect(basicToolboxTypes).not.toContain('looks_speak');
    expect(basicToolboxTypes).not.toContain('looks_stop_speaking');
    expect(basicToolboxTypes).not.toContain('looks_target_speak');
    expect(basicToolboxTypes).not.toContain('looks_target_stop_speaking');
    expect(basicToolboxTypes).not.toContain('sensing_all_touching_objects');
    expect(basicToolboxTypes).not.toContain('sensing_touching_direction_value');
    expect(basicToolboxTypes).not.toContain('event_when_touching_direction_value');
    expect(sensingCategory?.contents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'label', text: 'Targets' }),
        expect.objectContaining({ kind: 'block', type: 'object_from_dropdown' }),
        expect.objectContaining({ kind: 'block', type: 'target_camera' }),
        expect.objectContaining({ kind: 'block', type: 'target_myself' }),
        expect.objectContaining({ kind: 'block', type: 'target_mouse' }),
        expect.objectContaining({ kind: 'block', type: 'target_ground' }),
      ]),
    );
    expect(debugCategory).toBeUndefined();
    expect(targetsCategory).toBeUndefined();
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

  test('looks speak generates a keep-speaking sprite speech call', async () => {
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

    expect(code).toContain('sprite.keepSpeaking(');
    expect(code).toContain('Hello bubble');
  });

  test('move towards generates an instant move toward x/y coordinates', async () => {
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
    const moveTowards = workspace.newBlock('motion_move_towards');
    const x = workspace.newBlock('math_number');
    const y = workspace.newBlock('math_number');
    const steps = workspace.newBlock('math_number');
    x.setFieldValue('120', 'NUM');
    y.setFieldValue('-40', 'NUM');
    steps.setFieldValue('25', 'NUM');
    moveTowards.getInput('X')?.connection?.connect(x.outputConnection);
    moveTowards.getInput('Y')?.connection?.connect(y.outputConnection);
    moveTowards.getInput('STEPS')?.connection?.connect(steps.outputConnection);

    const code = javascriptGenerator.workspaceToCode(workspace);
    workspace.dispose();

    expect(code).toContain('sprite.moveTowards(120, (-40), 25);');
  });

  test('speech-and-stop blocks generate awaited speech sessions', async () => {
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

    const speakAndStop = workspace.newBlock('looks_speak_and_stop');
    const text = workspace.newBlock('text');
    text.setFieldValue('Auto stop bubble', 'TEXT');
    speakAndStop.getInput('TEXT')?.connection?.connect(text.outputConnection);

    const targetSpeakAndStop = workspace.newBlock('looks_target_speak_and_stop');
    const target = workspace.newBlock('object_from_dropdown');
    const targetText = workspace.newBlock('text');
    target.setFieldValue('hero-id', 'TARGET');
    targetText.setFieldValue('Target auto stop bubble', 'TEXT');
    targetSpeakAndStop.getInput('TARGET')?.connection?.connect(target.outputConnection);
    targetSpeakAndStop.getInput('TEXT')?.connection?.connect(targetText.outputConnection);

    const code = javascriptGenerator.workspaceToCode(workspace);
    workspace.dispose();

    expect(code).toContain('await sprite.speakAndStop(');
    expect(code).toContain('await __targetSprite.speakAndStop(');
  });

  test('legacy timed speech block ids still compile to auto-stop speech sessions', async () => {
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
    const legacySpeakFor = workspace.newBlock('looks_speak_for_seconds');
    const text = workspace.newBlock('text');
    text.setFieldValue('Legacy bubble', 'TEXT');
    legacySpeakFor.getInput('TEXT')?.connection?.connect(text.outputConnection);

    const code = javascriptGenerator.workspaceToCode(workspace);
    workspace.dispose();

    expect(code).toContain('await sprite.speakAndStop(');
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

    expect(code).toContain('runtime.getSprite(__targetId)?.keepSpeaking(');
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
    expect(xml).toContain('<next>');
    expect(xml).toContain('<block type="looks_change_axis_scale">');
    expect(xml).toContain('<field name="AXIS">VERTICAL</field>');
    expect(xml).toContain('<block type="math_number">');
  });

  test('uses next-connections for one-shot event hats and keeps forever as a C-block', async () => {
    installToolboxTestGlobals();
    const Blockly = await import('blockly');
    await import('../src/components/blockly/toolbox');

    const workspace = new Blockly.Workspace();
    const onStart = workspace.newBlock('event_game_start');
    const forever = workspace.newBlock('event_forever');

    expect(onStart.previousConnection).toBeNull();
    expect(onStart.nextConnection).not.toBeNull();
    expect(onStart.getInput('NEXT')).toBeNull();

    expect(forever.previousConnection).not.toBeNull();
    expect(forever.nextConnection).toBeNull();
    expect(forever.getInput('DO')).not.toBeNull();

    workspace.dispose();
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
