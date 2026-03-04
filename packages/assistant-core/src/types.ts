export type Scalar = string | number | boolean;

export type AssistantMode = 'chat' | 'edit';
export type AssistantProviderMode = 'managed' | 'byok' | 'codex_oauth';

export type InputLiteralSpec =
  | Scalar
  | {
      block: string;
      fields?: Record<string, Scalar>;
      inputs?: Record<string, InputLiteralSpec>;
      statements?: Record<string, ActionSpec[]>;
    };

export type ActionSpec = {
  action: string;
  fields?: Record<string, Scalar>;
  inputs?: Record<string, InputLiteralSpec>;
  statements?: Record<string, ActionSpec[]>;
};

export type EventFlowSelector = {
  eventBlockId?: string;
  eventType?: string;
  eventFieldEquals?: Record<string, string>;
  index?: number;
};

export type SemanticOp =
  | {
      op: 'create_event_flow';
      event: string;
      fields?: Record<string, Scalar>;
      actions?: ActionSpec[];
      index?: number;
    }
  | {
      op: 'append_actions';
      flowSelector: EventFlowSelector;
      actions: ActionSpec[];
    }
  | {
      op: 'replace_action';
      targetBlockId: string;
      action: ActionSpec;
    }
  | {
      op: 'set_block_field';
      targetBlockId: string;
      field: string;
      value: Scalar;
    }
  | {
      op: 'ensure_variable';
      scope: 'global' | 'local';
      name: string;
      variableType: 'string' | 'integer' | 'float' | 'boolean';
      defaultValue?: Scalar;
    }
  | {
      op: 'ensure_message';
      name: string;
    }
  | {
      op: 'retarget_reference';
      referenceKind: 'object' | 'scene' | 'sound' | 'message' | 'variable' | 'type';
      from: string;
      to: string;
    }
  | {
      op: 'delete_subtree';
      targetBlockId: string;
    };

export type ProposedEdits = {
  intentSummary: string;
  assumptions: string[];
  semanticOps: SemanticOp[];
};

export type AssistantValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

export type AssistantTraceToolCall = {
  round: number;
  name: string;
  args: Record<string, unknown>;
  resultPreview: string;
};

export type AssistantTrace = {
  promptEnvelopeHash: string;
  maxToolRounds: number;
  modelRounds: number;
  toolCalls: AssistantTraceToolCall[];
  validationErrors: string[];
  repairAttempts: number;
  parsedPayloadPreview: string | null;
  finalResponsePreview: string | null;
  finalVerdict: 'chat' | 'edit' | 'fallback_chat';
  fallbackReasonCode?: string;
};

export type AssistantThreadContext = {
  threadId?: string;
  scopeKey?: string;
};

export type AssistantTurnRequest = {
  userIntent: string;
  chatHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  providerMode?: AssistantProviderMode;
  threadContext?: AssistantThreadContext;
};

export type AssistantTurnResponse =
  | {
      provider: string;
      model: string;
      mode: 'chat';
      answer: string;
      debugTrace?: AssistantTrace;
      errorCode?: string;
    }
  | {
      provider: string;
      model: string;
      mode: 'edit';
      proposedEdits: ProposedEdits;
      debugTrace?: AssistantTrace;
    };
