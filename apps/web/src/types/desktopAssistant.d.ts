export type AssistantProviderMode = 'managed' | 'codex_oauth';
export type CodexAuthMethod = 'chatgpt' | 'api_key' | 'unknown' | null;

export interface DesktopProviderStatus {
  mode: AssistantProviderMode;
  hasCodexToken: boolean;
  codexAvailable: boolean;
  codexAuthMethod: CodexAuthMethod;
  codexEmail: string | null;
  codexPlanType: string | null;
  codexLoginInProgress: boolean;
  codexStatusMessage: string | null;
}

export interface DesktopProviderEvent {
  type:
    | 'codex-login-started'
    | 'codex-login-completed'
    | 'codex-logout'
    | 'codex-status'
    | 'codex-error'
    | 'assistant-turn-started'
    | 'assistant-turn-progress'
    | 'assistant-turn-completed'
    | 'assistant-turn-error';
  success?: boolean;
  message?: string | null;
  detail?: string | null;
  phase?: string | null;
  timestamp?: string | null;
  sequence?: number;
  turnId?: string | null;
  threadId?: string | null;
  scopeKey?: string | null;
}

export interface DesktopCodexAssistantTurnRequest {
  userIntent: string;
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  capabilities: unknown;
  context: unknown;
  programRead: unknown;
  projectSnapshot?: unknown;
  threadContext?: {
    threadId?: string;
    scopeKey?: string;
  };
}

export type DesktopCodexAssistantTurnResponse =
  | {
      provider: string;
      model: string;
      mode: 'chat';
      answer: string;
      debugTrace?: unknown;
    }
  | {
      provider: string;
      model: string;
      mode: 'edit';
      proposedEdits: unknown;
      debugTrace?: unknown;
    };

export interface DesktopAssistantApi {
  provider: {
    status: (userId: string) => Promise<DesktopProviderStatus>;
    setMode: (mode: AssistantProviderMode, userId: string) => Promise<DesktopProviderStatus>;
    loginCodex: (userId: string) => Promise<DesktopProviderStatus>;
    logoutCodex: (userId: string) => Promise<DesktopProviderStatus>;
    assistantTurn: (request: DesktopCodexAssistantTurnRequest, userId: string) => Promise<DesktopCodexAssistantTurnResponse>;
  };
  onProviderEvent: (listener: (payload: DesktopProviderEvent) => void) => () => void;
}

declare global {
  interface Window {
    desktopAssistant?: DesktopAssistantApi;
  }
}

export {};
