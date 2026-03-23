import { create } from 'zustand';
import type { PlayValidationIssue } from '@/lib/playValidation';
import type { Project } from '@/types';
import {
  canRedoHistory,
  canUndoHistory,
  recordHistoryChange,
  redoHistory,
  registerSelectionHistoryBridge,
  syncHistorySnapshot,
  undoHistory,
} from '@/store/universalHistory';

export type ObjectEditorTab = 'code' | 'costumes' | 'sounds';

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
  deleteSelection?: () => boolean;
  duplicateSelection?: () => boolean | Promise<boolean>;
  isTextEditing?: () => boolean;
};

export type BackgroundEditorShortcutHandler = (event: KeyboardEvent) => boolean;

type SelectionHistoryOptions = {
  recordHistory?: boolean;
};

function projectContainsScene(project: Project, sceneId: string | null): boolean {
  if (!sceneId) return false;
  return project.scenes.some((scene) => scene.id === sceneId);
}

function projectContainsObject(project: Project, sceneId: string | null, objectId: string | null): boolean {
  if (!sceneId || !objectId) return false;
  const scene = project.scenes.find((candidate) => candidate.id === sceneId);
  return !!scene?.objects.some((object) => object.id === objectId);
}

function projectContainsComponent(project: Project, componentId: string | null): boolean {
  if (!componentId) return false;
  return (project.components || []).some((component) => component.id === componentId);
}

interface EditorStore {
  // Selection state
  selectedSceneId: string | null;
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
  selectObject: (objectId: string | null, options?: SelectionHistoryOptions) => void;
  selectObjects: (objectIds: string[], primaryObjectId?: string | null, options?: SelectionHistoryOptions) => void;
  selectComponent: (componentId: string | null, options?: SelectionHistoryOptions) => void;
  reconcileSelectionToProject: (project: Project | null, options?: SelectionHistoryOptions) => void;
  setActiveObjectTab: (tab: ObjectEditorTab) => void;

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

  // Global undo/redo (routes to active editor)
  undo: () => void;
  redo: () => void;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  // Selection state
  selectedSceneId: null,
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
    set({
      selectedSceneId: sceneId,
      selectedObjectId: null,
      selectedObjectIds: [],
      selectedComponentId: null,
    });
    if (options?.recordHistory !== false) {
      recordHistoryChange({ source: 'selection:scene' });
    } else {
      syncHistorySnapshot();
    }
  },

  selectObject: (objectId, options) => {
    set({
      selectedObjectId: objectId,
      selectedObjectIds: objectId ? [objectId] : [],
      selectedComponentId: null,
    });
    if (options?.recordHistory !== false) {
      recordHistoryChange({ source: 'selection:object' });
    } else {
      syncHistorySnapshot();
    }
  },

  selectObjects: (objectIds, primaryObjectId = null, options) => {
    const uniqueIds = Array.from(new Set(objectIds));
    const primary = primaryObjectId && uniqueIds.includes(primaryObjectId)
      ? primaryObjectId
      : uniqueIds[0] ?? null;
    set({
      selectedObjectId: primary,
      selectedObjectIds: uniqueIds,
      selectedComponentId: null,
    });
    if (options?.recordHistory !== false) {
      recordHistoryChange({ source: 'selection:objects' });
    } else {
      syncHistorySnapshot();
    }
  },

  selectComponent: (componentId, options) => {
    set({
      selectedComponentId: componentId,
      selectedObjectId: null,
      selectedObjectIds: [],
    });
    if (options?.recordHistory !== false) {
      recordHistoryChange({ source: 'selection:component' });
    } else {
      syncHistorySnapshot();
    }
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

    set({
      selectedSceneId: nextSelectedSceneId,
      selectedObjectId: nextSelectedComponentId ? null : nextSelectedObjectId,
      selectedObjectIds: nextSelectedComponentId ? [] : nextSelectedObjectIds,
      selectedComponentId: nextSelectedComponentId,
    });

    if (options?.recordHistory !== false) {
      recordHistoryChange({ source: 'selection:reconcile' });
    } else {
      syncHistorySnapshot();
    }
  },

  startPlaying: () => {
    set({ isPlaying: true });
  },

  stopPlaying: () => {
    set({ isPlaying: false });
  },

  setZoom: (zoom) => {
    set({ zoom: Math.max(0.25, Math.min(4, zoom)) });
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
    set({
      selectedSceneId: issue.sceneId,
      selectedObjectId: issue.objectId,
      selectedObjectIds: issue.objectId ? [issue.objectId] : [],
      selectedComponentId: null,
      activeObjectTab: 'code',
      showPlayValidationDialog: false,
    });
    recordHistoryChange({ source: 'selection:validation-focus' });
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
    set({ activeObjectTab: tab });
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
      selectedObjectId: state.selectedObjectId,
      selectedObjectIds: [...state.selectedObjectIds],
      selectedComponentId: state.selectedComponentId,
    };
  },
  (selection) => {
    useEditorStore.setState({
      selectedSceneId: selection.selectedSceneId,
      selectedObjectId: selection.selectedObjectId,
      selectedObjectIds: [...selection.selectedObjectIds],
      selectedComponentId: selection.selectedComponentId ?? null,
    });
  },
);
