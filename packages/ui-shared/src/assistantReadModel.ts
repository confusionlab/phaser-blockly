import type {
  AssistantComponent,
  AssistantObject,
  AssistantProjectSnapshot,
  AssistantProjectState,
  AssistantScene,
} from './assistant';
import { summarizeStoredBlocklyLogic } from './assistantLogic';

type LogicCodeMode = 'preview' | 'full';

function summarizeObjectForModel(object: AssistantObject, logicCodeMode: LogicCodeMode) {
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
    costumes: object.costumes,
    currentCostumeIndex: object.currentCostumeIndex,
    sounds: object.sounds,
    localVariables: object.localVariables,
    logic: summarizeStoredBlocklyLogic(
      object.blocklyXml,
      object.componentId ? 'set_component_logic' : 'set_object_logic',
      { codeMode: logicCodeMode },
    ),
  };
}

function summarizeComponentForModel(component: AssistantComponent, logicCodeMode: LogicCodeMode) {
  return {
    id: component.id,
    name: component.name,
    physics: component.physics,
    collider: component.collider,
    costumes: component.costumes,
    currentCostumeIndex: component.currentCostumeIndex,
    sounds: component.sounds,
    localVariables: component.localVariables,
    logic: summarizeStoredBlocklyLogic(component.blocklyXml, 'set_component_logic', { codeMode: logicCodeMode }),
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
