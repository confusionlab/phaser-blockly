import { contextBridge, ipcRenderer } from 'electron';
import type {
  AssistantProviderMode,
  ProviderEventPayload,
  ProviderCredentials,
  ProviderStatus,
} from '../shared/provider';

type ProviderEventListener = (payload: ProviderEventPayload) => void;

const assistantDesktopApi = {
  provider: {
    status: async (): Promise<ProviderStatus> => {
      return ipcRenderer.invoke('assistant:provider:get-status');
    },
    setMode: async (mode: AssistantProviderMode): Promise<ProviderStatus> => {
      return ipcRenderer.invoke('assistant:provider:set-mode', mode);
    },
    setByokKey: async (key: string): Promise<ProviderStatus> => {
      return ipcRenderer.invoke('assistant:provider:set-byok-key', key);
    },
    loginCodex: async (): Promise<ProviderStatus> => {
      return ipcRenderer.invoke('assistant:provider:login-codex');
    },
    logoutCodex: async (): Promise<ProviderStatus> => {
      return ipcRenderer.invoke('assistant:provider:logout-codex');
    },
    getCredentials: async (): Promise<ProviderCredentials> => {
      return ipcRenderer.invoke('assistant:provider:get-credentials');
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
