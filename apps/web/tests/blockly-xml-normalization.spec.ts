import { expect, test } from '@playwright/test';
import { normalizeBlocklyXml } from '../../../packages/ui-shared/src/blocklyXml';
import { createDefaultGameObject, createDefaultProject } from '../src/types';

const ALIAS_BLOCKLY_XML = `
  <xml xmlns="https://developers.google.com/blockly/xml">
    <block type="controls_forever" id="forever_1" x="24" y="24">
      <statement name="SUBSTACK">
        <block type="controls_if" id="if_1">
          <value name="IF0">
            <block type="keyboard_is_key_pressed" id="key_1">
              <field name="KEY_OPTION">SPACE</field>
            </block>
          </value>
        </block>
      </statement>
    </block>
  </xml>
`.trim();

const MOVEMENT_ALIAS_BLOCKLY_XML = `
  <xml xmlns="https://developers.google.com/blockly/xml">
    <block type="event_whenstart" id="start_1" x="19" y="17">
      <next>
        <block type="event_forever" id="forever_1">
          <statement name="DO">
            <block type="controls_if" id="if_a">
              <value name="IF0">
                <block type="sensing_key_pressed" id="key_a">
                  <field name="KEY">A</field>
                </block>
              </value>
              <statement name="DO0">
                <block type="motion_change_x" id="move_left">
                  <field name="DIR">LEFT</field>
                  <value name="NUM">
                    <block type="math_number" id="num_5_left">
                      <field name="NUM">5</field>
                    </block>
                  </value>
                </block>
              </statement>
            </block>
          </statement>
        </block>
      </next>
    </block>
  </xml>
`.trim();

const DIRECT_FIELD_MOVEMENT_BLOCKLY_XML = `
  <xml xmlns="https://developers.google.com/blockly/xml">
    <block type="motion_change_x" id="move_left" x="12" y="18">
      <field name="DIR">LEFT</field>
      <field name="VALUE">5</field>
    </block>
  </xml>
`.trim();

const LIVE_WASD_ALIAS_BLOCKLY_XML = `
  <xml xmlns="https://developers.google.com/blockly/xml">
    <block type="when_run" deletable="false" movable="false">
      <statement name="STACK">
        <block type="event_forever">
          <statement name="STACK">
            <block type="controls_if_else">
              <value name="IF0">
                <block type="key_pressed">
                  <field name="KEY">w</field>
                </block>
              </value>
              <statement name="DO0">
                <block type="change_y_by">
                  <field name="DELTA">5</field>
                </block>
              </statement>
              <statement name="ELSE">
                <block type="controls_if_else">
                  <value name="IF0">
                    <block type="key_pressed">
                      <field name="KEY">s</field>
                    </block>
                  </value>
                  <statement name="DO0">
                    <block type="change_y_by">
                      <field name="DELTA">-5</field>
                    </block>
                  </statement>
                  <statement name="ELSE">
                    <block type="controls_if_else">
                      <value name="IF0">
                        <block type="key_pressed">
                          <field name="KEY">a</field>
                        </block>
                      </value>
                      <statement name="DO0">
                        <block type="change_x_by">
                          <field name="DELTA">-5</field>
                        </block>
                      </statement>
                      <statement name="ELSE">
                        <block type="controls_if_else">
                          <value name="IF0">
                            <block type="key_pressed">
                              <field name="KEY">d</field>
                            </block>
                          </value>
                          <statement name="DO0">
                            <block type="change_x_by">
                              <field name="DELTA">5</field>
                            </block>
                          </statement>
                        </block>
                      </statement>
                    </block>
                  </statement>
                </block>
              </statement>
            </block>
          </statement>
        </block>
      </statement>
    </block>
  </xml>
`.trim();

test.describe('Blockly XML normalization', () => {
  test('normalizes assistant alias block types to PochaCoding block ids', () => {
    const normalized = normalizeBlocklyXml(ALIAS_BLOCKLY_XML);

    expect(normalized).toContain('type="event_forever"');
    expect(normalized).toContain('statement name="DO"');
    expect(normalized).toContain('type="sensing_key_pressed"');
    expect(normalized).toContain('field name="KEY"');
    expect(normalized).not.toContain('controls_forever');
    expect(normalized).not.toContain('keyboard_is_key_pressed');
  });

  test('play validation accepts normalized alias XML without missing block-type errors', async () => {
    installBrowserShims();
    const { validateProjectBeforePlay } = await import('../src/lib/playValidation');

    const project = createDefaultProject('Blockly Alias Fixture');
    const scene = project.scenes[0]!;
    const object = createDefaultGameObject('Bird');
    object.blocklyXml = ALIAS_BLOCKLY_XML;
    scene.objects = [object];

    const issues = validateProjectBeforePlay(project);

    expect(
      issues.filter((issue) => issue.message.includes('Missing block type')),
    ).toEqual([]);
  });

  test('project store normalizes legacy alias XML on open and update', async () => {
    installBrowserShims();
    const { useProjectStore } = await import('../src/store/projectStore');

    const project = createDefaultProject('Blockly Alias Fixture');
    const scene = project.scenes[0]!;
    const object = createDefaultGameObject('Bird');
    object.blocklyXml = ALIAS_BLOCKLY_XML;
    scene.objects = [object];

    useProjectStore.getState().openProject(project);
    expect(useProjectStore.getState().project?.scenes[0]?.objects[0]?.blocklyXml).toBe(
      normalizeBlocklyXml(ALIAS_BLOCKLY_XML),
    );

    useProjectStore.getState().updateObject(scene.id, object.id, { blocklyXml: ALIAS_BLOCKLY_XML });
    expect(useProjectStore.getState().project?.scenes[0]?.objects[0]?.blocklyXml).toBe(
      normalizeBlocklyXml(ALIAS_BLOCKLY_XML),
    );

    useProjectStore.getState().closeProject();
  });

  test('normalizes event and directional motion aliases from assistant XML', () => {
    const normalized = normalizeBlocklyXml(MOVEMENT_ALIAS_BLOCKLY_XML);

    expect(normalized).toContain('type="event_game_start"');
    expect(normalized).toContain('<value name="VALUE">');
    expect(normalized).toContain('<field name="NUM">-5</field>');
    expect(normalized).not.toContain('<field name="DIR">LEFT</field>');
    expect(normalized).not.toContain('event_whenstart');
    expect(normalized).not.toContain('value name="NUM"');
  });

  test('normalizes legacy physics immovable block ids to make static', () => {
    const normalized = normalizeBlocklyXml(`
      <xml xmlns="https://developers.google.com/blockly/xml">
        <block type="physics_immovable"></block>
      </xml>
    `.trim());

    expect(normalized).toContain('type="physics_make_static"');
    expect(normalized).not.toContain('type="physics_immovable"');
  });

  test('converts direct motion VALUE fields into math_number inputs', () => {
    const normalized = normalizeBlocklyXml(DIRECT_FIELD_MOVEMENT_BLOCKLY_XML);

    expect(normalized).toContain('type="motion_change_x"');
    expect(normalized).toContain('<value name="VALUE"><block type="math_number"><field name="NUM">-5</field></block></value>');
    expect(normalized).not.toContain('<field name="VALUE">5</field>');
    expect(normalized).not.toContain('<field name="DIR">LEFT</field>');
  });

  test('normalizes live assistant WASD alias XML into editor-valid blocks', async () => {
    installBrowserShims();
    const { validateProjectBeforePlay } = await import('../src/lib/playValidation');

    const normalized = normalizeBlocklyXml(LIVE_WASD_ALIAS_BLOCKLY_XML);

    expect(normalized).toContain('type="event_game_start"');
    expect(normalized).toContain('<next>');
    expect(normalized).toContain('type="sensing_key_pressed"');
    expect(normalized).toContain('type="motion_change_y"');
    expect(normalized).toContain('type="motion_change_x"');
    expect(normalized).toContain('<mutation else="1"></mutation>');
    expect(normalized).toContain('<field name="KEY">W</field>');
    expect(normalized).toContain('<field name="KEY">S</field>');
    expect(normalized).toContain('<field name="KEY">A</field>');
    expect(normalized).toContain('<field name="KEY">D</field>');
    expect(normalized).toContain('<value name="VALUE"><block type="math_number"><field name="NUM">5</field></block></value>');
    expect(normalized).toContain('<value name="VALUE"><block type="math_number"><field name="NUM">-5</field></block></value>');
    expect(normalized).not.toContain('when_run');
    expect(normalized).not.toContain('type="key_pressed"');
    expect(normalized).not.toContain('type="change_y_by"');
    expect(normalized).not.toContain('type="controls_if_else"');

    const project = createDefaultProject('Live Assistant Alias Fixture');
    const scene = project.scenes[0]!;
    const object = createDefaultGameObject('Penguin');
    object.blocklyXml = LIVE_WASD_ALIAS_BLOCKLY_XML;
    scene.objects = [object];

    const issues = validateProjectBeforePlay(project);

    expect(
      issues.filter((issue) => issue.message.includes('Missing block type')),
    ).toEqual([]);
  });

  test('migrates legacy hat statement bodies onto Blockly next connections', () => {
    const normalized = normalizeBlocklyXml(`
      <xml xmlns="https://developers.google.com/blockly/xml">
        <block type="event_game_start">
          <statement name="NEXT">
            <block type="looks_show"></block>
          </statement>
        </block>
      </xml>
    `.trim());

    expect(normalized).toContain('<block type="event_game_start">');
    expect(normalized).toContain('<next>');
    expect(normalized).toContain('<block type="looks_show">');
    expect(normalized).not.toContain('<statement name="NEXT">');
  });

});

function installBrowserShims() {
  const globalWithAppVersion = globalThis as typeof globalThis & {
    __APP_VERSION__?: string;
    localStorage?: {
      getItem: (key: string) => string | null;
      setItem: (key: string, value: string) => void;
      removeItem: (key: string) => void;
    };
    document?: {
      documentElement: {
        classList: {
          toggle: (className: string, force?: boolean) => void;
        };
      };
    };
    window?: {
      localStorage: {
        getItem: (key: string) => string | null;
        setItem: (key: string, value: string) => void;
        removeItem: (key: string) => void;
      };
      matchMedia: (query: string) => { matches: boolean };
    };
  };

  const storage = globalWithAppVersion.localStorage ?? {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };

  globalWithAppVersion.__APP_VERSION__ = 'test';
  globalWithAppVersion.localStorage = storage;
  globalWithAppVersion.document = globalWithAppVersion.document ?? {
    documentElement: {
      classList: {
        toggle: () => undefined,
      },
    },
  };
  globalWithAppVersion.window = globalWithAppVersion.window ?? {
    localStorage: storage,
    matchMedia: () => ({ matches: false }),
  };
}
