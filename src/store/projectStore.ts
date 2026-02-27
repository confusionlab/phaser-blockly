import { create } from 'zustand';
import type { Project, Scene, GameObject, Variable, ComponentDefinition, SceneFolder } from '../types';
import { createDefaultProject, createDefaultScene, createDefaultGameObject } from '../types';
import { saveProject } from '../db/database';
import {
  getNextSiblingOrder,
  getObjectNodeKey,
  getSceneObjectsInLayerOrder,
  moveSceneLayerNodes,
  normalizeProjectLayering,
  normalizeSceneLayering,
} from '@/utils/layerTree';

interface ProjectStore {
  project: Project | null;
  isDirty: boolean;

  // Project actions
  newProject: (name: string) => void;
  openProject: (project: Project) => void;
  saveCurrentProject: () => Promise<void>;
  closeProject: () => void;
  updateProjectName: (name: string) => void;
  updateProjectSettings: (settings: Partial<Project['settings']>) => void;

  // Scene actions
  addScene: (name: string) => void;
  removeScene: (sceneId: string) => void;
  updateScene: (sceneId: string, updates: Partial<Scene>) => void;
  reorderScenes: (sceneIds: string[]) => void;

  // Object actions
  addObject: (sceneId: string, name: string) => GameObject;
  removeObject: (sceneId: string, objectId: string) => void;
  updateObject: (sceneId: string, objectId: string, updates: Partial<GameObject>) => void;
  duplicateObject: (sceneId: string, objectId: string) => GameObject | null;
  reorderObject: (sceneId: string, fromIndex: number, toIndex: number) => void;

  // Variable actions (global)
  addGlobalVariable: (variable: Variable) => void;
  removeGlobalVariable: (variableId: string) => void;
  updateGlobalVariable: (variableId: string, updates: Partial<Variable>) => void;

  // Variable actions (local - per object)
  addLocalVariable: (sceneId: string, objectId: string, variable: Variable) => void;
  removeLocalVariable: (sceneId: string, objectId: string, variableId: string) => void;
  updateLocalVariable: (sceneId: string, objectId: string, variableId: string, updates: Partial<Variable>) => void;

  // Legacy aliases
  addVariable: (variable: Variable) => void;
  removeVariable: (variableId: string) => void;
  updateVariable: (variableId: string, updates: Partial<Variable>) => void;

  // Component actions
  makeComponent: (sceneId: string, objectId: string) => ComponentDefinition | null;
  updateComponent: (componentId: string, updates: Partial<ComponentDefinition>) => void;
  deleteComponent: (componentId: string) => void;
  addComponentInstance: (sceneId: string, componentId: string) => GameObject | null;
  detachFromComponent: (sceneId: string, objectId: string) => void;

  // Helpers
  getScene: (sceneId: string) => Scene | undefined;
  getObject: (sceneId: string, objectId: string) => GameObject | undefined;
  getComponent: (componentId: string) => ComponentDefinition | undefined;
}

function normalizeProject(project: Project): Project {
  return normalizeProjectLayering({
    ...project,
    scenes: project.scenes.map((scene) => {
      const objectFolders: SceneFolder[] = Array.isArray(scene.objectFolders) ? scene.objectFolders : [];
      const objects: GameObject[] = Array.isArray(scene.objects) ? scene.objects : [];
      return normalizeSceneLayering({
        ...scene,
        objectFolders,
        objects,
      });
    }),
  });
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  isDirty: false,

  // Project actions
  newProject: (name: string) => {
    set({ project: createDefaultProject(name), isDirty: true });
  },

  openProject: (project: Project) => {
    set({ project: normalizeProject(project), isDirty: false });
  },

  saveCurrentProject: async () => {
    const { project } = get();
    if (!project) return;

    await saveProject(project);
    set({ isDirty: false });
  },

  closeProject: () => {
    set({ project: null, isDirty: false });
  },

  updateProjectName: (name: string) => {
    set(state => ({
      project: state.project ? { ...state.project, name, updatedAt: new Date() } : null,
      isDirty: true,
    }));
  },

  updateProjectSettings: (settings: Partial<Project['settings']>) => {
    set(state => ({
      project: state.project
        ? {
            ...state.project,
            settings: { ...state.project.settings, ...settings },
            updatedAt: new Date(),
          }
        : null,
      isDirty: true,
    }));
  },

  // Scene actions
  addScene: (name: string) => {
    set(state => {
      if (!state.project) return state;

      const newScene = createDefaultScene(
        crypto.randomUUID(),
        name,
        state.project.scenes.length
      );

      return {
        project: {
          ...state.project,
          scenes: [...state.project.scenes, newScene],
          updatedAt: new Date(),
        },
        isDirty: true,
      };
    });
  },

  removeScene: (sceneId: string) => {
    set(state => {
      if (!state.project || state.project.scenes.length <= 1) return state;

      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.filter(s => s.id !== sceneId),
          updatedAt: new Date(),
        },
        isDirty: true,
      };
    });
  },

  updateScene: (sceneId: string, updates: Partial<Scene>) => {
    set(state => {
      if (!state.project) return state;

      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s =>
            s.id === sceneId ? normalizeSceneLayering({ ...s, ...updates }) : s
          ),
          updatedAt: new Date(),
        },
        isDirty: true,
      };
    });
  },

  reorderScenes: (sceneIds: string[]) => {
    set(state => {
      if (!state.project) return state;

      const sceneMap = new Map(state.project.scenes.map(s => [s.id, s]));
      const reorderedScenes = sceneIds
        .map((id, index) => {
          const scene = sceneMap.get(id);
          return scene ? { ...scene, order: index } : null;
        })
        .filter((s): s is Scene => s !== null);

      return {
        project: {
          ...state.project,
          scenes: reorderedScenes,
          updatedAt: new Date(),
        },
        isDirty: true,
      };
    });
  },

  // Object actions
  addObject: (sceneId: string, name: string) => {
    const scene = get().project?.scenes.find((s) => s.id === sceneId);
    const newObject = {
      ...createDefaultGameObject(name),
      parentId: null,
      order: scene ? getNextSiblingOrder(scene, null) : 0,
      folderId: undefined,
      layer: undefined,
    };

    set(state => {
      if (!state.project) return state;

      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s =>
            s.id === sceneId
              ? normalizeSceneLayering({ ...s, objects: [...s.objects, newObject] })
              : s
          ),
          updatedAt: new Date(),
        },
        isDirty: true,
      };
    });

    return newObject;
  },

  removeObject: (sceneId: string, objectId: string) => {
    set(state => {
      if (!state.project) return state;

      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s =>
            s.id === sceneId
              ? normalizeSceneLayering({ ...s, objects: s.objects.filter(o => o.id !== objectId) })
              : s
          ),
          updatedAt: new Date(),
        },
        isDirty: true,
      };
    });
  },

  updateObject: (sceneId: string, objectId: string, updates: Partial<GameObject>) => {
    set(state => {
      if (!state.project) return state;

      // Find the object to check if it's a component instance
      const scene = state.project.scenes.find(s => s.id === sceneId);
      const obj = scene?.objects.find(o => o.id === objectId);

      // For component instances, some properties sync to component (shared across instances)
      // and some are instance-specific (not synced)
      if (obj?.componentId) {
        const componentId = obj.componentId;

        // Instance-specific properties (do NOT sync across component instances)
        const instanceOnlyKeys = new Set<keyof GameObject>([
          'x',
          'y',
          'scaleX',
          'scaleY',
          'visible',
          'rotation',
          'parentId',
          'order',
          'folderId',
          'layer',
        ]);

        // Shared component properties (sync across all instances of the same component)
        const componentSyncKeys: (keyof ComponentDefinition & keyof GameObject)[] = [
          'name',
          'blocklyXml',
          'costumes',
          'currentCostumeIndex',
          'physics',
          'collider',
          'sounds',
        ];

        const syncedUpdates: Partial<ComponentDefinition> = {};
        const instanceUpdates: Partial<GameObject> = {};

        for (const key of Object.keys(updates) as (keyof GameObject)[]) {
          if (instanceOnlyKeys.has(key)) {
            // These are always instance-specific
            (instanceUpdates as Record<string, unknown>)[key] = updates[key];
          } else if ((componentSyncKeys as (keyof GameObject)[]).includes(key)) {
            // These sync to component definition + all instances
            (syncedUpdates as Record<string, unknown>)[key] = updates[key];
          } else {
            // Non-component fields remain instance-specific
            (instanceUpdates as Record<string, unknown>)[key] = updates[key];
          }
        }

        // If we have synced updates, update component and all instances
        if (Object.keys(syncedUpdates).length > 0) {
          return {
            project: {
              ...state.project,
              // Update component definition
              components: (state.project.components || []).map(c =>
                c.id === componentId ? { ...c, ...syncedUpdates } : c
              ),
              // Update all instances with synced properties + this instance with instance-specific
              scenes: state.project.scenes.map(s => ({
                ...normalizeSceneLayering({
                  ...s,
                  objects: s.objects.map(o => {
                    if (o.componentId === componentId) {
                      // All instances get synced updates
                      const syncedObjUpdates: Partial<GameObject> = {};
                      for (const syncKey of componentSyncKeys) {
                        const value = syncedUpdates[syncKey];
                        if (value !== undefined) {
                          (syncedObjUpdates as Record<string, unknown>)[syncKey] = value;
                        }
                      }

                      // This specific instance also gets instance-specific updates
                      if (o.id === objectId) {
                        return { ...o, ...syncedObjUpdates, ...instanceUpdates };
                      }
                      return { ...o, ...syncedObjUpdates };
                    }
                    return o;
                  }),
                }),
              })),
              updatedAt: new Date(),
            },
            isDirty: true,
          };
        }

        // Only instance-specific updates
        if (Object.keys(instanceUpdates).length > 0) {
          return {
            project: {
              ...state.project,
              scenes: state.project.scenes.map(s =>
                s.id === sceneId
                  ? normalizeSceneLayering({
                      ...s,
                      objects: s.objects.map(o =>
                        o.id === objectId ? { ...o, ...instanceUpdates } : o
                      ),
                    })
                  : s
              ),
              updatedAt: new Date(),
            },
            isDirty: true,
          };
        }

        return state;
      }

      // Regular object update (not a component instance)
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s =>
            s.id === sceneId
              ? normalizeSceneLayering({
                  ...s,
                  objects: s.objects.map(o =>
                    o.id === objectId ? { ...o, ...updates } : o
                  ),
                })
              : s
          ),
          updatedAt: new Date(),
        },
        isDirty: true,
      };
    });
  },

  duplicateObject: (sceneId: string, objectId: string) => {
    const state = get();
    if (!state.project) return null;

    const scene = state.project.scenes.find(s => s.id === sceneId);
    const original = scene?.objects.find(o => o.id === objectId);
    if (!original) return null;
    const originalIndex = scene?.objects.findIndex(o => o.id === objectId) ?? -1;

    const duplicate: GameObject = {
      ...original,
      id: crypto.randomUUID(),
      // Component instances keep the original name (they're instances of the same component)
      name: original.componentId ? original.name : `${original.name} Copy`,
      x: original.x + 50,
      y: original.y + 50,
      order: original.order + 1,
    };

    set(state => ({
      project: state.project
        ? {
            ...state.project,
            scenes: state.project.scenes.map(s =>
              s.id === sceneId
                ? normalizeSceneLayering({
                    ...s,
                    objects: (() => {
                      const originalParentId = original.parentId ?? null;
                      const next = s.objects.map((obj) => {
                        if (obj.id === original.id) return obj;
                        if ((obj.parentId ?? null) !== originalParentId) return obj;
                        if (obj.order >= duplicate.order) {
                          return { ...obj, order: obj.order + 1 };
                        }
                        return obj;
                      });
                      const insertIndex = originalIndex >= 0 ? originalIndex + 1 : next.length;
                      next.splice(insertIndex, 0, duplicate);
                      return next;
                    })(),
                  })
                : s
            ),
            updatedAt: new Date(),
          }
        : null,
      isDirty: true,
    }));

    return duplicate;
  },

  reorderObject: (sceneId: string, fromIndex: number, toIndex: number) => {
    set(state => {
      if (!state.project) return state;

      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s => {
            if (s.id !== sceneId) return s;

            const orderedObjects = getSceneObjectsInLayerOrder(s);
            const boundedFrom = Math.max(0, Math.min(fromIndex, orderedObjects.length - 1));
            const boundedTo = Math.max(0, Math.min(toIndex, orderedObjects.length - 1));
            const moved = orderedObjects[boundedFrom];
            const target = orderedObjects[boundedTo];
            if (!moved || !target || moved.id === target.id) return s;

            return moveSceneLayerNodes(
              s,
              [getObjectNodeKey(moved.id)],
              {
                key: getObjectNodeKey(target.id),
                dropPosition: boundedTo > boundedFrom ? 'after' : 'before',
              },
            );
          }),
          updatedAt: new Date(),
        },
        isDirty: true,
      };
    });
  },

  // Variable actions (global)
  addGlobalVariable: (variable: Variable) => {
    set(state => ({
      project: state.project
        ? {
            ...state.project,
            globalVariables: [...state.project.globalVariables, variable],
            updatedAt: new Date(),
          }
        : null,
      isDirty: true,
    }));
  },

  removeGlobalVariable: (variableId: string) => {
    set(state => ({
      project: state.project
        ? {
            ...state.project,
            globalVariables: state.project.globalVariables.filter(v => v.id !== variableId),
            updatedAt: new Date(),
          }
        : null,
      isDirty: true,
    }));
  },

  updateGlobalVariable: (variableId: string, updates: Partial<Variable>) => {
    set(state => ({
      project: state.project
        ? {
            ...state.project,
            globalVariables: state.project.globalVariables.map(v =>
              v.id === variableId ? { ...v, ...updates } : v
            ),
            updatedAt: new Date(),
          }
        : null,
      isDirty: true,
    }));
  },

  // Variable actions (local - per object)
  addLocalVariable: (sceneId: string, objectId: string, variable: Variable) => {
    set(state => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s =>
            s.id === sceneId
              ? {
                  ...s,
                  objects: s.objects.map(o =>
                    o.id === objectId
                      ? { ...o, localVariables: [...(o.localVariables || []), variable] }
                      : o
                  ),
                }
              : s
          ),
          updatedAt: new Date(),
        },
        isDirty: true,
      };
    });
  },

  removeLocalVariable: (sceneId: string, objectId: string, variableId: string) => {
    set(state => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s =>
            s.id === sceneId
              ? {
                  ...s,
                  objects: s.objects.map(o =>
                    o.id === objectId
                      ? { ...o, localVariables: (o.localVariables || []).filter(v => v.id !== variableId) }
                      : o
                  ),
                }
              : s
          ),
          updatedAt: new Date(),
        },
        isDirty: true,
      };
    });
  },

  updateLocalVariable: (sceneId: string, objectId: string, variableId: string, updates: Partial<Variable>) => {
    set(state => {
      if (!state.project) return state;
      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s =>
            s.id === sceneId
              ? {
                  ...s,
                  objects: s.objects.map(o =>
                    o.id === objectId
                      ? {
                          ...o,
                          localVariables: (o.localVariables || []).map(v =>
                            v.id === variableId ? { ...v, ...updates } : v
                          ),
                        }
                      : o
                  ),
                }
              : s
          ),
          updatedAt: new Date(),
        },
        isDirty: true,
      };
    });
  },

  // Legacy aliases
  addVariable: (variable: Variable) => {
    get().addGlobalVariable(variable);
  },

  removeVariable: (variableId: string) => {
    get().removeGlobalVariable(variableId);
  },

  updateVariable: (variableId: string, updates: Partial<Variable>) => {
    get().updateGlobalVariable(variableId, updates);
  },

  // Component actions
  makeComponent: (sceneId: string, objectId: string) => {
    const state = get();
    if (!state.project) return null;

    const scene = state.project.scenes.find(s => s.id === sceneId);
    const obj = scene?.objects.find(o => o.id === objectId);
    if (!obj) return null;

    // Don't convert if already a component instance
    if (obj.componentId) return null;

    // Create component definition from the object
    const componentId = crypto.randomUUID();
    const component: ComponentDefinition = {
      id: componentId,
      name: obj.name,
      blocklyXml: obj.blocklyXml,
      costumes: obj.costumes,
      currentCostumeIndex: obj.currentCostumeIndex,
      physics: obj.physics,
      collider: obj.collider,
      sounds: obj.sounds,
    };

    set(state => ({
      project: state.project
        ? {
            ...state.project,
            components: [...(state.project.components || []), component],
            scenes: state.project.scenes.map(s =>
              s.id === sceneId
                ? {
                    ...s,
                    objects: s.objects.map(o =>
                      o.id === objectId
                        ? { ...o, componentId }
                        : o
                    ),
                  }
                : s
            ),
            updatedAt: new Date(),
          }
        : null,
      isDirty: true,
    }));

    return component;
  },

  updateComponent: (componentId: string, updates: Partial<ComponentDefinition>) => {
    set(state => ({
      project: state.project
        ? {
            ...state.project,
            components: (state.project.components || []).map(c =>
              c.id === componentId ? { ...c, ...updates } : c
            ),
            updatedAt: new Date(),
          }
        : null,
      isDirty: true,
    }));
  },

  deleteComponent: (componentId: string) => {
    set(state => {
      if (!state.project) return state;

      // Detach all instances first
      const updatedScenes = state.project.scenes.map(scene =>
        normalizeSceneLayering({
          ...scene,
          objects: scene.objects.map(obj => {
            if (obj.componentId === componentId) {
              const component = (state.project!.components || []).find(c => c.id === componentId);
              if (component) {
                // Copy component data back to the object
                return {
                  ...obj,
                  componentId: undefined,
                  blocklyXml: component.blocklyXml,
                  costumes: component.costumes,
                  currentCostumeIndex: component.currentCostumeIndex,
                  physics: component.physics,
                  collider: component.collider,
                  sounds: component.sounds,
                };
              }
            }
            return obj;
          }),
        }),
      );

      return {
        project: {
          ...state.project,
          components: (state.project.components || []).filter(c => c.id !== componentId),
          scenes: updatedScenes,
          updatedAt: new Date(),
        },
        isDirty: true,
      };
    });
  },

  addComponentInstance: (sceneId: string, componentId: string) => {
    const state = get();
    if (!state.project) return null;

    const component = (state.project.components || []).find(c => c.id === componentId);
    if (!component) return null;
    const scene = state.project.scenes.find((s) => s.id === sceneId);

    const newObject: GameObject = {
      id: crypto.randomUUID(),
      name: component.name,
      spriteAssetId: null,
      x: 0,
      y: 0,
      scaleX: 1,
      scaleY: 1,
      rotation: 0,
      visible: true,
      parentId: null,
      order: scene ? getNextSiblingOrder(scene, null) : 0,
      layer: undefined,
      componentId,
      // These are ignored when componentId is set, but we need them for the type
      physics: null,
      collider: null,
      blocklyXml: '',
      costumes: [],
      currentCostumeIndex: 0,
      sounds: [],
      localVariables: [],
    };

    set(state => ({
      project: state.project
        ? {
            ...state.project,
            scenes: state.project.scenes.map(s =>
              s.id === sceneId
                ? normalizeSceneLayering({ ...s, objects: [...s.objects, newObject] })
                : s
            ),
            updatedAt: new Date(),
          }
        : null,
      isDirty: true,
    }));

    return newObject;
  },

  detachFromComponent: (sceneId: string, objectId: string) => {
    set(state => {
      if (!state.project) return state;

      const scene = state.project.scenes.find(s => s.id === sceneId);
      const obj = scene?.objects.find(o => o.id === objectId);
      if (!obj?.componentId) return state;

      const component = (state.project.components || []).find(c => c.id === obj.componentId);
      if (!component) return state;

      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s =>
            s.id === sceneId
              ? {
                  ...s,
                  objects: s.objects.map(o =>
                    o.id === objectId
                      ? {
                          ...o,
                          componentId: undefined,
                          blocklyXml: component.blocklyXml,
                          costumes: component.costumes,
                          currentCostumeIndex: component.currentCostumeIndex,
                          physics: component.physics,
                          collider: component.collider,
                          sounds: component.sounds,
                        }
                      : o
                  ),
                }
              : s
          ),
          updatedAt: new Date(),
        },
        isDirty: true,
      };
    });
  },

  // Helpers
  getScene: (sceneId: string) => {
    const { project } = get();
    return project?.scenes.find(s => s.id === sceneId);
  },

  getObject: (sceneId: string, objectId: string) => {
    const scene = get().getScene(sceneId);
    return scene?.objects.find(o => o.id === objectId);
  },

  getComponent: (componentId: string) => {
    const { project } = get();
    return (project?.components || []).find(c => c.id === componentId);
  },
}));
