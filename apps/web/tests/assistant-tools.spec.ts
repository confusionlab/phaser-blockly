import { expect, test } from '@playwright/test';
import {
  applyAssistantProjectOperations,
  getAssistantFolderSummary,
  listAssistantEntityReferences,
  materializeAssistantOperationIds,
  type AssistantChangeSet,
} from '../../../packages/ui-shared/src/assistant';
import { applyAssistantChangeSetToProject, createAssistantProjectSnapshot } from '../src/lib/assistant/projectState';
import {
  createDefaultGameObject,
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
    type: 'integer',
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
});
