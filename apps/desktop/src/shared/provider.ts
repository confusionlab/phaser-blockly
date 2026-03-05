export type AssistantProviderMode = 'managed' | 'codex_oauth';
export type CodexAuthMethod = 'chatgpt' | 'api_key' | 'unknown' | null;

export interface ProviderStatus {
  mode: AssistantProviderMode;
  hasCodexToken: boolean;
  codexAvailable: boolean;
  codexAuthMethod: CodexAuthMethod;
  codexEmail: string | null;
  codexPlanType: string | null;
  codexLoginInProgress: boolean;
  codexStatusMessage: string | null;
}

export interface ProviderEventPayload {
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

export interface CodexAssistantTurnRequest {
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

export type CodexAssistantTurnResponse =
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
