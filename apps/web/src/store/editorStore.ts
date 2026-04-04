import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { StageViewMode } from '@/lib/stageViewport';
import type { ProjectReferenceOwnerTarget } from '@/lib/projectReferenceUsage';
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

export type { StageViewMode };

export type ObjectEditorTab = 'code' | 'costumes' | 'sounds';
export type HierarchyTab = 'scene' | 'object' | 'component';
export type InspectorTab = HierarchyTab;
export interface CostumeColliderEditorRequest {
  sceneId: string;
  objectId: string;
}

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
  copySelection?: () => boolean | Promise<boolean>;
  cutSelection?: () => boolean | Promise<boolean>;
  pasteSelection?: () => boolean | Promise<boolean>;
  nudgeSelection?: (dx: number, dy: number) => boolean;
  isTextEditing?: () => boolean;
};

export type BackgroundEditorShortcutHandler = (event: KeyboardEvent) => boolean;

const DARK_MODE_STORAGE_KEY = 'pochacoding-dark-mode';
const ADVANCED_BLOCKS_STORAGE_KEY = 'pochacoding-advanced-blocks';

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
  selectedSceneIds: string[];
  selectedFolderId: string | null;
  selectedObjectId: string | null;
  selectedObjectIds: string[];
  selectedComponentId: string | null;
  selectedComponentIds: string[];

  // Play state
  isPlaying: boolean;

  // Debug state
  showColliderOutlines: boolean;

  // Theme state
  isDarkMode: boolean;
  showAdvancedBlocks: boolean;

  // View state
  viewMode: StageViewMode;

  // UI state
  showProjectDialog: boolean;
  showReusableLibrary: boolean;
  showPlayValidationDialog: boolean;
  playValidationIssues: PlayValidationIssue[];
  activeInspectorTab: InspectorTab;
  activeHierarchyTab: HierarchyTab;
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
  selectScenes: (sceneIds: string[], primarySceneId?: string | null, options?: SelectionHistoryOptions) => void;
  selectFolder: (folderId: string | null, options?: SelectionHistoryOptions) => void;
  selectObject: (objectId: string | null, options?: SelectionHistoryOptions) => void;
  selectObjects: (objectIds: string[], primaryObjectId?: string | null, options?: SelectionHistoryOptions) => void;
  selectComponent: (componentId: string | null, options?: SelectionHistoryOptions) => void;
  selectComponents: (componentIds: string[], primaryComponentId?: string | null, options?: SelectionHistoryOptions) => void;
  clearSelection: (options?: SelectionHistoryOptions) => void;
  initializeSelectionForProject: (project: Project | null, options?: SelectionHistoryOptions) => void;
  reconcileSelectionToProject: (project: Project | null, options?: SelectionHistoryOptions) => void;
  setActiveInspectorTab: (tab: InspectorTab) => void;
  setActiveHierarchyTab: (tab: HierarchyTab) => void;
  setActiveObjectTab: (tab: ObjectEditorTab) => void;
  openCostumeColliderEditor: (sceneId: string, objectId: string) => void;
  consumeCostumeColliderEditorRequest: (sceneId: string, objectId: string) => boolean;

  startPlaying: () => void;
  stopPlaying: () => void;

  setViewMode: (mode: StageViewMode) => void;
  cycleViewMode: () => void;

  setShowProjectDialog: (show: boolean) => void;
  setShowReusableLibrary: (show: boolean) => void;
  setShowPlayValidationDialog: (show: boolean) => void;
  setPlayValidationIssues: (issues: PlayValidationIssue[]) => void;
  setAssistantLock: (runId: string | null, message?: string | null) => void;
  focusPlayValidationIssue: (issue: PlayValidationIssue) => void;
  focusCodeOwner: (target: ProjectReferenceOwnerTarget, options?: SelectionHistoryOptions) => void;
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
  toggleShowAdvancedBlocks: () => void;
  setShowAdvancedBlocks: (showAdvancedBlocks: boolean) => void;

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

type EditorStoreHook = UseBoundStore<StoreApi<EditorStore>>;
type EditorStoreGlobal = typeof globalThis & {
  __pochaEditorStore?: EditorStoreHook;
};

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

function createEditorStore(): EditorStoreHook {
  return create<EditorStore>((set, get) => ({
  // Selection state
  selectedSceneId: null,
  selectedSceneIds: [],
  selectedFolderId: null,
  selectedObjectId: null,
  selectedObjectIds: [],
  selectedComponentId: null,
  selectedComponentIds: [],

  // Play state
  isPlaying: false,

  // Debug state
  showColliderOutlines: false,

  // Theme state - check localStorage and system preference
  isDarkMode: (() => {
    const stored = localStorage.getItem(DARK_MODE_STORAGE_KEY);
    if (stored !== null) {
      const isDark = stored === 'true';
      document.documentElement.classList.toggle('dark', isDark);
      return isDark;
    }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.classList.toggle('dark', prefersDark);
    return prefersDark;
  })(),
  showAdvancedBlocks: (() => {
    const stored = localStorage.getItem(ADVANCED_BLOCKS_STORAGE_KEY);
    if (stored !== null) {
      return stored === 'true';
    }
    return true;
  })(),

  // View state
  viewMode: 'editor' as StageViewMode,

  // UI state
  showProjectDialog: false,
  showReusableLibrary: false,
  showPlayValidationDialog: false,
  playValidationIssues: [],
  activeInspectorTab: 'object' as InspectorTab,
  activeHierarchyTab: 'object' as HierarchyTab,
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
    const nextSelectedSceneIds = sceneId ? [sceneId] : [];
    const nextSelectedFolderId = null;
    const nextSelectedObjectId = null;
    const nextSelectedObjectIds: string[] = [];
    const nextSelectedComponentId = null;
    const nextSelectedComponentIds: string[] = [];
    const didChange =
      state.selectedSceneId !== nextSelectedSceneId ||
      !arraysEqual(state.selectedSceneIds, nextSelectedSceneIds) ||
      state.selectedFolderId !== nextSelectedFolderId ||
      state.selectedObjectId !== nextSelectedObjectId ||
      !arraysEqual(state.selectedObjectIds, nextSelectedObjectIds) ||
      state.selectedComponentId !== nextSelectedComponentId ||
      !arraysEqual(state.selectedComponentIds, nextSelectedComponentIds);
    if (!didChange) {
      if (!recordHistory) {
        syncHistorySnapshot();
      }
      return;
    }

    const applySelection = () => {
      set({
        activeInspectorTab: 'scene',
        selectedSceneId: nextSelectedSceneId,
        selectedSceneIds: nextSelectedSceneIds,
        selectedFolderId: nextSelectedFolderId,
        selectedObjectId: nextSelectedObjectId,
        selectedObjectIds: nextSelectedObjectIds,
        selectedComponentId: nextSelectedComponentId,
        selectedComponentIds: nextSelectedComponentIds,
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

  selectScenes: (sceneIds, primarySceneId = null, options) => {
    const uniqueIds = Array.from(new Set(sceneIds));
    if (uniqueIds.length === 0) {
      get().selectScene(null, options);
      return;
    }

    const primary = primarySceneId && uniqueIds.includes(primarySceneId)
      ? primarySceneId
      : uniqueIds[0] ?? null;
    const recordHistory = options?.recordHistory !== false;
    const state = get();
    const nextSelectedSceneId = primary;
    const nextSelectedSceneIds = uniqueIds;
    const nextSelectedFolderId = null;
    const nextSelectedObjectId = null;
    const nextSelectedObjectIds: string[] = [];
    const nextSelectedComponentId = null;
    const nextSelectedComponentIds: string[] = [];
    const didChange =
      state.selectedSceneId !== nextSelectedSceneId ||
      !arraysEqual(state.selectedSceneIds, nextSelectedSceneIds) ||
      state.selectedFolderId !== nextSelectedFolderId ||
      state.selectedObjectId !== nextSelectedObjectId ||
      !arraysEqual(state.selectedObjectIds, nextSelectedObjectIds) ||
      state.selectedComponentId !== nextSelectedComponentId ||
      !arraysEqual(state.selectedComponentIds, nextSelectedComponentIds);
    if (!didChange) {
      if (!recordHistory) {
        syncHistorySnapshot();
      }
      return;
    }

    const applySelection = () => {
      set({
        activeInspectorTab: 'scene',
        selectedSceneId: nextSelectedSceneId,
        selectedSceneIds: nextSelectedSceneIds,
        selectedFolderId: nextSelectedFolderId,
        selectedObjectId: nextSelectedObjectId,
        selectedObjectIds: nextSelectedObjectIds,
        selectedComponentId: nextSelectedComponentId,
        selectedComponentIds: nextSelectedComponentIds,
        costumeColliderEditorRequest: null,
      });
    };

    const beforeSelectionChange = getBeforeSelectionChangeHandler(state);

    if (!recordHistory) {
      beforeSelectionChange?.({ source: 'selection:scenes', recordHistory: false });
      applySelection();
      syncHistorySnapshot();
      return;
    }

    runInHistoryTransaction('selection:scenes', () => {
      beforeSelectionChange?.({ source: 'selection:scenes', recordHistory: true });
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
    const nextSelectedComponentIds: string[] = [];
    const didChange =
      state.selectedFolderId !== nextSelectedFolderId ||
      state.selectedObjectId !== nextSelectedObjectId ||
      !arraysEqual(state.selectedObjectIds, nextSelectedObjectIds) ||
      state.selectedComponentId !== nextSelectedComponentId ||
      !arraysEqual(state.selectedComponentIds, nextSelectedComponentIds);
    if (!didChange) {
      if (!recordHistory) {
        syncHistorySnapshot();
      }
      return;
    }

    const applySelection = () => {
      set({
        activeInspectorTab: 'object',
        selectedFolderId: nextSelectedFolderId,
        selectedObjectId: nextSelectedObjectId,
        selectedObjectIds: nextSelectedObjectIds,
        selectedComponentId: nextSelectedComponentId,
        selectedComponentIds: nextSelectedComponentIds,
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
    const nextSelectedComponentIds: string[] = [];
    const didChange =
      state.selectedFolderId !== nextSelectedFolderId ||
      state.selectedObjectId !== nextSelectedObjectId ||
      !arraysEqual(state.selectedObjectIds, nextSelectedObjectIds) ||
      state.selectedComponentId !== nextSelectedComponentId ||
      !arraysEqual(state.selectedComponentIds, nextSelectedComponentIds);
    if (!didChange) {
      if (!recordHistory) {
        syncHistorySnapshot();
      }
      return;
    }

    const applySelection = () => {
      set({
        activeInspectorTab: 'object',
        selectedFolderId: nextSelectedFolderId,
        selectedObjectId: nextSelectedObjectId,
        selectedObjectIds: nextSelectedObjectIds,
        selectedComponentId: nextSelectedComponentId,
        selectedComponentIds: nextSelectedComponentIds,
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
    const nextSelectedComponentIds: string[] = [];
    const didChange =
      state.selectedFolderId !== nextSelectedFolderId ||
      state.selectedObjectId !== nextSelectedObjectId ||
      !arraysEqual(state.selectedObjectIds, nextSelectedObjectIds) ||
      state.selectedComponentId !== nextSelectedComponentId ||
      !arraysEqual(state.selectedComponentIds, nextSelectedComponentIds);
    if (!didChange) {
      if (!recordHistory) {
        syncHistorySnapshot();
      }
      return;
    }

    const applySelection = () => {
      set({
        activeInspectorTab: 'object',
        selectedFolderId: nextSelectedFolderId,
        selectedObjectId: nextSelectedObjectId,
        selectedObjectIds: nextSelectedObjectIds,
        selectedComponentId: nextSelectedComponentId,
        selectedComponentIds: nextSelectedComponentIds,
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
    const nextSelectedComponentIds = componentId ? [componentId] : [];
    const nextSelectedFolderId = null;
    const nextSelectedObjectId = null;
    const nextSelectedObjectIds: string[] = [];
    const didChange =
      state.selectedComponentId !== nextSelectedComponentId ||
      !arraysEqual(state.selectedComponentIds, nextSelectedComponentIds) ||
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
        selectedComponentIds: nextSelectedComponentIds,
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

  selectComponents: (componentIds, primaryComponentId = null, options) => {
    const uniqueIds = Array.from(new Set(componentIds));
    if (uniqueIds.length === 0) {
      get().selectComponent(null, options);
      return;
    }

    const primary = primaryComponentId && uniqueIds.includes(primaryComponentId)
      ? primaryComponentId
      : uniqueIds[0] ?? null;
    const recordHistory = options?.recordHistory !== false;
    const state = get();
    const nextSelectedComponentId = primary;
    const nextSelectedComponentIds = uniqueIds;
    const nextSelectedFolderId = null;
    const nextSelectedObjectId = null;
    const nextSelectedObjectIds: string[] = [];
    const didChange =
      state.selectedComponentId !== nextSelectedComponentId ||
      !arraysEqual(state.selectedComponentIds, nextSelectedComponentIds) ||
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
        selectedComponentIds: nextSelectedComponentIds,
        selectedFolderId: nextSelectedFolderId,
        selectedObjectId: nextSelectedObjectId,
        selectedObjectIds: nextSelectedObjectIds,
        costumeColliderEditorRequest: null,
      });
    };

    const beforeSelectionChange = getBeforeSelectionChangeHandler(state);

    if (!recordHistory) {
      beforeSelectionChange?.({ source: 'selection:components', recordHistory: false });
      applySelection();
      syncHistorySnapshot();
      return;
    }

    runInHistoryTransaction('selection:components', () => {
      beforeSelectionChange?.({ source: 'selection:components', recordHistory: true });
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
    const nextSelectedComponentIds: string[] = [];
    const didChange =
      state.selectedFolderId !== nextSelectedFolderId ||
      state.selectedObjectId !== nextSelectedObjectId ||
      !arraysEqual(state.selectedObjectIds, nextSelectedObjectIds) ||
      state.selectedComponentId !== nextSelectedComponentId ||
      !arraysEqual(state.selectedComponentIds, nextSelectedComponentIds) ||
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
        selectedComponentIds: nextSelectedComponentIds,
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
    const nextSelectedSceneIds = nextSelectedSceneId ? [nextSelectedSceneId] : [];
    const nextSelectedFolderId = null;
    const nextSelectedObjectId = initialSelection.objectId;
    const nextSelectedObjectIds = nextSelectedObjectId ? [nextSelectedObjectId] : [];
    const nextSelectedComponentId = null;
    const nextSelectedComponentIds: string[] = [];
    const recordHistory = options?.recordHistory !== false;
    const didChange =
      state.selectedSceneId !== nextSelectedSceneId ||
      !arraysEqual(state.selectedSceneIds, nextSelectedSceneIds) ||
      state.selectedFolderId !== nextSelectedFolderId ||
      state.selectedObjectId !== nextSelectedObjectId ||
      !arraysEqual(state.selectedObjectIds, nextSelectedObjectIds) ||
      state.selectedComponentId !== nextSelectedComponentId ||
      !arraysEqual(state.selectedComponentIds, nextSelectedComponentIds);
    if (!didChange) {
      if (!recordHistory) {
        syncHistorySnapshot();
      }
      return;
    }

    const applySelection = () => {
      set({
        activeInspectorTab: nextSelectedObjectId ? 'object' : 'scene',
        activeHierarchyTab: 'object',
        selectedSceneId: nextSelectedSceneId,
        selectedSceneIds: nextSelectedSceneIds,
        selectedFolderId: nextSelectedFolderId,
        selectedObjectId: nextSelectedObjectId,
        selectedObjectIds: nextSelectedObjectIds,
        selectedComponentId: nextSelectedComponentId,
        selectedComponentIds: nextSelectedComponentIds,
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
    const validSceneIds = project
      ? state.selectedSceneIds.filter((sceneId) => projectContainsScene(project, sceneId))
      : [];
    const nextSelectedSceneIds = validSceneIds.length > 0
      ? validSceneIds
      : (nextSelectedSceneId ? [nextSelectedSceneId] : []);
    const nextSelectedComponentId = project && projectContainsComponent(project, state.selectedComponentId)
      ? state.selectedComponentId
      : null;
    const validComponentIds = project
      ? state.selectedComponentIds.filter((componentId) => projectContainsComponent(project, componentId))
      : [];
    const nextSelectedComponentIds = nextSelectedComponentId
      ? (validComponentIds.length > 0 ? validComponentIds : [nextSelectedComponentId])
      : [];
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
      !arraysEqual(state.selectedSceneIds, nextSelectedSceneIds) ||
      state.selectedFolderId !== (nextSelectedComponentId ? null : nextSelectedFolderId) ||
      state.selectedObjectId !== (nextSelectedComponentId ? null : nextSelectedObjectId) ||
      !arraysEqual(state.selectedObjectIds, nextSelectedComponentId ? [] : nextSelectedObjectIds) ||
      state.selectedComponentId !== nextSelectedComponentId ||
      !arraysEqual(state.selectedComponentIds, nextSelectedComponentIds);
    if (!didChange) {
      if (!recordHistory) {
        syncHistorySnapshot();
      }
      return;
    }

    const applySelection = () => {
      set({
        selectedSceneId: nextSelectedSceneId,
        selectedSceneIds: nextSelectedSceneIds,
        selectedFolderId: nextSelectedComponentId ? null : nextSelectedFolderId,
        selectedObjectId: nextSelectedComponentId ? null : nextSelectedObjectId,
        selectedObjectIds: nextSelectedComponentId ? [] : nextSelectedObjectIds,
        selectedComponentId: nextSelectedComponentId,
        selectedComponentIds: nextSelectedComponentIds,
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
        selectedSceneIds: issue.sceneId ? [issue.sceneId] : [],
        selectedFolderId: null,
        selectedObjectId: issue.objectId,
        selectedObjectIds: issue.objectId ? [issue.objectId] : [],
        selectedComponentId: null,
        selectedComponentIds: [],
        activeHierarchyTab: issue.objectId ? 'object' : 'scene',
        activeObjectTab: 'code',
        costumeColliderEditorRequest: null,
        showPlayValidationDialog: false,
      });
    });
  },

  focusCodeOwner: (target, options) => {
    const state = get();
    const beforeSelectionChange = getBeforeSelectionChangeHandler(state);
    const recordHistory = options?.recordHistory !== false;

    const applyFocus = () => {
      if (target.kind === 'component') {
        set({
          selectedFolderId: null,
          selectedObjectId: null,
          selectedObjectIds: [],
          selectedComponentId: target.componentId,
          selectedComponentIds: [target.componentId],
          activeInspectorTab: 'component',
          activeHierarchyTab: 'component',
          activeObjectTab: 'code',
          costumeColliderEditorRequest: null,
        });
        return;
      }

      set({
        selectedSceneId: target.sceneId,
        selectedSceneIds: [target.sceneId],
        selectedFolderId: null,
        selectedObjectId: target.objectId,
        selectedObjectIds: [target.objectId],
        selectedComponentId: null,
        selectedComponentIds: [],
        activeInspectorTab: 'object',
        activeHierarchyTab: 'object',
        activeObjectTab: 'code',
        costumeColliderEditorRequest: null,
      });
    };

    if (!recordHistory) {
      beforeSelectionChange?.({ source: 'selection:reference-owner', recordHistory: false });
      applyFocus();
      syncHistorySnapshot();
      return;
    }

    runInHistoryTransaction('selection:reference-owner', () => {
      beforeSelectionChange?.({ source: 'selection:reference-owner', recordHistory: true });
      applyFocus();
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
      activeInspectorTab: 'scene',
      activeHierarchyTab: 'scene',
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
      activeInspectorTab: 'scene',
      activeHierarchyTab: 'scene',
      worldBoundaryEditorOpen: false,
      worldBoundaryEditorSceneId: null,
    });
  },

  setActiveInspectorTab: (tab) => {
    set({
      activeInspectorTab: tab,
      activeHierarchyTab: tab,
    });
  },

  setActiveHierarchyTab: (tab) => {
    set({
      activeHierarchyTab: tab,
      activeInspectorTab: tab,
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
    localStorage.setItem(DARK_MODE_STORAGE_KEY, String(newValue));
    set({ isDarkMode: newValue });
  },

  setDarkMode: (isDarkMode) => {
    document.documentElement.classList.toggle('dark', isDarkMode);
    localStorage.setItem(DARK_MODE_STORAGE_KEY, String(isDarkMode));
    set({ isDarkMode });
  },

  toggleShowAdvancedBlocks: () => {
    const showAdvancedBlocks = !useEditorStore.getState().showAdvancedBlocks;
    localStorage.setItem(ADVANCED_BLOCKS_STORAGE_KEY, String(showAdvancedBlocks));
    set({ showAdvancedBlocks });
  },

  setShowAdvancedBlocks: (showAdvancedBlocks) => {
    localStorage.setItem(ADVANCED_BLOCKS_STORAGE_KEY, String(showAdvancedBlocks));
    set({ showAdvancedBlocks });
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
}

const editorStoreGlobal = globalThis as EditorStoreGlobal;

export const useEditorStore = editorStoreGlobal.__pochaEditorStore
  ?? (editorStoreGlobal.__pochaEditorStore = createEditorStore());

registerSelectionHistoryBridge(
  () => {
    const state = useEditorStore.getState();
    return {
      selectedSceneId: state.selectedSceneId,
      selectedSceneIds: [...state.selectedSceneIds],
      selectedFolderId: state.selectedFolderId,
      selectedObjectId: state.selectedObjectId,
      selectedObjectIds: [...state.selectedObjectIds],
      selectedComponentId: state.selectedComponentId,
      selectedComponentIds: [...state.selectedComponentIds],
    };
  },
  (selection) => {
    useEditorStore.setState({
      selectedSceneId: selection.selectedSceneId,
      selectedSceneIds: [...selection.selectedSceneIds],
      selectedFolderId: selection.selectedFolderId ?? null,
      selectedObjectId: selection.selectedObjectId,
      selectedObjectIds: [...selection.selectedObjectIds],
      selectedComponentId: selection.selectedComponentId ?? null,
      selectedComponentIds: [...selection.selectedComponentIds],
    });
  },
);
