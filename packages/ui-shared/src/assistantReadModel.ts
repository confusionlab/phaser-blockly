import type {
  AssistantComponent,
  AssistantObject,
  AssistantPhysicsConfig,
  AssistantProjectSnapshot,
  AssistantProjectState,
  AssistantScene,
} from './assistant';
import { summarizeStoredBlocklyLogic } from './assistantLogic';

type LogicCodeMode = 'preview' | 'full';

const TRANSLATION_BLOCK_TYPES = new Set([
  'motion_move_steps',
  'motion_go_to',
  'motion_glide_to',
  'motion_glide_to_speed',
  'motion_change_x',
  'motion_change_y',
  'motion_set_x',
  'motion_set_y',
  'physics_set_velocity',
  'physics_set_velocity_x',
  'physics_set_velocity_y',
]);

function buildModelLogic(
  blocklyXml: string,
  editableWith: 'set_object_logic' | 'set_component_logic',
  logicCodeMode: LogicCodeMode,
  generatedJs?: string,
) {
  const fullEditableWith =
    editableWith === 'set_component_logic'
      ? ('set_component_block_program' as const)
      : ('set_object_block_program' as const);
  const exactEditableWith =
    editableWith === 'set_component_logic'
      ? 'get_component_block_tree + edit_component_block_tree'
      : 'get_object_block_tree + edit_object_block_tree';
  const logic = summarizeStoredBlocklyLogic(
    blocklyXml,
    editableWith,
    { codeMode: logicCodeMode },
  );

  if (!generatedJs?.trim()) {
    return {
      ...logic,
      fullEditableWith,
      exactEditableWith,
      generatedCode: undefined,
      generatedCodeTruncated: undefined,
    };
  }

  return {
    ...logic,
    fullEditableWith,
    exactEditableWith,
    generatedCode: generatedJs,
    generatedCodeTruncated: false,
  };
}

function hasConfiguredVelocity(physics: AssistantPhysicsConfig | null): boolean {
  if (!physics?.enabled) {
    return false;
  }

  return physics.velocityX !== 0 || physics.velocityY !== 0;
}

function buildMotionSummary(
  blockTypes: readonly string[],
  physics: AssistantPhysicsConfig | null,
) {
  const isTranslating = blockTypes.some((blockType) => TRANSLATION_BLOCK_TYPES.has(blockType));

  return {
    isMoving: isTranslating || hasConfiguredVelocity(physics),
  };
}

function summarizeObjectForModel(object: AssistantObject, logicCodeMode: LogicCodeMode) {
  const logic = buildModelLogic(
    object.blocklyXml,
    object.componentId ? 'set_component_logic' : 'set_object_logic',
    logicCodeMode,
    object.generatedJs,
  );

  return {
    id: object.id,
    name: object.name,
    x: object.x,
    y: object.y,
    scaleX: object.scaleX,
    scaleY: object.scaleY,
    rotation: object.rotation,
    visible: object.visible,
    parentId: object.parentId,
    order: object.order,
    componentId: object.componentId ?? null,
    physics: object.physics,
    collider: object.collider,
    motion: buildMotionSummary(logic.blockTypes, object.physics),
    costumes: object.costumes,
    currentCostumeIndex: object.currentCostumeIndex,
    sounds: object.sounds,
    localVariables: object.localVariables,
    logic,
  };
}

function summarizeComponentForModel(component: AssistantComponent, logicCodeMode: LogicCodeMode) {
  const logic = buildModelLogic(component.blocklyXml, 'set_component_logic', logicCodeMode, component.generatedJs);

  return {
    id: component.id,
    name: component.name,
    motion: buildMotionSummary(logic.blockTypes, component.physics),
    physics: component.physics,
    collider: component.collider,
    costumes: component.costumes,
    currentCostumeIndex: component.currentCostumeIndex,
    sounds: component.sounds,
    localVariables: component.localVariables,
    logic,
  };
}

function summarizeSceneForModel(scene: AssistantScene, logicCodeMode: LogicCodeMode) {
  return {
    id: scene.id,
    name: scene.name,
    order: scene.order,
    background: scene.background,
    cameraConfig: scene.cameraConfig,
    ground: scene.ground ?? null,
    objectFolders: scene.objectFolders,
    objects: scene.objects.map((object) => summarizeObjectForModel(object, logicCodeMode)),
  };
}

export function buildAssistantModelState(state: AssistantProjectState) {
  return {
    project: state.project,
    settings: state.settings,
    scenes: state.scenes.map((scene) => summarizeSceneForModel(scene, 'preview')),
    components: state.components.map((component) => summarizeComponentForModel(component, 'preview')),
    globalVariables: state.globalVariables,
    messages: state.messages,
  };
}

export function buildAssistantModelSnapshot(snapshot: AssistantProjectSnapshot) {
  return {
    snapshotId: snapshot.snapshotId,
    projectId: snapshot.projectId,
    projectVersion: snapshot.projectVersion,
    normalizedAtIso: snapshot.normalizedAtIso,
    focusSceneId: snapshot.focusSceneId ?? null,
    state: buildAssistantModelState(snapshot.state),
  };
}

export function buildAssistantModelScene(scene: AssistantScene) {
  return summarizeSceneForModel(scene, 'preview');
}

export function buildAssistantModelObject(object: AssistantObject) {
  return summarizeObjectForModel(object, 'full');
}

export function buildAssistantModelComponent(component: AssistantComponent) {
  return summarizeComponentForModel(component, 'full');
}
