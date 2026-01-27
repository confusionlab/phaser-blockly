import { create } from 'zustand';

interface EditorStore {
  // Selection state
  selectedSceneId: string | null;
  selectedObjectId: string | null;

  // Play state
  isPlaying: boolean;

  // View state
  zoom: number;
  panX: number;
  panY: number;

  // UI state
  showProjectDialog: boolean;
  showAssetLibrary: boolean;
  showReusableLibrary: boolean;

  // Actions
  selectScene: (sceneId: string | null) => void;
  selectObject: (objectId: string | null) => void;

  startPlaying: () => void;
  stopPlaying: () => void;

  setZoom: (zoom: number) => void;
  setPan: (x: number, y: number) => void;
  resetView: () => void;

  setShowProjectDialog: (show: boolean) => void;
  setShowAssetLibrary: (show: boolean) => void;
  setShowReusableLibrary: (show: boolean) => void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  // Selection state
  selectedSceneId: null,
  selectedObjectId: null,

  // Play state
  isPlaying: false,

  // View state
  zoom: 1,
  panX: 0,
  panY: 0,

  // UI state
  showProjectDialog: false,
  showAssetLibrary: false,
  showReusableLibrary: false,

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

  setShowProjectDialog: (show) => {
    set({ showProjectDialog: show });
  },

  setShowAssetLibrary: (show) => {
    set({ showAssetLibrary: show });
  },

  setShowReusableLibrary: (show) => {
    set({ showReusableLibrary: show });
  },
}));
