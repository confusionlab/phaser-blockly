export type AssistantProviderMode = 'managed' | 'byok' | 'codex_oauth';
export type CodexAuthMethod = 'chatgpt' | 'api_key' | 'unknown' | null;

export interface DesktopProviderStatus {
  mode: AssistantProviderMode;
  hasByokKey: boolean;
  hasCodexToken: boolean;
  codexAvailable: boolean;
  codexAuthMethod: CodexAuthMethod;
  codexEmail: string | null;
  codexPlanType: string | null;
  codexLoginInProgress: boolean;
  codexStatusMessage: string | null;
}

export interface DesktopProviderCredentials {
  openRouterApiKey: string | null;
  codexToken: string | null;
}

export interface DesktopProviderEvent {
  type: 'codex-login-started' | 'codex-login-completed' | 'codex-logout' | 'codex-status' | 'codex-error';
  success?: boolean;
  message?: string | null;
}

export interface DesktopAssistantApi {
  provider: {
    status: () => Promise<DesktopProviderStatus>;
    setMode: (mode: AssistantProviderMode) => Promise<DesktopProviderStatus>;
    setByokKey: (key: string) => Promise<DesktopProviderStatus>;
    loginCodex: () => Promise<DesktopProviderStatus>;
    logoutCodex: () => Promise<DesktopProviderStatus>;
    getCredentials: () => Promise<DesktopProviderCredentials>;
  };
  onProviderEvent: (listener: (payload: DesktopProviderEvent) => void) => () => void;
}

declare global {
  interface Window {
    desktopAssistant?: DesktopAssistantApi;
  }
}

export {};
