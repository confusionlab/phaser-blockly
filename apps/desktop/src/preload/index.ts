import { contextBridge, ipcRenderer } from 'electron';
import type {
  AssistantProviderMode,
  OAuthCallbackPayload,
  ProviderCredentials,
  ProviderStatus,
} from '../shared/provider';

type OAuthListener = (payload: OAuthCallbackPayload) => void;

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
    setCodexToken: async (token: string): Promise<ProviderStatus> => {
      return ipcRenderer.invoke('assistant:provider:set-codex-token', token);
    },
    logoutCodex: async (): Promise<ProviderStatus> => {
      return ipcRenderer.invoke('assistant:provider:logout-codex');
    },
    getCredentials: async (): Promise<ProviderCredentials> => {
      return ipcRenderer.invoke('assistant:provider:get-credentials');
    },
  },
  onOAuthCallback: (listener: OAuthListener): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: OAuthCallbackPayload) => listener(payload);
    ipcRenderer.on('assistant:oauth-callback', wrapped);
    return () => {
      ipcRenderer.removeListener('assistant:oauth-callback', wrapped);
    };
  },
};

contextBridge.exposeInMainWorld('desktopAssistant', assistantDesktopApi);

export type DesktopAssistantApi = typeof assistantDesktopApi;
