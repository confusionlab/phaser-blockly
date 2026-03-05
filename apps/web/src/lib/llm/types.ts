import type { Project, VariableType } from '@/types';

export type BlocklyEditScope =
  | {
      scope: 'object';
      sceneId: string;
      objectId: string;
      componentId?: string | null;
    }
  | {
      scope: 'component';
      componentId: string;
      selectedSceneId?: string | null;
    };

export type ProgramContextScope = 'object' | 'component' | 'scene';

export type ProgramContextEntity = {
  id: string;
  label: string;
};

export type ProgramContext = {
  scope: BlocklyEditScope;
  targetXml: string;
  blockCount: number;
  sceneObjects: ProgramContextEntity[];
  scenes: ProgramContextEntity[];
  messages: ProgramContextEntity[];
  sounds: ProgramContextEntity[];
  globalVariables: Array<ProgramContextEntity & { variableType: VariableType }>;
  localVariables: Array<ProgramContextEntity & { variableType: VariableType }>;
  componentTypes: ProgramContextEntity[];
  isComponentInstanceSelection: boolean;
};

export type BlockInputCapability = {
  name: string;
  kind: 'value' | 'statement' | 'dummy';
  checks: string[];
};

export type BlockFieldCapability = {
  name: string;
  value: string;
  kind: string;
};

export type BlockCapability = {
  type: string;
  isStatement: boolean;
  isValue: boolean;
  hasPreviousConnection: boolean;
  hasNextConnection: boolean;
  inputs: BlockInputCapability[];
  fields: BlockFieldCapability[];
};

export type CapabilityLimits = {
  maxOpsPerRequest: number;
  maxActionDepth: number;
  maxBlocksPerMutation: number;
};

export type BlocklyCapabilities = {
  blocks: BlockCapability[];
  byType: Record<string, BlockCapability>;
  specialTokens: {
    objectTargets: string[];
    componentAnyPrefix: string;
  };
  limits: CapabilityLimits;
};

export type Scalar = string | number | boolean;

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

export type EnsureVariableScope = 'global' | 'local';

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
      scope: EnsureVariableScope;
      name: string;
      variableType: VariableType;
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

export type ProposedEditsError = {
  message: string;
  details?: string;
};

export type ProgramReadSummary = {
  summary: string;
  eventFlows: Array<{
    eventType: string;
    eventBlockId: string;
    actionCount: number;
  }>;
  warnings: string[];
};

export interface LLMProvider {
  name: string;
  model: string;
  proposeEdits(args: {
    userIntent: string;
    capabilities: BlocklyCapabilities;
    context: ProgramContext;
    programRead: ProgramReadSummary;
  }): Promise<ProposedEdits>;
}

export type BlockGraphInfo = {
  id: string;
  type: string;
  fieldValues: Record<string, string>;
  parentId: string | null;
  nextId: string | null;
  inputConnections: Record<string, string | null>;
};

export type CandidateDiff = {
  addedBlockCount: number;
  removedBlockCount: number;
  changedFieldCount: number;
  changedConnectionCount: number;
  addedBlockTypes: Record<string, number>;
  removedBlockTypes: Record<string, number>;
  summaryLines: string[];
};

export type CandidateValidationResult = {
  pass: boolean;
  errors: string[];
  warnings: string[];
  repairHints: string[];
};

export type PendingMessageEnsure = {
  tempId: string;
  name: string;
};

export type PendingVariableEnsure = {
  tempId: string;
  name: string;
  scope: EnsureVariableScope;
  variableType: VariableType;
  defaultValue: Scalar;
};

export type BuildCandidateResult = {
  previousXml: string;
  candidateXml: string;
  semanticOps: SemanticOp[];
  diff: CandidateDiff;
  pendingEnsures: {
    messages: PendingMessageEnsure[];
    variables: PendingVariableEnsure[];
  };
  blocksBefore: number;
  blocksAfter: number;
};

export type OrchestratedCandidate = {
  providerName: string;
  model: string;
  requestStartedAt: string;
  requestCompletedAt: string;
  scope: BlocklyEditScope;
  context: ProgramContext;
  capabilities: BlocklyCapabilities;
  programRead: ProgramReadSummary;
  proposedEdits: ProposedEdits;
  build: BuildCandidateResult;
  validation: CandidateValidationResult;
};

export type ApplyCandidateResult = {
  applied: boolean;
  message: string;
  createdMessageCount: number;
  createdVariableCount: number;
};

export type OrchestratorArgs = {
  project: Project;
  scope: BlocklyEditScope;
  userIntent: string;
  provider: LLMProvider;
};
