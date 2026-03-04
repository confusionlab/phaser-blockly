export type AssistantProviderMode = 'managed' | 'byok' | 'codex_oauth';

export interface ProviderStatus {
  mode: AssistantProviderMode;
  hasByokKey: boolean;
  hasCodexToken: boolean;
  codexAvailable: boolean;
}

export interface ProviderCredentials {
  openRouterApiKey: string | null;
  codexToken: string | null;
}

export interface OAuthCallbackPayload {
  url: string;
}
