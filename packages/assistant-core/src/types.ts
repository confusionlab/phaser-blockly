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

export type ProjectOp =
  | {
      op: 'rename_project';
      name: string;
    }
  | {
      op: 'create_scene';
      name: string;
    }
  | {
      op: 'rename_scene';
      sceneId: string;
      name: string;
    }
  | {
      op: 'reorder_scenes';
      sceneIds: string[];
    }
  | {
      op: 'create_object';
      sceneId: string;
      name: string;
      x?: number;
      y?: number;
    }
  | {
      op: 'rename_object';
      sceneId: string;
      objectId: string;
      name: string;
    }
  | {
      op: 'set_object_property';
      sceneId: string;
      objectId: string;
      property: 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'visible';
      value: Scalar;
    }
  | {
      op: 'set_object_physics';
      sceneId: string;
      objectId: string;
      physics:
        | null
        | {
            enabled: boolean;
            bodyType?: 'dynamic' | 'static';
            gravityY?: number;
            velocityX?: number;
            velocityY?: number;
            bounce?: number;
            friction?: number;
            allowRotation?: boolean;
          };
    }
  | {
      op: 'set_object_collider_type';
      sceneId: string;
      objectId: string;
      colliderType: 'none' | 'box' | 'circle' | 'capsule';
    }
  | {
      op: 'create_folder';
      sceneId: string;
      name: string;
      parentId?: string | null;
    }
  | {
      op: 'rename_folder';
      sceneId: string;
      folderId: string;
      name: string;
    }
  | {
      op: 'move_object_to_folder';
      sceneId: string;
      objectId: string;
      folderId: string | null;
    }
  | {
      op: 'add_costume_from_image_url';
      sceneId: string;
      objectId: string;
      name: string;
      imageUrl: string;
    }
  | {
      op: 'add_costume_text_circle';
      sceneId: string;
      objectId: string;
      name: string;
      text: string;
      fillColor?: string;
      textColor?: string;
    }
  | {
      op: 'rename_costume';
      sceneId: string;
      objectId: string;
      costumeId: string;
      name: string;
    }
  | {
      op: 'reorder_costumes';
      sceneId: string;
      objectId: string;
      costumeIds: string[];
    }
  | {
      op: 'set_current_costume';
      sceneId: string;
      objectId: string;
      costumeId: string;
    }
  | {
      op: 'validate_project';
    };

export type ProposedEdits = {
  intentSummary: string;
  assumptions: string[];
  semanticOps: SemanticOp[];
  projectOps: ProjectOp[];
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
