import { create } from 'zustand';

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
};

interface EditorStore {
  // Selection state
  selectedSceneId: string | null;
  selectedObjectId: string | null;

  // Play state
  isPlaying: boolean;

  // Debug state
  showColliderOutlines: boolean;

  // View state
  zoom: number;
  panX: number;
  panY: number;
  viewMode: StageViewMode;

  // UI state
  showProjectDialog: boolean;
  showReusableLibrary: boolean;
  activeObjectTab: ObjectEditorTab;

  // Object picker state
  objectPickerOpen: boolean;
  objectPickerCallback: ObjectPickerCallback | null;
  objectPickerExcludeId: string | null; // Object to exclude (usually current object)

  // Undo/Redo handlers for different editors
  costumeUndoHandler: UndoRedoHandler | null;
  codeUndoHandler: UndoRedoHandler | null;

  // Actions
  selectScene: (sceneId: string | null) => void;
  selectObject: (objectId: string | null) => void;
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

  // Object picker actions
  openObjectPicker: (callback: ObjectPickerCallback, excludeId?: string | null) => void;
  closeObjectPicker: () => void;

  // Debug actions
  setShowColliderOutlines: (show: boolean) => void;

  // Undo/Redo registration
  registerCostumeUndo: (handler: UndoRedoHandler | null) => void;
  registerCodeUndo: (handler: UndoRedoHandler | null) => void;

  // Global undo/redo (routes to active editor)
  undo: () => void;
  redo: () => void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  // Selection state
  selectedSceneId: null,
  selectedObjectId: null,

  // Play state
  isPlaying: false,

  // Debug state
  showColliderOutlines: false,

  // View state
  zoom: 1,
  panX: 0,
  panY: 0,
  viewMode: 'editor' as StageViewMode,

  // UI state
  showProjectDialog: false,
  showReusableLibrary: false,
  activeObjectTab: 'code' as ObjectEditorTab,

  // Object picker state
  objectPickerOpen: false,
  objectPickerCallback: null,
  objectPickerExcludeId: null,

  // Undo/Redo handlers
  costumeUndoHandler: null,
  codeUndoHandler: null,

  // Actions
  selectScene: (sceneId) => {
    set({ selectedSceneId: sceneId, selectedObjectId: null });
  },

  selectObject: (objectId) => {
    set({ selectedObjectId: objectId });
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

  registerCostumeUndo: (handler) => {
    set({ costumeUndoHandler: handler });
  },

  registerCodeUndo: (handler) => {
    set({ codeUndoHandler: handler });
  },

  undo: () => {
    const state = useEditorStore.getState();
    if (state.activeObjectTab === 'costumes' && state.costumeUndoHandler) {
      state.costumeUndoHandler.undo();
    } else if (state.activeObjectTab === 'code' && state.codeUndoHandler) {
      state.codeUndoHandler.undo();
    }
  },

  redo: () => {
    const state = useEditorStore.getState();
    if (state.activeObjectTab === 'costumes' && state.costumeUndoHandler) {
      state.costumeUndoHandler.redo();
    } else if (state.activeObjectTab === 'code' && state.codeUndoHandler) {
      state.codeUndoHandler.redo();
    }
  },
}));
