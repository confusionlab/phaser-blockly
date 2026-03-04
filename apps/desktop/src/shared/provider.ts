export type AssistantProviderMode = 'managed' | 'byok' | 'codex_oauth';
export type CodexAuthMethod = 'chatgpt' | 'api_key' | 'unknown' | null;

export interface ProviderStatus {
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

export interface ProviderCredentials {
  openRouterApiKey: string | null;
  codexToken: string | null;
}

export interface ProviderEventPayload {
  type: 'codex-login-started' | 'codex-login-completed' | 'codex-logout' | 'codex-status' | 'codex-error';
  success?: boolean;
  message?: string | null;
}
