import { expect, test } from '@playwright/test';
import {
  applyAssistantProjectOperations,
  getAssistantFolderSummary,
  listAssistantEntityReferences,
  materializeAssistantOperationIds,
  type AssistantChangeSet,
  validateAssistantProjectState,
} from '../../../packages/ui-shared/src/assistant';
import {
  applyAssistantBlockTreeEdits,
  buildAssistantBlockTree,
} from '../../../packages/ui-shared/src/assistantBlockTree';
import { compileAssistantBlockProgram } from '../../../packages/ui-shared/src/assistantBlocks';
import { normalizeBlocklyXml } from '../../../packages/ui-shared/src/blocklyXml';
import {
  compileAssistantLogicProgram,
  type AssistantLogicProgram,
} from '../../../packages/ui-shared/src/assistantLogic';
import { applyAssistantChangeSetToProject, createAssistantProjectSnapshot } from '../src/lib/assistant/projectState';
import {
  createDefaultColliderConfig,
  createDefaultGameObject,
  createDefaultPhysicsConfig,
  createDefaultProject,
  type ComponentDefinition,
  type Project,
  type Variable,
} from '../src/types';

function buildProjectFixture(): {
  project: Project;
  sceneId: string;
  parentFolderId: string;
  childFolderId: string;
  heroId: string;
  enemyId: string;
  heroVariableId: string;
  componentId: string;
} {
  const project = createDefaultProject('Assistant Fixture');
  const scene = project.scenes[0]!;

  const parentFolderId = 'folder_actors';
  const childFolderId = 'folder_enemies';
  const heroId = 'object_hero';
  const enemyId = 'object_enemy';
  const componentId = 'component_enemy';
  const heroVariableId = 'variable_health';

  scene.objectFolders = [
    {
      id: parentFolderId,
      name: 'Actors',
      parentId: null,
      order: 0,
    },
    {
      id: childFolderId,
      name: 'Enemies',
      parentId: parentFolderId,
      order: 0,
    },
  ];

  const heroVariable: Variable = {
    id: heroVariableId,
    name: 'health',
    type: 'number',
    defaultValue: 100,
    scope: 'local',
    objectId: heroId,
  };

  const hero = createDefaultGameObject('Hero');
  hero.id = heroId;
  hero.parentId = parentFolderId;
  hero.order = 0;
  hero.x = 120;
  hero.y = 220;
  hero.localVariables = [heroVariable];
  hero.blocklyXml = `
    <xml xmlns="https://developers.google.com/blockly/xml">
      <block type="typed_variable_set">
        <field name="VAR">${heroVariableId}</field>
      </block>
    </xml>
  `.trim();

  const enemy = createDefaultGameObject('Enemy');
  enemy.id = enemyId;
  enemy.parentId = childFolderId;
  enemy.order = 0;
  enemy.componentId = componentId;
  enemy.localVariables = [];

  scene.objects = [hero, enemy];
  scene.cameraConfig.followTarget = hero.id;

  const component: ComponentDefinition = {
    id: componentId,
    name: 'EnemyComponent',
    blocklyXml: '<xml><block type="logic_compare" /></xml>',
    costumes: [],
    currentCostumeIndex: 0,
    physics: {
      enabled: true,
      bodyType: 'dynamic',
      gravityY: 1,
      velocityX: 10,
      velocityY: -20,
      bounce: 0.3,
      friction: 0.2,
      allowRotation: false,
    },
    collider: {
      type: 'circle',
      offsetX: 0,
      offsetY: 0,
      width: 32,
      height: 32,
      radius: 16,
    },
    sounds: [],
    localVariables: [],
  };

  project.components = [component];

  return {
    project,
    sceneId: scene.id,
    parentFolderId,
    childFolderId,
    heroId,
    enemyId,
    heroVariableId,
    componentId,
  };
}

test.describe('Assistant tool curation primitives', () => {
  test('getAssistantFolderSummary reports only direct children for a folder', () => {
    const fixture = buildProjectFixture();
    const snapshot = createAssistantProjectSnapshot(fixture.project);

    const summary = getAssistantFolderSummary(snapshot.state, fixture.sceneId, fixture.parentFolderId);

    expect(summary.scene.id).toBe(fixture.sceneId);
    expect(summary.folder.id).toBe(fixture.parentFolderId);
    expect(summary.parentFolder).toBeNull();
    expect(summary.childFolders.map((folder) => folder.id)).toEqual([fixture.childFolderId]);
    expect(summary.childObjects.map((object) => object.id)).toEqual([fixture.heroId]);
  });

  test('listAssistantEntityReferences exposes scoped direct references without overlap', () => {
    const fixture = buildProjectFixture();
    const snapshot = createAssistantProjectSnapshot(fixture.project);

    const heroReferences = listAssistantEntityReferences(
      snapshot.state,
      'object',
      fixture.heroId,
      fixture.sceneId,
    );
    expect(heroReferences.references.map((reference) => reference.relation).sort()).toEqual([
      'object_in_folder',
      'object_in_scene',
      'scene_camera_follows_object',
    ]);

    const componentReferences = listAssistantEntityReferences(
      snapshot.state,
      'component',
      fixture.componentId,
    );
    expect(componentReferences.references).toEqual([
      expect.objectContaining({
        relation: 'component_used_by_object',
        sceneId: fixture.sceneId,
        objectId: fixture.enemyId,
      }),
    ]);
  });

  test('duplicate_object clones an object while remapping local variable ids', () => {
    const fixture = buildProjectFixture();
    const snapshot = createAssistantProjectSnapshot(fixture.project);

    const result = applyAssistantProjectOperations(snapshot.state, [
      {
        kind: 'duplicate_object',
        sceneId: fixture.sceneId,
        objectId: fixture.heroId,
      },
    ]);

    expect(result.issues).toEqual([]);
    expect(result.createdEntities).toHaveLength(1);
    expect(result.createdEntities[0]?.type).toBe('object');

    const nextScene = result.state.scenes.find((scene) => scene.id === fixture.sceneId);
    expect(nextScene).toBeTruthy();

    const duplicate = nextScene?.objects.find((object) => object.id === result.createdEntities[0]?.id);
    const original = nextScene?.objects.find((object) => object.id === fixture.heroId);

    expect(duplicate).toBeTruthy();
    expect(original).toBeTruthy();
    expect(duplicate?.name).toBe('Hero Copy');
    expect(duplicate?.parentId).toBe(original?.parentId);
    expect(duplicate?.x).toBe((original?.x ?? 0) + 50);
    expect(duplicate?.y).toBe((original?.y ?? 0) + 50);
    expect(duplicate?.localVariables).toHaveLength(1);
    expect(duplicate?.localVariables[0]?.id).not.toBe(fixture.heroVariableId);
    expect(duplicate?.blocklyXml).toContain(duplicate?.localVariables[0]?.id ?? '');
    expect(duplicate?.blocklyXml).not.toContain(`>${fixture.heroVariableId}<`);
  });

  test('materializeAssistantOperationIds assigns stable ids for chained writes', () => {
    const createdScene = materializeAssistantOperationIds({
      kind: 'create_scene',
      name: 'Battle Arena',
    });
    const createdFolder = materializeAssistantOperationIds({
      kind: 'create_folder',
      sceneId: 'scene_existing',
      name: 'Actors',
    });
    const createdObject = materializeAssistantOperationIds({
      kind: 'create_object',
      sceneId: 'scene_existing',
      name: 'XYZ',
    });
    const duplicatedObject = materializeAssistantOperationIds({
      kind: 'duplicate_object',
      sceneId: 'scene_existing',
      objectId: 'object_hero',
    });
    const createdComponent = materializeAssistantOperationIds({
      kind: 'make_component',
      sceneId: 'scene_existing',
      objectId: 'object_hero',
    });
    const componentInstance = materializeAssistantOperationIds({
      kind: 'add_component_instance',
      sceneId: 'scene_existing',
      componentId: 'component_enemy',
    });

    expect(createdScene.kind).toBe('create_scene');
    expect(createdScene.sceneId).toMatch(/^scene_/);
    expect(createdFolder.kind).toBe('create_folder');
    expect(createdFolder.folderId).toMatch(/^folder_/);
    expect(createdObject.kind).toBe('create_object');
    expect(createdObject.objectId).toMatch(/^object_/);
    expect(duplicatedObject.kind).toBe('duplicate_object');
    expect(duplicatedObject.duplicateObjectId).toMatch(/^object_/);
    expect(createdComponent.kind).toBe('make_component');
    expect(createdComponent.componentId).toMatch(/^component_/);
    expect(componentInstance.kind).toBe('add_component_instance');
    expect(componentInstance.objectId).toMatch(/^object_/);
  });

  test('make_component and add_component_instance support reusable component flows', () => {
    const fixture = buildProjectFixture();
    const snapshot = createAssistantProjectSnapshot(fixture.project);
    const heroComponentId = 'component_hero';
    const heroInstanceId = 'object_hero_spawn';

    const result = applyAssistantProjectOperations(snapshot.state, [
      {
        kind: 'make_component',
        sceneId: fixture.sceneId,
        objectId: fixture.heroId,
        componentId: heroComponentId,
      },
      {
        kind: 'add_component_instance',
        sceneId: fixture.sceneId,
        componentId: heroComponentId,
        objectId: heroInstanceId,
        properties: { x: 260, y: 180, name: 'Hero Spawn' },
      },
    ]);

    expect(result.issues).toEqual([]);
    expect(result.createdEntities).toEqual([
      { type: 'component', id: heroComponentId, name: 'Hero' },
      { type: 'object', id: heroInstanceId, name: 'Hero Spawn' },
    ]);

    const nextScene = result.state.scenes.find((scene) => scene.id === fixture.sceneId);
    const originalHero = nextScene?.objects.find((object) => object.id === fixture.heroId);
    const heroInstance = nextScene?.objects.find((object) => object.id === heroInstanceId);
    const heroComponent = result.state.components.find((component) => component.id === heroComponentId);

    expect(heroComponent?.name).toBe('Hero');
    expect(heroComponent?.blocklyXml).toContain('typed_variable_set');
    expect(originalHero?.componentId).toBe(heroComponentId);
    expect(heroInstance?.componentId).toBe(heroComponentId);
    expect(heroInstance?.name).toBe('Hero Spawn');
    expect(heroInstance?.x).toBe(260);
    expect(heroInstance?.y).toBe(180);
  });

  test('delete_component detaches instances and preserves component-backed fields', () => {
    const fixture = buildProjectFixture();
    const snapshot = createAssistantProjectSnapshot(fixture.project);

    const result = applyAssistantProjectOperations(snapshot.state, [
      {
        kind: 'delete_component',
        componentId: fixture.componentId,
      },
    ]);

    expect(result.issues).toEqual([]);
    expect(result.state.components).toEqual([]);

    const nextScene = result.state.scenes.find((scene) => scene.id === fixture.sceneId);
    const enemy = nextScene?.objects.find((object) => object.id === fixture.enemyId);

    expect(enemy?.componentId).toBeUndefined();
    expect(enemy?.blocklyXml).toBe('<xml><block type="logic_compare" /></xml>');
    expect(enemy?.physics).toEqual({
      enabled: true,
      bodyType: 'dynamic',
      gravityY: 1,
      velocityX: 10,
      velocityY: -20,
      bounce: 0.3,
      friction: 0.2,
      allowRotation: false,
    });
    expect(enemy?.collider).toEqual({
      type: 'circle',
      offsetX: 0,
      offsetY: 0,
      width: 32,
      height: 32,
      radius: 16,
    });
  });

  test('assistant object property updates can preserve remembered physics settings while disabled', () => {
    const fixture = buildProjectFixture();
    const snapshot = createAssistantProjectSnapshot(fixture.project);
    const rememberedPhysics = {
      ...createDefaultPhysicsConfig(),
      bounce: 0.55,
    };
    const rememberedCollider = createDefaultColliderConfig('box');

    const withPhysics = applyAssistantProjectOperations(snapshot.state, [
      {
        kind: 'update_object_properties',
        sceneId: fixture.sceneId,
        objectId: fixture.heroId,
        properties: {
          physics: rememberedPhysics,
          collider: rememberedCollider,
        },
      },
    ]);

    const nextScene = withPhysics.state.scenes.find((scene) => scene.id === fixture.sceneId);
    const heroWithPhysics = nextScene?.objects.find((object) => object.id === fixture.heroId);
    expect(heroWithPhysics?.physics).toEqual(rememberedPhysics);
    expect(heroWithPhysics?.collider).toEqual(rememberedCollider);

    const disabledPhysics = applyAssistantProjectOperations(withPhysics.state, [
      {
        kind: 'update_object_properties',
        sceneId: fixture.sceneId,
        objectId: fixture.heroId,
        properties: {
          physics: {
            ...rememberedPhysics,
            enabled: false,
          },
        },
      },
    ]);

    const disabledScene = disabledPhysics.state.scenes.find((scene) => scene.id === fixture.sceneId);
    const heroWithRememberedPhysics = disabledScene?.objects.find((object) => object.id === fixture.heroId);
    expect(heroWithRememberedPhysics?.physics).toEqual({
      ...rememberedPhysics,
      enabled: false,
    });
    expect(heroWithRememberedPhysics?.collider).toEqual(rememberedCollider);
  });

  test('applyAssistantChangeSetToProject can preserve remembered component physics settings while disabled', () => {
    const fixture = buildProjectFixture();
    const snapshot = createAssistantProjectSnapshot(fixture.project);
    const rememberedPhysics = {
      ...fixture.project.components[0]!.physics!,
      enabled: false,
    };
    const rememberedCollider = createDefaultColliderConfig('capsule');

    const changeSet: AssistantChangeSet = {
      baseProjectId: fixture.project.id,
      baseProjectVersion: snapshot.projectVersion,
      operations: [
        {
          kind: 'update_component_properties',
          componentId: fixture.componentId,
          properties: {
            physics: rememberedPhysics,
            collider: rememberedCollider,
          },
        },
      ],
      summary: 'Disable enemy component physics but keep settings',
      affectedEntityIds: [fixture.componentId],
    };

    const nextProject = applyAssistantChangeSetToProject(fixture.project, changeSet);
    const enemyComponent = nextProject.components.find((component) => component.id === fixture.componentId);
    const nextScene = nextProject.scenes.find((scene) => scene.id === fixture.sceneId);
    const enemy = nextScene?.objects.find((object) => object.id === fixture.enemyId);

    expect(enemyComponent?.physics).toEqual(rememberedPhysics);
    expect(enemyComponent?.collider).toEqual(rememberedCollider);
    expect(enemy?.physics).toEqual(rememberedPhysics);
    expect(enemy?.collider).toEqual(rememberedCollider);
  });

  test('assistant blockly writes normalize common alias block types', () => {
    const fixture = buildProjectFixture();
    const snapshot = createAssistantProjectSnapshot(fixture.project);
    const aliasBlocklyXml = `
      <xml xmlns="https://developers.google.com/blockly/xml">
        <block type="controls_forever">
          <statement name="SUBSTACK">
            <block type="keyboard_is_key_pressed">
              <field name="KEY_OPTION">SPACE</field>
            </block>
          </statement>
        </block>
      </xml>
    `.trim();

    const expectedBlocklyXml = normalizeBlocklyXml(aliasBlocklyXml);

    const result = applyAssistantProjectOperations(snapshot.state, [
      {
        kind: 'set_object_blockly_xml',
        sceneId: fixture.sceneId,
        objectId: fixture.heroId,
        blocklyXml: aliasBlocklyXml,
      },
    ]);

    const scene = result.state.scenes.find((candidate) => candidate.id === fixture.sceneId);
    const hero = scene?.objects.find((candidate) => candidate.id === fixture.heroId);

    expect(hero?.blocklyXml).toBe(expectedBlocklyXml);
  });

  test('set_object_logic compiles typed logic into canonical Blockly XML', () => {
    const fixture = buildProjectFixture();
    const snapshot = createAssistantProjectSnapshot(fixture.project);
    const logic: AssistantLogicProgram = {
      formatVersion: 1,
      scripts: [
        {
          trigger: { kind: 'forever' },
          actions: [
            { kind: 'set_velocity_x', value: 0 },
            {
              kind: 'if',
              condition: { kind: 'key_pressed', key: 'a' },
              thenActions: [{ kind: 'set_velocity_x', value: -150 }],
            },
            {
              kind: 'if',
              condition: { kind: 'key_pressed', key: 'd' },
              thenActions: [{ kind: 'set_velocity_x', value: 150 }],
            },
            {
              kind: 'if',
              condition: {
                kind: 'all',
                conditions: [
                  { kind: 'key_pressed', key: 'w' },
                  { kind: 'touching_ground' },
                ],
              },
              thenActions: [{ kind: 'set_velocity_y', value: -400 }],
            },
          ],
        },
      ],
    };

    const result = applyAssistantProjectOperations(snapshot.state, [
      {
        kind: 'set_object_logic',
        sceneId: fixture.sceneId,
        objectId: fixture.heroId,
        logic,
      },
    ]);

    const scene = result.state.scenes.find((candidate) => candidate.id === fixture.sceneId);
    const hero = scene?.objects.find((candidate) => candidate.id === fixture.heroId);

    expect(hero?.blocklyXml).toBe(normalizeBlocklyXml(compileAssistantLogicProgram(logic)));
    expect(hero?.blocklyXml).toContain('event_game_start');
    expect(hero?.blocklyXml).toContain('event_forever');
    expect(hero?.blocklyXml).toContain('physics_set_velocity_x');
    expect(hero?.blocklyXml).toContain('sensing_touching_direction');
  });

  test('applyAssistantChangeSetToProject supports duplicate_object end to end', () => {
    const fixture = buildProjectFixture();
    const snapshot = createAssistantProjectSnapshot(fixture.project);

    const changeSet: AssistantChangeSet = {
      baseProjectId: fixture.project.id,
      baseProjectVersion: snapshot.projectVersion,
      operations: [
        {
          kind: 'duplicate_object',
          sceneId: fixture.sceneId,
          objectId: fixture.heroId,
        },
      ],
      summary: 'Duplicated Hero',
      affectedEntityIds: [fixture.sceneId, fixture.heroId],
    };

    const nextProject = applyAssistantChangeSetToProject(fixture.project, changeSet);
    const nextScene = nextProject.scenes.find((scene) => scene.id === fixture.sceneId);
    const duplicates = nextScene?.objects.filter((object) => object.name === 'Hero Copy') ?? [];

    expect(duplicates).toHaveLength(1);
    expect(duplicates[0]?.localVariables[0]?.id).not.toBe(fixture.heroVariableId);
    expect(duplicates[0]?.blocklyXml).toContain(duplicates[0]?.localVariables[0]?.id ?? '');
  });

  test('applyAssistantChangeSetToProject preserves chained ids across scene, folder, and object creation', () => {
    const fixture = buildProjectFixture();
    const snapshot = createAssistantProjectSnapshot(fixture.project);
    const createdSceneId = 'scene_battle_arena';
    const createdFolderId = 'folder_actors';
    const createdObjectId = 'object_xyz';

    const changeSet: AssistantChangeSet = {
      baseProjectId: fixture.project.id,
      baseProjectVersion: snapshot.projectVersion,
      operations: [
        {
          kind: 'create_scene',
          sceneId: createdSceneId,
          name: 'Battle Arena',
        },
        {
          kind: 'create_folder',
          sceneId: createdSceneId,
          folderId: createdFolderId,
          name: 'Actors',
        },
        {
          kind: 'create_object',
          sceneId: createdSceneId,
          objectId: createdObjectId,
          parentId: createdFolderId,
          name: 'XYZ',
          properties: { x: 180, y: 220 },
        },
        {
          kind: 'rename_scene',
          sceneId: fixture.sceneId,
          name: 'Intro Playground',
        },
      ],
      summary: 'Created Battle Arena with Actors/XYZ and renamed Scene 1',
      affectedEntityIds: [fixture.sceneId, createdSceneId, createdFolderId, createdObjectId],
    };

    const nextProject = applyAssistantChangeSetToProject(fixture.project, changeSet);
    const introScene = nextProject.scenes.find((scene) => scene.id === fixture.sceneId);
    const battleArena = nextProject.scenes.find((scene) => scene.id === createdSceneId);
    const folder = battleArena?.objectFolders.find((candidate) => candidate.id === createdFolderId);
    const object = battleArena?.objects.find((candidate) => candidate.id === createdObjectId);

    expect(introScene?.name).toBe('Intro Playground');
    expect(battleArena?.name).toBe('Battle Arena');
    expect(folder?.name).toBe('Actors');
    expect(object?.name).toBe('XYZ');
    expect(object?.parentId).toBe(createdFolderId);
    expect(object?.x).toBe(180);
    expect(object?.y).toBe(220);
  });

  test('applyAssistantChangeSetToProject supports explicit ids for create-and-edit chains', () => {
    const fixture = buildProjectFixture();
    const snapshot = createAssistantProjectSnapshot(fixture.project);
    const sceneId = 'scene_penguin';
    const objectId = 'object_penguin';
    const blocklyXml = `
      <xml xmlns="https://developers.google.com/blockly/xml">
        <block type="controls_forever">
          <statement name="SUBSTACK">
            <block type="keyboard_is_key_pressed">
              <field name="KEY_OPTION">W</field>
            </block>
          </statement>
        </block>
      </xml>
    `.trim();

    const changeSet: AssistantChangeSet = {
      baseProjectId: fixture.project.id,
      baseProjectVersion: snapshot.projectVersion,
      operations: [
        {
          kind: 'create_scene',
          sceneId,
          name: 'penguin',
        },
        {
          kind: 'create_object',
          sceneId,
          objectId,
          name: 'penguin',
        },
        {
          kind: 'set_object_blockly_xml',
          sceneId,
          objectId,
          blocklyXml,
        },
      ],
      summary: 'Created penguin scene and object with movement logic',
      affectedEntityIds: [sceneId, objectId],
    };

    const nextProject = applyAssistantChangeSetToProject(fixture.project, changeSet);
    const penguinScene = nextProject.scenes.find((scene) => scene.id === sceneId);
    const penguinObject = penguinScene?.objects.find((object) => object.id === objectId);

    expect(penguinScene?.name).toBe('penguin');
    expect(penguinObject?.name).toBe('penguin');
    expect(penguinObject?.blocklyXml).toBe(normalizeBlocklyXml(blocklyXml));
  });

  test('applyAssistantChangeSetToProject supports follow-up edits on a duplicated object', () => {
    const fixture = buildProjectFixture();
    const snapshot = createAssistantProjectSnapshot(fixture.project);
    const duplicateObjectId = 'object_hero_support';

    const changeSet: AssistantChangeSet = {
      baseProjectId: fixture.project.id,
      baseProjectVersion: snapshot.projectVersion,
      operations: [
        {
          kind: 'duplicate_object',
          sceneId: fixture.sceneId,
          objectId: fixture.heroId,
          duplicateObjectId,
        },
        {
          kind: 'rename_object',
          sceneId: fixture.sceneId,
          objectId: duplicateObjectId,
          name: 'Hero Support',
        },
        {
          kind: 'update_object_properties',
          sceneId: fixture.sceneId,
          objectId: duplicateObjectId,
          properties: { x: 260, y: 220 },
        },
      ],
      summary: 'Duplicated Hero into Hero Support',
      affectedEntityIds: [fixture.sceneId, fixture.heroId, duplicateObjectId],
    };

    const nextProject = applyAssistantChangeSetToProject(fixture.project, changeSet);
    const nextScene = nextProject.scenes.find((scene) => scene.id === fixture.sceneId);
    const duplicate = nextScene?.objects.find((object) => object.id === duplicateObjectId);

    expect(duplicate?.name).toBe('Hero Support');
    expect(duplicate?.x).toBe(260);
    expect(duplicate?.y).toBe(220);
    expect(duplicate?.localVariables[0]?.id).not.toBe(fixture.heroVariableId);
  });

  test('applyAssistantChangeSetToProject supports component lifecycle actions and syncs component edits to instances', () => {
    const fixture = buildProjectFixture();
    const snapshot = createAssistantProjectSnapshot(fixture.project);
    const heroComponentId = 'component_hero';
    const heroInstanceId = 'object_hero_spawn';
    const blocklyXml = '<xml><block type="controls_if" /></xml>';

    const changeSet: AssistantChangeSet = {
      baseProjectId: fixture.project.id,
      baseProjectVersion: snapshot.projectVersion,
      operations: [
        {
          kind: 'make_component',
          sceneId: fixture.sceneId,
          objectId: fixture.heroId,
          componentId: heroComponentId,
        },
        {
          kind: 'add_component_instance',
          sceneId: fixture.sceneId,
          componentId: heroComponentId,
          objectId: heroInstanceId,
          properties: { x: 300, y: 140 },
        },
        {
          kind: 'rename_component',
          componentId: heroComponentId,
          name: 'Hero Template',
        },
        {
          kind: 'set_component_blockly_xml',
          componentId: heroComponentId,
          blocklyXml,
        },
        {
          kind: 'detach_from_component',
          sceneId: fixture.sceneId,
          objectId: heroInstanceId,
        },
      ],
      summary: 'Created a hero component, added an instance, synced edits, and detached one instance',
      affectedEntityIds: [fixture.sceneId, fixture.heroId, heroComponentId, heroInstanceId],
    };

    const nextProject = applyAssistantChangeSetToProject(fixture.project, changeSet);
    const nextScene = nextProject.scenes.find((scene) => scene.id === fixture.sceneId);
    const originalHero = nextScene?.objects.find((object) => object.id === fixture.heroId);
    const heroInstance = nextScene?.objects.find((object) => object.id === heroInstanceId);
    const heroComponent = nextProject.components.find((component) => component.id === heroComponentId);

    expect(heroComponent?.name).toBe('Hero Template');
    expect(heroComponent?.blocklyXml).toBe(blocklyXml);
    expect(originalHero?.componentId).toBe(heroComponentId);
    expect(originalHero?.name).toBe('Hero Template');
    expect(originalHero?.blocklyXml).toBe(blocklyXml);
    expect(heroInstance?.componentId).toBeUndefined();
    expect(heroInstance?.name).toBe('Hero Template');
    expect(heroInstance?.blocklyXml).toBe(blocklyXml);
    expect(heroInstance?.x).toBe(300);
    expect(heroInstance?.y).toBe(140);
  });

  test('set_component_logic updates the component and synced instances', () => {
    const fixture = buildProjectFixture();
    const snapshot = createAssistantProjectSnapshot(fixture.project);
    const logic: AssistantLogicProgram = {
      formatVersion: 1,
      scripts: [
        {
          trigger: { kind: 'on_key_pressed', key: 'space' },
          actions: [
            { kind: 'wait', seconds: 0.1 },
            { kind: 'broadcast', message: 'jumped', wait: true },
          ],
        },
      ],
    };

    const result = applyAssistantProjectOperations(snapshot.state, [
      {
        kind: 'set_component_logic',
        componentId: fixture.componentId,
        logic,
      },
    ]);

    const component = result.state.components.find((candidate) => candidate.id === fixture.componentId);
    const scene = result.state.scenes.find((candidate) => candidate.id === fixture.sceneId);
    const enemy = scene?.objects.find((candidate) => candidate.id === fixture.enemyId);

    expect(component?.blocklyXml).toBe(normalizeBlocklyXml(compileAssistantLogicProgram(logic)));
    expect(enemy?.blocklyXml).toBe(component?.blocklyXml);
    expect(component?.blocklyXml).toContain('event_key_pressed');
    expect(component?.blocklyXml).toContain('control_broadcast_wait');
  });

  test('compileAssistantBlockProgram rejects missing required block fields', () => {
    expect(() =>
      compileAssistantBlockProgram({
        formatVersion: 1,
        blocks: [
          {
            type: 'typed_variable_set',
            values: {
              VALUE: {
                type: 'math_number',
                fields: { NUM: 10 },
              },
            },
          },
        ],
      }),
    ).toThrow(/fields\.VAR is required/);
  });

  test('compileAssistantBlockProgram accepts control_switch_scene MODE field', () => {
    const fixture = buildProjectFixture();

    expect(() =>
      compileAssistantBlockProgram({
        formatVersion: 1,
        blocks: [
          {
            type: 'control_switch_scene',
            fields: {
              SCENE: fixture.sceneId,
              MODE: 'RESTART',
            },
          },
        ],
      }),
    ).not.toThrow();
  });

  test('block tree reads exact existing structure and supports targeted inserts without rebuilding neighbors', () => {
    const variableId = 'variable_score';
    const soundId = 'sound_merge';
    const blocklyXml = `
      <xml xmlns="https://developers.google.com/blockly/xml">
        <block type="event_game_start">
          <statement name="NEXT">
            <block type="sound_play">
              <field name="SOUND">${soundId}</field>
              <next>
                <block type="looks_next_costume">
                  <next>
                    <block type="typed_variable_set">
                      <field name="VAR">${variableId}</field>
                      <value name="VALUE">
                        <block type="math_number">
                          <field name="NUM">5</field>
                        </block>
                      </value>
                    </block>
                  </next>
                </block>
              </next>
            </block>
          </statement>
        </block>
      </xml>
    `.trim();

    const tree = buildAssistantBlockTree(blocklyXml);
    expect(tree.roots[0]?.statements.NEXT[0]?.type).toBe('sound_play');
    expect(tree.roots[0]?.statements.NEXT[0]?.fields.SOUND).toBe(soundId);
    expect(tree.roots[0]?.statements.NEXT[0]?.next?.path).toBe('roots[0].statements.NEXT[0].next');
    expect(tree.roots[0]?.statements.NEXT[0]?.next?.type).toBe('looks_next_costume');
    expect(tree.roots[0]?.statements.NEXT[0]?.next?.next?.type).toBe('typed_variable_set');
    expect(tree.roots[0]?.statements.NEXT[0]?.next?.next?.fields.VAR).toBe(variableId);

    const editedXml = applyAssistantBlockTreeEdits(blocklyXml, [
      {
        kind: 'insert_after',
        path: 'roots[0].statements.NEXT[0].next',
        block: {
          type: 'looks_change_size',
          values: {
            SIZE: {
              type: 'math_number',
              fields: { NUM: 10 },
            },
          },
        },
      },
    ]);

    const editedTree = buildAssistantBlockTree(editedXml);
    const insertedBlock = editedTree.roots[0]?.statements.NEXT[0]?.next?.next;
    expect(insertedBlock?.type).toBe('looks_change_size');
    expect(insertedBlock?.values.SIZE?.type).toBe('math_number');
    expect(insertedBlock?.values.SIZE?.fields.NUM).toBe('10');
    expect(insertedBlock?.next?.type).toBe('typed_variable_set');
    expect(insertedBlock?.next?.fields.VAR).toBe(variableId);
  });

  test('block tree edits accept control_switch_scene MODE field', () => {
    const fixture = buildProjectFixture();
    const blocklyXml = `
      <xml xmlns="https://developers.google.com/blockly/xml">
        <block type="event_game_start">
          <statement name="NEXT">
            <block type="typed_variable_set">
              <field name="VAR">${fixture.heroVariableId}</field>
              <value name="VALUE">
                <block type="math_number">
                  <field name="NUM">1</field>
                </block>
              </value>
            </block>
          </statement>
        </block>
      </xml>
    `.trim();

    const editedXml = applyAssistantBlockTreeEdits(blocklyXml, [
      {
        kind: 'insert_after',
        path: 'roots[0].statements.NEXT[0]',
        block: {
          type: 'control_switch_scene',
          fields: {
            SCENE: fixture.sceneId,
            MODE: 'RESUME',
          },
        },
      },
    ]);

    const editedTree = buildAssistantBlockTree(editedXml);
    const insertedBlock = editedTree.roots[0]?.statements.NEXT[0]?.next;
    expect(insertedBlock?.type).toBe('control_switch_scene');
    expect(insertedBlock?.fields.SCENE).toBe(fixture.sceneId);
    expect(insertedBlock?.fields.MODE).toBe('RESUME');
  });

  test('applyAssistantProjectOperations rejects invalid component Blockly references introduced by a write', () => {
    const fixture = buildProjectFixture();
    const snapshot = createAssistantProjectSnapshot(fixture.project);

    const result = applyAssistantProjectOperations(snapshot.state, [
      {
        kind: 'set_component_blockly_xml',
        componentId: fixture.componentId,
        blocklyXml: `
          <xml xmlns="https://developers.google.com/blockly/xml">
            <block type="event_game_start">
              <statement name="NEXT">
                <block type="typed_variable_set">
                  <value name="VALUE">
                    <block type="math_number">
                      <field name="NUM">10</field>
                    </block>
                  </value>
                  <next>
                    <block type="control_switch_scene">
                      <field name="MODE">RESUME</field>
                    </block>
                  </next>
                </block>
              </statement>
            </block>
          </xml>
        `.trim(),
      },
    ]);

    expect(result.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'component.invalid_blockly_reference',
          entityIds: [fixture.componentId],
        }),
      ]),
    );
  });

  test('validateAssistantProjectState rejects unrecoverable Blockly XML', () => {
    const fixture = buildProjectFixture();
    const scene = fixture.project.scenes.find((candidate) => candidate.id === fixture.sceneId)!;
    const hero = scene.objects.find((candidate) => candidate.id === fixture.heroId)!;
    hero.blocklyXml = 'not xml at all';

    const snapshot = createAssistantProjectSnapshot(fixture.project);
    const issues = validateAssistantProjectState(snapshot.state);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'object.invalid_blockly_xml',
          entityIds: [fixture.sceneId, fixture.heroId],
        }),
      ]),
    );
  });

  test('validateAssistantProjectState rejects unsupported generic Blockly block types', () => {
    const fixture = buildProjectFixture();
    const scene = fixture.project.scenes.find((candidate) => candidate.id === fixture.sceneId)!;
    const hero = scene.objects.find((candidate) => candidate.id === fixture.heroId)!;
    hero.blocklyXml = `
      <xml xmlns="https://developers.google.com/blockly/xml">
        <block type="keyboard_keyPressed"></block>
      </xml>
    `.trim();

    const snapshot = createAssistantProjectSnapshot(fixture.project);
    const issues = validateAssistantProjectState(snapshot.state);

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'object.unsupported_blockly_block_types',
          entityIds: [fixture.sceneId, fixture.heroId],
        }),
      ]),
    );
  });
});
