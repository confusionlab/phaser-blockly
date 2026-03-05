import { contextBridge, ipcRenderer } from 'electron';
import type {
  AssistantProviderMode,
  CodexAssistantTurnRequest,
  CodexAssistantTurnResponse,
  ProviderEventPayload,
  ProviderStatus,
} from '../shared/provider';

type ProviderEventListener = (payload: ProviderEventPayload) => void;

const assistantDesktopApi = {
  provider: {
    status: async (userId: string): Promise<ProviderStatus> => {
      return ipcRenderer.invoke('assistant:provider:get-status', userId);
    },
    setMode: async (mode: AssistantProviderMode, userId: string): Promise<ProviderStatus> => {
      return ipcRenderer.invoke('assistant:provider:set-mode', mode, userId);
    },
    loginCodex: async (userId: string): Promise<ProviderStatus> => {
      return ipcRenderer.invoke('assistant:provider:login-codex', userId);
    },
    logoutCodex: async (userId: string): Promise<ProviderStatus> => {
      return ipcRenderer.invoke('assistant:provider:logout-codex', userId);
    },
    assistantTurn: async (request: CodexAssistantTurnRequest, userId: string): Promise<CodexAssistantTurnResponse> => {
      return ipcRenderer.invoke('assistant:provider:assistant-turn', request, userId);
    },
  },
  onProviderEvent: (listener: ProviderEventListener): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: ProviderEventPayload) => listener(payload);
    ipcRenderer.on('assistant:provider:event', wrapped);
    return () => {
      ipcRenderer.removeListener('assistant:provider:event', wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('desktopAssistant', assistantDesktopApi);

export type DesktopAssistantApi = typeof assistantDesktopApi;
