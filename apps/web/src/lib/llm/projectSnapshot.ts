import type { Project } from '@/types';

export function buildAssistantProjectSnapshot(project: Project) {
  return {
    id: project.id,
    name: project.name,
    scenes: project.scenes.map((scene) => ({
      id: scene.id,
      name: scene.name,
      order: scene.order,
      ground: scene.ground
        ? {
            enabled: scene.ground.enabled,
            y: scene.ground.y,
            color: scene.ground.color,
          }
        : null,
      cameraConfig: scene.cameraConfig
        ? {
            followTarget: scene.cameraConfig.followTarget,
            bounds: scene.cameraConfig.bounds,
            zoom: scene.cameraConfig.zoom,
          }
        : null,
      objectFolders: (scene.objectFolders || []).map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId ?? null,
        order: folder.order,
      })),
      objects: scene.objects.map((object) => ({
        id: object.id,
        name: object.name,
        componentId: object.componentId || null,
        parentId: object.parentId ?? null,
        order: object.order,
        x: object.x,
        y: object.y,
        scaleX: object.scaleX,
        scaleY: object.scaleY,
        rotation: object.rotation,
        visible: object.visible,
        physics: object.physics,
        collider: object.collider,
        blocklyXml: object.blocklyXml || '',
        currentCostumeIndex: object.currentCostumeIndex,
        costumes: (object.costumes || []).map((costume) => ({
          id: costume.id,
          name: costume.name,
          assetId: costume.assetId,
        })),
        localVariables: (object.localVariables || []).map((variable) => ({
          id: variable.id,
          name: variable.name,
          type: variable.type,
          scope: variable.scope,
          defaultValue: variable.defaultValue,
        })),
        sounds: (object.sounds || []).map((sound) => ({
          id: sound.id,
          name: sound.name,
        })),
      })),
    })),
    components: (project.components || []).map((component) => ({
      id: component.id,
      name: component.name,
      physics: component.physics,
      collider: component.collider,
      blocklyXml: component.blocklyXml || '',
      currentCostumeIndex: component.currentCostumeIndex,
      costumes: (component.costumes || []).map((costume) => ({
        id: costume.id,
        name: costume.name,
        assetId: costume.assetId,
      })),
      localVariables: (component.localVariables || []).map((variable) => ({
        id: variable.id,
        name: variable.name,
        type: variable.type,
        scope: variable.scope,
        defaultValue: variable.defaultValue,
      })),
      sounds: (component.sounds || []).map((sound) => ({
        id: sound.id,
        name: sound.name,
      })),
    })),
    messages: (project.messages || []).map((message) => ({
      id: message.id,
      name: message.name,
    })),
    globalVariables: (project.globalVariables || []).map((variable) => ({
      id: variable.id,
      name: variable.name,
      type: variable.type,
      scope: variable.scope,
      defaultValue: variable.defaultValue,
    })),
  };
}
