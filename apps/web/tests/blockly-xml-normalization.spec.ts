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
