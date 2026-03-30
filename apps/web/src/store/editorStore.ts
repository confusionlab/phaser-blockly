import { create } from 'zustand';
import type { PlayValidationIssue } from '@/lib/playValidation';
import type { Project } from '@/types';
import { getSceneObjectsInLayerOrder } from '@/utils/layerTree';
import {
  canRedoHistory,
  canUndoHistory,
  redoHistory,
  registerSelectionHistoryBridge,
  runInHistoryTransaction,
  syncHistorySnapshot,
  undoHistory,
} from '@/store/universalHistory';

export type ObjectEditorTab = 'code' | 'costumes' | 'sounds';
export interface CostumeColliderEditorRequest {
  sceneId: string;
  objectId: string;
}

// View mode for the stage canvas
// 'camera-masked': Shows game area with black bars outside camera bounds
// 'camera-viewport': Shows only the camera viewport (fits to container)
// 'editor': Free panning editor mode (infinite canvas)
export type StageViewMode = 'camera-masked' | 'camera-viewport' | 'editor';

// Callback type for object picker
export type ObjectPickerCallback = (objectId: string) => void;

// Undo/Redo handler type
export type UndoRedoHandler = {
  undo: () => void;
  redo: () => void;
  canUndo?: () => boolean;
  canRedo?: () => boolean;
  beforeHistoryUndoRedo?: () => void;
  beforeSelectionChange?: (context: { source: string; recordHistory: boolean }) => void;
  prepareForPlay?: () => void | Promise<void>;
  deleteSelection?: () => boolean;
  duplicateSelection?: () => boolean | Promise<boolean>;
  isTextEditing?: () => boolean;
};

export type BackgroundEditorShortcutHandler = (event: KeyboardEvent) => boolean;

type SelectionHistoryOptions = {
  recordHistory?: boolean;
};

type ProjectSelectionTarget = {
  sceneId: string | null;
  objectId: string | null;
};

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) {
      return false;
    }
  }
  return true;
}

function projectContainsScene(project: Project, sceneId: string | null): boolean {
  if (!sceneId) return false;
  return project.scenes.some((scene) => scene.id === sceneId);
}

function projectContainsObject(project: Project, sceneId: string | null, objectId: string | null): boolean {
  if (!sceneId || !objectId) return false;
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  return !!scene?.objects.some((object) => object.id === objectId);
}

function projectContainsFolder(project: Project, sceneId: string | null, folderId: string | null): boolean {
  if (!sceneId || !folderId) return false;
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  return !!scene?.objectFolders?.some((folder) => folder.id === folderId);
}

function projectContainsComponent(project: Project, componentId: string | null): boolean {
  if (!componentId) return false;
  return (project.components || []).some((component) => component.id === componentId);
}

function getInitialProjectSelection(project: Project | null): ProjectSelectionTarget {
  if (!project || project.scenes.length === 0) {
    return {
      sceneId: null,
      objectId: null,
    };
  }

  for (const scene of project.scenes) {
    const firstObjectId = getSceneObjectsInLayerOrder(scene)[0]?.id ?? null;
    if (firstObjectId) {
      return {
        sceneId: scene.id,
        objectId: firstObjectId,
      };
    }
  }

  return {
    sceneId: project.scenes[0]?.id ?? null,
    objectId: null,
  };
}

interface EditorStore {
  // Selection state
  selectedSceneId: string | null;
  selectedFolderId: string | null;
  selectedObjectId: string | null;
  selectedObjectIds: string[];
  selectedComponentId: string | null;

  // Play state
  isPlaying: boolean;

  // Debug state
  showColliderOutlines: boolean;

  // Theme state
  isDarkMode: boolean;

  // View state
  zoom: number;
  panX: number;
  panY: number;
  viewMode: StageViewMode;

  // UI state
  showProjectDialog: boolean;
  showReusableLibrary: boolean;
  showPlayValidationDialog: boolean;
  playValidationIssues: PlayValidationIssue[];
  activeObjectTab: ObjectEditorTab;
  costumeColliderEditorRequest: CostumeColliderEditorRequest | null;
  collapsedFolderIdsByScene: Record<string, string[]>;
  backgroundEditorOpen: boolean;
  backgroundEditorSceneId: string | null;
  worldBoundaryEditorOpen: boolean;
  worldBoundaryEditorSceneId: string | null;
  assistantLockRunId: string | null;
  assistantLockMessage: string | null;

  // Object picker state
  objectPickerOpen: boolean;
  objectPickerCallback: ObjectPickerCallback | null;
  objectPickerExcludeId: string | null; // Object to exclude (usually current object)

  // Undo/Redo handlers for different editors
  costumeUndoHandler: UndoRedoHandler | null;
  codeUndoHandler: UndoRedoHandler | null;
  backgroundUndoHandler: UndoRedoHandler | null;
  backgroundShortcutHandler: BackgroundEditorShortcutHandler | null;

  // Actions
  selectScene: (sceneId: string | null, options?: SelectionHistoryOptions) => void;
  selectFolder: (folderId: string | null, options?: SelectionHistoryOptions) => void;
  selectObject: (objectId: string | null, options?: SelectionHistoryOptions) => void;
  selectObjects: (objectIds: string[], primaryObjectId?: string | null, options?: SelectionHistoryOptions) => void;
  selectComponent: (componentId: string | null, options?: SelectionHistoryOptions) => void;
  clearSelection: (options?: SelectionHistoryOptions) => void;
  initializeSelectionForProject: (project: Project | null, options?: SelectionHistoryOptions) => void;
  reconcileSelectionToProject: (project: Project | null, options?: SelectionHistoryOptions) => void;
  setActiveObjectTab: (tab: ObjectEditorTab) => void;
  openCostumeColliderEditor: (sceneId: string, objectId: string) => void;
  consumeCostumeColliderEditorRequest: (sceneId: string, objectId: string) => boolean;

  startPlaying: () => void;
  stopPlaying: () => void;

  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  resetView: () => void;
  setViewMode: (mode: StageViewMode) => void;
  cycleViewMode: () => void;

  setShowProjectDialog: (show: boolean) => void;
  setShowReusableLibrary: (show: boolean) => void;
  setShowPlayValidationDialog: (show: boolean) => void;
  setPlayValidationIssues: (issues: PlayValidationIssue[]) => void;
  setAssistantLock: (runId: string | null, message?: string | null) => void;
  focusPlayValidationIssue: (issue: PlayValidationIssue) => void;
  toggleFolderCollapsed: (sceneId: string, folderId: string) => void;
  setFolderCollapsed: (sceneId: string, folderId: string, collapsed: boolean) => void;
  setCollapsedFoldersForScene: (sceneId: string, folderIds: string[]) => void;
  clearSceneUiState: (sceneId: string) => void;
  openBackgroundEditor: (sceneId: string) => void;
  closeBackgroundEditor: () => void;
  openWorldBoundaryEditor: (sceneId: string) => void;
  closeWorldBoundaryEditor: () => void;

  // Object picker actions
  openObjectPicker: (callback: ObjectPickerCallback, excludeId?: string | null) => void;
  closeObjectPicker: () => void;

  // Debug actions
  setShowColliderOutlines: (show: boolean) => void;

  // Theme actions
  toggleDarkMode: () => void;
  setDarkMode: (isDarkMode: boolean) => void;

  // Undo/Redo registration
  registerCostumeUndo: (handler: UndoRedoHandler | null) => void;
  registerCodeUndo: (handler: UndoRedoHandler | null) => void;
  registerBackgroundUndo: (handler: UndoRedoHandler | null) => void;
  registerBackgroundShortcutHandler: (handler: BackgroundEditorShortcutHandler | null) => void;
  prepareForPlay: () => Promise<void>;

  // Global undo/redo (routes to active editor)
  undo: () => void;
  redo: () => void;
}

function getBeforeSelectionChangeHandler(state: EditorStore): UndoRedoHandler['beforeSelectionChange'] | undefined {
  if (state.backgroundEditorOpen) {
    return state.backgroundUndoHandler?.beforeSelectionChange;
  }
  if (state.activeObjectTab === 'costumes') {
    return state.costumeUndoHandler?.beforeSelectionChange;
  }
  if (state.activeObjectTab === 'code') {
    return state.codeUndoHandler?.beforeSelectionChange;
  }
  return undefined;
}

function getPrepareForPlayHandlers(state: EditorStore): Array<NonNullable<UndoRedoHandler['prepareForPlay']>> {
  const handlers = [
    state.backgroundUndoHandler?.prepareForPlay,
    state.costumeUndoHandler?.prepareForPlay,
    state.codeUndoHandler?.prepareForPlay,
  ].filter((handler): handler is NonNullable<UndoRedoHandler['prepareForPlay']> => typeof handler === 'function');

  return Array.from(new Set(handlers));
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  // Selection state
  selectedSceneId: null,
  selectedFolderId: null,
  selectedObjectId: null,
  selectedObjectIds: [],
  selectedComponentId: null,

  // Play state
  isPlaying: false,

  // Debug state
  showColliderOutlines: false,

  // Theme state - check localStorage and system preference
  isDarkMode: (() => {
    const stored = localStorage.getItem('pochacoding-dark-mode');
    if (stored !== null) {
      const isDark = stored === 'true';
      document.documentElement.classList.toggle('dark', isDark);
      return isDark;
    }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', prefersDark);
    return prefersDark;
  })(),

  // View state
  zoom: 1,
  panX: 0,
  panY: 0,
  viewMode: 'editor' as StageViewMode,

  // UI state
  showProjectDialog: false,
  showReusableLibrary: false,
  showPlayValidationDialog: false,
  playValidationIssues: [],
  activeObjectTab: 'code' as ObjectEditorTab,
  costumeColliderEditorRequest: null,
  collapsedFolderIdsByScene: {},
  backgroundEditorOpen: false,
  backgroundEditorSceneId: null,
  worldBoundaryEditorOpen: false,
  worldBoundaryEditorSceneId: null,
  assistantLockRunId: null,
  assistantLockMessage: null,

  // Object picker state
  objectPickerOpen: false,
  objectPickerCallback: null,
  objectPickerExcludeId: null,

  // Undo/Redo handlers
  costumeUndoHandler: null,
  codeUndoHandler: null,
  backgroundUndoHandler: null,
  backgroundShortcutHandler: null,

  // Actions
  selectScene: (sceneId, options) => {
    const recordHistory = options?.recordHistory !== false;
    const state = get();
    const nextSelectedSceneId = sceneId;
    const nextSelectedFolderId = null;
    const nextSelectedObjectId = null;
    const nextSelectedObjectIds: string[] = [];
    const nextSelectedComponentId = null;
    const didChange =
      state.selectedSceneId !== nextSelectedSceneId ||
      state.selectedFolderId !== nextSelectedFolderId ||
      state.selectedObjectId !== nextSelectedObjectId ||
      !arraysEqual(state.selectedObjectIds, nextSelectedObjectIds) ||
      state.selectedComponentId !== nextSelectedComponentId;
    if (!didChange) {
      if (!recordHistory) {
        syncHistorySnapshot();
      }
      return;
    }

    const applySelection = () => {
      set({
        selectedSceneId: nextSelectedSceneId,
        selectedFolderId: nextSelectedFolderId,
        selectedObjectId: nextSelectedObjectId,
        selectedObjectIds: nextSelectedObjectIds,
        selectedComponentId: nextSelectedComponentId,
        costumeColliderEditorRequest: null,
      });
    };

    const beforeSelectionChange = getBeforeSelectionChangeHandler(state);

    if (!recordHistory) {
      beforeSelectionChange?.({ source: 'selection:scene', recordHistory: false });
      applySelection();
      syncHistorySnapshot();
      return;
    }

    runInHistoryTransaction('selection:scene', () => {
      beforeSelectionChange?.({ source: 'selection:scene', recordHistory: true });
      applySelection();
    });
  },

  selectFolder: (folderId, options) => {
    const recordHistory = options?.recordHistory !== false;
    const state = get();
    const nextSelectedFolderId = folderId;
    const nextSelectedObjectId = null;
    const nextSelectedObjectIds: string[] = [];
    const nextSelectedComponentId = null;
    const didChange =
      state.selectedFolderId !== nextSelectedFolderId ||
      state.selectedObjectId !== nextSelectedObjectId ||
      !arraysEqual(state.selectedObjectIds, nextSelectedObjectIds) ||
      state.selectedComponentId !== nextSelectedComponentId;
    if (!didChange) {
      if (!recordHistory) {
        syncHistorySnapshot();
      }
      return;
    }

    const applySelection = () => {
      set({
        selectedFolderId: nextSelectedFolderId,
        selectedObjectId: nextSelectedObjectId,
        selectedObjectIds: nextSelectedObjectIds,
        selectedComponentId: nextSelectedComponentId,
        costumeColliderEditorRequest: null,
      });
    };

    const beforeSelectionChange = getBeforeSelectionChangeHandler(state);

    if (!recordHistory) {
      beforeSelectionChange?.({ source: 'selection:folder', recordHistory: false });
      applySelection();
      syncHistorySnapshot();
      return;
    }

    runInHistoryTransaction('selection:folder', () => {
      beforeSelectionChange?.({ source: 'selection:folder', recordHistory: true });
      applySelection();
    });
  },

  selectObject: (objectId, options) => {
    if (objectId === null) {
      get().clearSelection(options);
      return;
    }

    const recordHistory = options?.recordHistory !== false;
    const state = get();
    const nextSelectedFolderId = null;
    const nextSelectedObjectId = objectId;
    const nextSelectedObjectIds = objectId ? [objectId] : [];
    const nextSelectedComponentId = null;
    const didChange =
      state.selectedFolderId !== nextSelectedFolderId ||
      state.selectedObjectId !== nextSelectedObjectId ||
      !arraysEqual(state.selectedObjectIds, nextSelectedObjectIds) ||
      state.selectedComponentId !== nextSelectedComponentId;
    if (!didChange) {
      if (!recordHistory) {
        syncHistorySnapshot();
      }
      return;
    }

    const applySelection = () => {
      set({
        selectedFolderId: nextSelectedFolderId,
        selectedObjectId: nextSelectedObjectId,
        selectedObjectIds: nextSelectedObjectIds,
        selectedComponentId: nextSelectedComponentId,
        costumeColliderEditorRequest: null,
      });
    };

    const beforeSelectionChange = getBeforeSelectionChangeHandler(state);

    if (!recordHistory) {
      beforeSelectionChange?.({ source: 'selection:object', recordHistory: false });
      applySelection();
      syncHistorySnapshot();
      return;
    }

    runInHistoryTransaction('selection:object', () => {
      beforeSelectionChange?.({ source: 'selection:object', recordHistory: true });
      applySelection();
    });
  },

  selectObjects: (objectIds, primaryObjectId = null, options) => {
    const uniqueIds = Array.from(new Set(objectIds));
    if (uniqueIds.length === 0) {
      get().clearSelection(options);
      return;
    }

    const primary = primaryObjectId && uniqueIds.includes(primaryObjectId)
      ? primaryObjectId
      : uniqueIds[0] ?? null;
    const recordHistory = options?.recordHistory !== false;
    const state = get();
    const nextSelectedFolderId = null;
    const nextSelectedObjectId = primary;
    const nextSelectedObjectIds = uniqueIds;
    const nextSelectedComponentId = null;
    const didChange =
      state.selectedFolderId !== nextSelectedFolderId ||
      state.selectedObjectId !== nextSelectedObjectId ||
      !arraysEqual(state.selectedObjectIds, nextSelectedObjectIds) ||
      state.selectedComponentId !== nextSelectedComponentId;
    if (!didChange) {
      if (!recordHistory) {
        syncHistorySnapshot();
      }
      return;
    }

    const applySelection = () => {
      set({
        selectedFolderId: nextSelectedFolderId,
        selectedObjectId: nextSelectedObjectId,
        selectedObjectIds: nextSelectedObjectIds,
        selectedComponentId: nextSelectedComponentId,
        costumeColliderEditorRequest: null,
      });
    };

    const beforeSelectionChange = getBeforeSelectionChangeHandler(state);

    if (!recordHistory) {
      beforeSelectionChange?.({ source: 'selection:objects', recordHistory: false });
      applySelection();
      syncHistorySnapshot();
      return;
    }

    runInHistoryTransaction('selection:objects', () => {
      beforeSelectionChange?.({ source: 'selection:objects', recordHistory: true });
      applySelection();
    });
  },

  selectComponent: (componentId, options) => {
    const recordHistory = options?.recordHistory !== false;
    const state = get();
    const nextSelectedComponentId = componentId;
    const nextSelectedFolderId = null;
    const nextSelectedObjectId = null;
    const nextSelectedObjectIds: string[] = [];
    const didChange =
      state.selectedComponentId !== nextSelectedComponentId ||
      state.selectedFolderId !== nextSelectedFolderId ||
      state.selectedObjectId !== nextSelectedObjectId ||
      !arraysEqual(state.selectedObjectIds, nextSelectedObjectIds);
    if (!didChange) {
      if (!recordHistory) {
        syncHistorySnapshot();
      }
      return;
    }

    const applySelection = () => {
      set({
        selectedComponentId: nextSelectedComponentId,
        selectedFolderId: nextSelectedFolderId,
        selectedObjectId: nextSelectedObjectId,
        selectedObjectIds: nextSelectedObjectIds,
        costumeColliderEditorRequest: null,
      });
    };

    const beforeSelectionChange = getBeforeSelectionChangeHandler(state);

    if (!recordHistory) {
      beforeSelectionChange?.({ source: 'selection:component', recordHistory: false });
      applySelection();
      syncHistorySnapshot();
      return;
    }

    runInHistoryTransaction('selection:component', () => {
      beforeSelectionChange?.({ source: 'selection:component', recordHistory: true });
      applySelection();
    });
  },

  clearSelection: (options) => {
    const recordHistory = options?.recordHistory !== false;
    const state = get();
    const nextSelectedFolderId = null;
    const nextSelectedObjectId = null;
    const nextSelectedObjectIds: string[] = [];
    const nextSelectedComponentId = null;
    const didChange =
      state.selectedFolderId !== nextSelectedFolderId ||
      state.selectedObjectId !== nextSelectedObjectId ||
      !arraysEqual(state.selectedObjectIds, nextSelectedObjectIds) ||
      state.selectedComponentId !== nextSelectedComponentId ||
      state.activeObjectTab !== 'code';
    if (!didChange) {
      if (!recordHistory) {
        syncHistorySnapshot();
      }
      return;
    }

    const applySelection = () => {
      set({
        selectedFolderId: nextSelectedFolderId,
        selectedObjectId: nextSelectedObjectId,
        selectedObjectIds: nextSelectedObjectIds,
        selectedComponentId: nextSelectedComponentId,
        activeObjectTab: 'code',
        costumeColliderEditorRequest: null,
      });
    };

    const beforeSelectionChange = getBeforeSelectionChangeHandler(state);

    if (!recordHistory) {
      beforeSelectionChange?.({ source: 'selection:clear', recordHistory: false });
      applySelection();
      syncHistorySnapshot();
      return;
    }

    runInHistoryTransaction('selection:clear', () => {
      beforeSelectionChange?.({ source: 'selection:clear', recordHistory: true });
      applySelection();
    });
  },

  initializeSelectionForProject: (project, options) => {
    const state = get();
    const initialSelection = getInitialProjectSelection(project);
    const nextSelectedSceneId = initialSelection.sceneId;
    const nextSelectedFolderId = null;
    const nextSelectedObjectId = initialSelection.objectId;
    const nextSelectedObjectIds = nextSelectedObjectId ? [nextSelectedObjectId] : [];
    const nextSelectedComponentId = null;
    const recordHistory = options?.recordHistory !== false;
    const didChange =
      state.selectedSceneId !== nextSelectedSceneId ||
      state.selectedFolderId !== nextSelectedFolderId ||
      state.selectedObjectId !== nextSelectedObjectId ||
      !arraysEqual(state.selectedObjectIds, nextSelectedObjectIds) ||
      state.selectedComponentId !== nextSelectedComponentId;
    if (!didChange) {
      if (!recordHistory) {
        syncHistorySnapshot();
      }
      return;
    }

    const applySelection = () => {
      set({
        selectedSceneId: nextSelectedSceneId,
        selectedFolderId: nextSelectedFolderId,
        selectedObjectId: nextSelectedObjectId,
        selectedObjectIds: nextSelectedObjectIds,
        selectedComponentId: nextSelectedComponentId,
        costumeColliderEditorRequest: null,
      });
    };

    const beforeSelectionChange = getBeforeSelectionChangeHandler(state);

    if (!recordHistory) {
      beforeSelectionChange?.({ source: 'selection:project-open', recordHistory: false });
      applySelection();
      syncHistorySnapshot();
      return;
    }

    runInHistoryTransaction('selection:project-open', () => {
      beforeSelectionChange?.({ source: 'selection:project-open', recordHistory: true });
      applySelection();
    });
  },

  reconcileSelectionToProject: (project, options) => {
    const state = get();
    const fallbackSceneId = project?.scenes[0]?.id ?? null;
    const nextSelectedSceneId = project && projectContainsScene(project, state.selectedSceneId)
      ? state.selectedSceneId
      : fallbackSceneId;
    const nextSelectedComponentId = project && projectContainsComponent(project, state.selectedComponentId)
      ? state.selectedComponentId
      : null;
    const nextSelectedFolderId = project && !nextSelectedComponentId && projectContainsFolder(project, nextSelectedSceneId, state.selectedFolderId)
      ? state.selectedFolderId
      : null;
    const validPrimaryObjectId = project && !nextSelectedComponentId && projectContainsObject(project, nextSelectedSceneId, state.selectedObjectId)
      ? state.selectedObjectId
      : null;
    const validObjectIds = project && !nextSelectedComponentId
      ? state.selectedObjectIds.filter((objectId) => projectContainsObject(project, nextSelectedSceneId, objectId))
      : [];
    const nextSelectedObjectIds = validObjectIds.length > 0
      ? validObjectIds
      : (validPrimaryObjectId ? [validPrimaryObjectId] : []);
    const nextSelectedObjectId = validPrimaryObjectId && nextSelectedObjectIds.includes(validPrimaryObjectId)
      ? validPrimaryObjectId
      : nextSelectedObjectIds[0] ?? null;
    const recordHistory = options?.recordHistory !== false;
    const didChange =
      state.selectedSceneId !== nextSelectedSceneId ||
      state.selectedFolderId !== (nextSelectedComponentId ? null : nextSelectedFolderId) ||
      state.selectedObjectId !== (nextSelectedComponentId ? null : nextSelectedObjectId) ||
      !arraysEqual(state.selectedObjectIds, nextSelectedComponentId ? [] : nextSelectedObjectIds) ||
      state.selectedComponentId !== nextSelectedComponentId;
    if (!didChange) {
      if (!recordHistory) {
        syncHistorySnapshot();
      }
      return;
    }

    const applySelection = () => {
      set({
        selectedSceneId: nextSelectedSceneId,
        selectedFolderId: nextSelectedComponentId ? null : nextSelectedFolderId,
        selectedObjectId: nextSelectedComponentId ? null : nextSelectedObjectId,
        selectedObjectIds: nextSelectedComponentId ? [] : nextSelectedObjectIds,
        selectedComponentId: nextSelectedComponentId,
        costumeColliderEditorRequest: null,
      });
    };

    const beforeSelectionChange = getBeforeSelectionChangeHandler(state);

    if (!recordHistory) {
      beforeSelectionChange?.({ source: 'selection:reconcile', recordHistory: false });
      applySelection();
      syncHistorySnapshot();
      return;
    }

    runInHistoryTransaction('selection:reconcile', () => {
      beforeSelectionChange?.({ source: 'selection:reconcile', recordHistory: true });
      applySelection();
    });
  },

  startPlaying: () => {
    set({ isPlaying: true });
  },

  stopPlaying: () => {
    set({ isPlaying: false });
  },

  setZoom: (zoom) => {
    set({ zoom: Math.max(0.1, Math.min(10, zoom)) });
  },

  setPan: (x, y) => {
    set({ panX: x, panY: y });
  },

  resetView: () => {
    set({ zoom: 1, panX: 0, panY: 0 });
  },

  setViewMode: (mode) => {
    set({ viewMode: mode });
  },

  cycleViewMode: () => {
    const currentMode = useEditorStore.getState().viewMode;
    // Toggle between camera view and editor (world) view
    set({ viewMode: currentMode === 'editor' ? 'camera-viewport' : 'editor' });
  },

  setShowProjectDialog: (show) => {
    set({ showProjectDialog: show });
  },

  setShowReusableLibrary: (show) => {
    set({ showReusableLibrary: show });
  },

  setShowPlayValidationDialog: (show) => {
    set({ showPlayValidationDialog: show });
  },

  setPlayValidationIssues: (issues) => {
    set({ playValidationIssues: issues });
  },

  setAssistantLock: (runId, message = null) => {
    set({
      assistantLockRunId: runId,
      assistantLockMessage: runId ? message : null,
    });
  },

  focusPlayValidationIssue: (issue) => {
    const state = get();
    const beforeSelectionChange = getBeforeSelectionChangeHandler(state);

    runInHistoryTransaction('selection:validation-focus', () => {
      beforeSelectionChange?.({ source: 'selection:validation-focus', recordHistory: true });
      set({
        selectedSceneId: issue.sceneId,
        selectedFolderId: null,
        selectedObjectId: issue.objectId,
        selectedObjectIds: issue.objectId ? [issue.objectId] : [],
        selectedComponentId: null,
        activeObjectTab: 'code',
        costumeColliderEditorRequest: null,
        showPlayValidationDialog: false,
      });
    });
  },

  toggleFolderCollapsed: (sceneId, folderId) => {
    set((state) => {
      const current = new Set(state.collapsedFolderIdsByScene[sceneId] ?? []);
      if (current.has(folderId)) {
        current.delete(folderId);
      } else {
        current.add(folderId);
      }
      return {
        collapsedFolderIdsByScene: {
          ...state.collapsedFolderIdsByScene,
          [sceneId]: Array.from(current),
        },
      };
    });
  },

  setFolderCollapsed: (sceneId, folderId, collapsed) => {
    set((state) => {
      const current = new Set(state.collapsedFolderIdsByScene[sceneId] ?? []);
      if (collapsed) {
        current.add(folderId);
      } else {
        current.delete(folderId);
      }
      return {
        collapsedFolderIdsByScene: {
          ...state.collapsedFolderIdsByScene,
          [sceneId]: Array.from(current),
        },
      };
    });
  },

  setCollapsedFoldersForScene: (sceneId, folderIds) => {
    set((state) => ({
      collapsedFolderIdsByScene: {
        ...state.collapsedFolderIdsByScene,
        [sceneId]: Array.from(new Set(folderIds)),
      },
    }));
  },

  clearSceneUiState: (sceneId) => {
    set((state) => {
      const { [sceneId]: _deleted, ...rest } = state.collapsedFolderIdsByScene;
      return {
        collapsedFolderIdsByScene: rest,
      };
    });
  },

  openBackgroundEditor: (sceneId) => {
    set({
      backgroundEditorOpen: true,
      backgroundEditorSceneId: sceneId,
    });
  },

  closeBackgroundEditor: () => {
    set({
      backgroundEditorOpen: false,
      backgroundEditorSceneId: null,
      backgroundUndoHandler: null,
      backgroundShortcutHandler: null,
    });
  },

  openWorldBoundaryEditor: (sceneId) => {
    set({
      worldBoundaryEditorOpen: true,
      worldBoundaryEditorSceneId: sceneId,
    });
  },

  closeWorldBoundaryEditor: () => {
    set({
      worldBoundaryEditorOpen: false,
      worldBoundaryEditorSceneId: null,
    });
  },

  setActiveObjectTab: (tab) => {
    set((state) => ({
      activeObjectTab: tab,
      costumeColliderEditorRequest: tab === 'costumes' ? state.costumeColliderEditorRequest : null,
    }));
  },

  openCostumeColliderEditor: (sceneId, objectId) => {
    set({
      activeObjectTab: 'costumes',
      costumeColliderEditorRequest: {
        sceneId,
        objectId,
      },
    });
  },

  consumeCostumeColliderEditorRequest: (sceneId, objectId) => {
    const request = get().costumeColliderEditorRequest;
    if (!request || request.sceneId !== sceneId || request.objectId !== objectId) {
      return false;
    }
    set({ costumeColliderEditorRequest: null });
    return true;
  },

  openObjectPicker: (callback, excludeId = null) => {
    set({
      objectPickerOpen: true,
      objectPickerCallback: callback,
      objectPickerExcludeId: excludeId,
    });
  },

  closeObjectPicker: () => {
    set({
      objectPickerOpen: false,
      objectPickerCallback: null,
      objectPickerExcludeId: null,
    });
  },

  setShowColliderOutlines: (show) => {
    set({ showColliderOutlines: show });
  },

  toggleDarkMode: () => {
    const newValue = !useEditorStore.getState().isDarkMode;
    document.documentElement.classList.toggle('dark', newValue);
    localStorage.setItem('pochacoding-dark-mode', String(newValue));
    set({ isDarkMode: newValue });
  },

  setDarkMode: (isDarkMode) => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    localStorage.setItem('pochacoding-dark-mode', String(isDarkMode));
    set({ isDarkMode });
  },

  registerCostumeUndo: (handler) => {
    set({ costumeUndoHandler: handler });
  },

  registerCodeUndo: (handler) => {
    set({ codeUndoHandler: handler });
  },

  registerBackgroundUndo: (handler) => {
    set({ backgroundUndoHandler: handler });
  },

  registerBackgroundShortcutHandler: (handler) => {
    set({ backgroundShortcutHandler: handler });
  },

  prepareForPlay: async () => {
    const handlers = getPrepareForPlayHandlers(useEditorStore.getState());
    for (const handler of handlers) {
      await handler();
    }
  },

  undo: () => {
    const state = useEditorStore.getState();
    if (state.backgroundEditorOpen && state.backgroundUndoHandler) {
      if (!state.backgroundUndoHandler.canUndo || state.backgroundUndoHandler.canUndo()) {
        state.backgroundUndoHandler.undo();
      }
      return;
    }

    if (state.activeObjectTab === 'costumes' && state.costumeUndoHandler) {
      if (!state.costumeUndoHandler.canUndo || state.costumeUndoHandler.canUndo()) {
        state.costumeUndoHandler.undo();
        return;
      }
    }

    if (state.activeObjectTab === 'code' && state.codeUndoHandler?.beforeHistoryUndoRedo) {
      state.codeUndoHandler.beforeHistoryUndoRedo();
    }

    if (canUndoHistory()) {
      undoHistory();
      return;
    }

    if (state.activeObjectTab === 'code' && state.codeUndoHandler) {
      state.codeUndoHandler.undo();
    }
  },

  redo: () => {
    const state = useEditorStore.getState();
    if (state.backgroundEditorOpen && state.backgroundUndoHandler) {
      if (!state.backgroundUndoHandler.canRedo || state.backgroundUndoHandler.canRedo()) {
        state.backgroundUndoHandler.redo();
      }
      return;
    }

    if (state.activeObjectTab === 'costumes' && state.costumeUndoHandler) {
      if (!state.costumeUndoHandler.canRedo || state.costumeUndoHandler.canRedo()) {
        state.costumeUndoHandler.redo();
        return;
      }
    }

    if (state.activeObjectTab === 'code' && state.codeUndoHandler?.beforeHistoryUndoRedo) {
      state.codeUndoHandler.beforeHistoryUndoRedo();
    }

    if (canRedoHistory()) {
      redoHistory();
      return;
    }

    if (state.activeObjectTab === 'code' && state.codeUndoHandler) {
      state.codeUndoHandler.redo();
    }
  },
}));

registerSelectionHistoryBridge(
  () => {
    const state = useEditorStore.getState();
    return {
      selectedSceneId: state.selectedSceneId,
      selectedFolderId: state.selectedFolderId,
      selectedObjectId: state.selectedObjectId,
      selectedObjectIds: [...state.selectedObjectIds],
      selectedComponentId: state.selectedComponentId,
    };
  },
  (selection) => {
    useEditorStore.setState({
      selectedSceneId: selection.selectedSceneId,
      selectedFolderId: selection.selectedFolderId ?? null,
      selectedObjectId: selection.selectedObjectId,
      selectedObjectIds: [...selection.selectedObjectIds],
      selectedComponentId: selection.selectedComponentId ?? null,
    });
  },
);
