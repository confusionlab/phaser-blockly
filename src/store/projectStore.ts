import { create } from 'zustand';
import type { Project, Scene, GameObject, Variable } from '../types';
import { createDefaultProject, createDefaultScene, createDefaultGameObject } from '../types';
import { saveProject } from '../db/database';

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

  // Variable actions
  addVariable: (variable: Variable) => void;
  removeVariable: (variableId: string) => void;
  updateVariable: (variableId: string, updates: Partial<Variable>) => void;

  // Helpers
  getScene: (sceneId: string) => Scene | undefined;
  getObject: (sceneId: string, objectId: string) => GameObject | undefined;
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  project: null,
  isDirty: false,

  // Project actions
  newProject: (name: string) => {
    set({ project: createDefaultProject(name), isDirty: true });
  },

  openProject: (project: Project) => {
    set({ project, isDirty: false });
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
            s.id === sceneId ? { ...s, ...updates } : s
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
    const newObject = createDefaultGameObject(name);

    set(state => {
      if (!state.project) return state;

      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s =>
            s.id === sceneId
              ? { ...s, objects: [...s.objects, newObject] }
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
              ? { ...s, objects: s.objects.filter(o => o.id !== objectId) }
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

      return {
        project: {
          ...state.project,
          scenes: state.project.scenes.map(s =>
            s.id === sceneId
              ? {
                  ...s,
                  objects: s.objects.map(o =>
                    o.id === objectId ? { ...o, ...updates } : o
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

  duplicateObject: (sceneId: string, objectId: string) => {
    const state = get();
    if (!state.project) return null;

    const scene = state.project.scenes.find(s => s.id === sceneId);
    const original = scene?.objects.find(o => o.id === objectId);
    if (!original) return null;

    const duplicate: GameObject = {
      ...original,
      id: crypto.randomUUID(),
      name: `${original.name} Copy`,
      x: original.x + 50,
      y: original.y + 50,
    };

    set(state => ({
      project: state.project
        ? {
            ...state.project,
            scenes: state.project.scenes.map(s =>
              s.id === sceneId
                ? { ...s, objects: [...s.objects, duplicate] }
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

            const objects = [...s.objects];
            const [removed] = objects.splice(fromIndex, 1);
            objects.splice(toIndex, 0, removed);

            return { ...s, objects };
          }),
          updatedAt: new Date(),
        },
        isDirty: true,
      };
    });
  },

  // Variable actions
  addVariable: (variable: Variable) => {
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

  removeVariable: (variableId: string) => {
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

  updateVariable: (variableId: string, updates: Partial<Variable>) => {
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

  // Helpers
  getScene: (sceneId: string) => {
    const { project } = get();
    return project?.scenes.find(s => s.id === sceneId);
  },

  getObject: (sceneId: string, objectId: string) => {
    const scene = get().getScene(sceneId);
    return scene?.objects.find(o => o.id === objectId);
  },
}));
