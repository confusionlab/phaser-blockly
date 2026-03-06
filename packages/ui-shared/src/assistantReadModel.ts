import type {
  AssistantComponent,
  AssistantObject,
  AssistantProjectSnapshot,
  AssistantProjectState,
  AssistantScene,
} from './assistant';
import { summarizeStoredBlocklyLogic } from './assistantLogic';

function summarizeObjectForModel(object: AssistantObject) {
  return {
    id: object.id,
    name: object.name,
    spriteAssetId: object.spriteAssetId,
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
    costumes: object.costumes,
    currentCostumeIndex: object.currentCostumeIndex,
    sounds: object.sounds,
    localVariables: object.localVariables,
    logic: summarizeStoredBlocklyLogic(
      object.blocklyXml,
      object.componentId ? 'set_component_logic' : 'set_object_logic',
    ),
  };
}

function summarizeComponentForModel(component: AssistantComponent) {
  return {
    id: component.id,
    name: component.name,
    physics: component.physics,
    collider: component.collider,
    costumes: component.costumes,
    currentCostumeIndex: component.currentCostumeIndex,
    sounds: component.sounds,
    localVariables: component.localVariables,
    logic: summarizeStoredBlocklyLogic(component.blocklyXml, 'set_component_logic'),
  };
}

function summarizeSceneForModel(scene: AssistantScene) {
  return {
    id: scene.id,
    name: scene.name,
    order: scene.order,
    background: scene.background,
    cameraConfig: scene.cameraConfig,
    ground: scene.ground ?? null,
    objectFolders: scene.objectFolders,
    objects: scene.objects.map((object) => summarizeObjectForModel(object)),
  };
}

export function buildAssistantModelState(state: AssistantProjectState) {
  return {
    project: state.project,
    settings: state.settings,
    scenes: state.scenes.map((scene) => summarizeSceneForModel(scene)),
    components: state.components.map((component) => summarizeComponentForModel(component)),
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
    state: buildAssistantModelState(snapshot.state),
  };
}

export function buildAssistantModelScene(scene: AssistantScene) {
  return summarizeSceneForModel(scene);
}

export function buildAssistantModelObject(object: AssistantObject) {
  return summarizeObjectForModel(object);
}

export function buildAssistantModelComponent(component: AssistantComponent) {
  return summarizeComponentForModel(component);
}
