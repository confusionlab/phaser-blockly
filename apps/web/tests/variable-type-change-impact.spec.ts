import { expect, test } from '@playwright/test';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';
import { createDefaultGameObject, createDefaultProject } from '../src/types';

function installBrowserShims() {
  const globals = globalThis as typeof globalThis & {
    __APP_VERSION__?: string;
    DOMParser?: typeof DOMParser;
    XMLSerializer?: typeof XMLSerializer;
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

  const storage = globals.localStorage ?? {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
  };

  globals.__APP_VERSION__ = globals.__APP_VERSION__ ?? 'test-version';
  globals.DOMParser = DOMParser;
  globals.XMLSerializer = XMLSerializer;
  globals.localStorage = storage;
  const document = new DOMParser().parseFromString('<xml></xml>', 'text/xml') as unknown as Document & {
    documentElement: Document['documentElement'] & {
      classList?: {
        toggle: (className: string, force?: boolean) => void;
      };
    };
  };
  document.documentElement.classList = {
    toggle: () => undefined,
  };
  globals.document = document;
  globals.window = {
    localStorage: storage,
    matchMedia: () => ({ matches: false }),
  };
}

test.describe('variable type change impact', () => {
  test('reports incompatible blocks before changing a variable kind', async () => {
    installBrowserShims();
    const { getVariableTypeChangeImpact } = await import('../src/lib/variableTypeChangeImpact');

    const project = createDefaultProject('Variable Kind Impact');
    const variableId = crypto.randomUUID();
    project.globalVariables = [{
      id: variableId,
      name: 'score',
      type: 'number',
      cardinality: 'single',
      defaultValue: 0,
      scope: 'global',
    }];

    const object = createDefaultGameObject('Player');
    object.blocklyXml = `<xml xmlns="https://developers.google.com/blockly/xml"><block type="typed_variable_change" id="change-block"><field name="VAR">${variableId}</field><value name="DELTA"><block type="math_number" id="delta"><field name="NUM">1</field></block></value></block><block type="typed_variable_set" id="set-block" x="0" y="80"><field name="VAR">${variableId}</field><value name="VALUE"><block type="math_arithmetic" id="math-block"><field name="OP">ADD</field><value name="A"><block type="typed_variable_get" id="get-block"><field name="VAR">${variableId}</field></block></value><value name="B"><block type="math_number" id="math-value"><field name="NUM">1</field></block></value></block></value></block></xml>`;
    project.scenes[0]!.objects = [object];

    const impact = getVariableTypeChangeImpact(project, project.globalVariables[0]!, {
      type: 'string',
      cardinality: 'array',
    });

    expect(impact.referenceCount).toBe(3);
    expect(impact.incompatibleBlockCount).toBe(3);
    expect(impact.usages).toEqual([
      expect.objectContaining({
        title: 'Player',
        subtitle: 'Scene 1',
        blockCount: 3,
      }),
    ]);
    expect(impact.usages[0]?.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        blockType: 'typed_variable_change',
        message: 'This block only works with single number variables.',
      }),
      expect.objectContaining({
        blockType: 'typed_variable_set',
        message: 'The connected value no longer matches Text Array.',
      }),
      expect.objectContaining({
        blockType: 'typed_variable_get',
        message: 'This output no longer matches the connected input (now Text Array).',
      }),
    ]));
  });

  test('play validation reports variable type compatibility issues', async () => {
    installBrowserShims();
    const { validateProjectBeforePlay } = await import('../src/lib/playValidation');

    const project = createDefaultProject('Variable Compatibility Validation');
    const variableId = crypto.randomUUID();
    project.globalVariables = [{
      id: variableId,
      name: 'flag',
      type: 'string',
      cardinality: 'single',
      defaultValue: '',
      scope: 'global',
    }];

    const object = createDefaultGameObject('Player');
    object.blocklyXml = `<xml xmlns="https://developers.google.com/blockly/xml"><block type="typed_variable_change" id="change-block"><field name="VAR">${variableId}</field><value name="DELTA"><block type="math_number" id="delta"><field name="NUM">1</field></block></value></block></xml>`;
    project.scenes[0]!.objects = [object];

    const issues = validateProjectBeforePlay(project);

    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        objectName: 'Player',
        blockType: 'typed_variable_change',
        message: 'This block only works with single number variables.',
      }),
    ]));
  });
});
