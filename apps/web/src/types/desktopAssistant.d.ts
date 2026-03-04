export type AssistantProviderMode = 'managed' | 'byok' | 'codex_oauth';

export interface DesktopProviderStatus {
  mode: AssistantProviderMode;
  hasByokKey: boolean;
  hasCodexToken: boolean;
  codexAvailable: boolean;
}

export interface DesktopAssistantApi {
  provider: {
    status: () => Promise<DesktopProviderStatus>;
    setMode: (mode: AssistantProviderMode) => Promise<DesktopProviderStatus>;
    setByokKey: (key: string) => Promise<DesktopProviderStatus>;
    setCodexToken: (token: string) => Promise<DesktopProviderStatus>;
    logoutCodex: () => Promise<DesktopProviderStatus>;
  };
  onOAuthCallback: (listener: (payload: { url: string }) => void) => () => void;
}

declare global {
  interface Window {
    desktopAssistant?: DesktopAssistantApi;
  }
}

export {};
