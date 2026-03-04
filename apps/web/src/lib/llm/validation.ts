import * as Blockly from 'blockly';
import '@/components/blockly/toolbox';
import {
  COMPONENT_ANY_PREFIX,
  MESSAGE_REFERENCE_BLOCKS,
  OBJECT_REFERENCE_BLOCKS,
  SCENE_REFERENCE_BLOCKS,
  SOUND_REFERENCE_BLOCKS,
  TYPE_REFERENCE_BLOCKS,
  VALID_OBJECT_SPECIAL_VALUES,
  VARIABLE_REFERENCE_BLOCKS,
} from '@/lib/blocklyReferenceMaps';
import { validateProjectBeforePlay } from '@/lib/playValidation';
import { registerCodeGenerators, generateCodeForObject } from '@/phaser';
import type {
  BlocklyCapabilities,
  BlocklyEditScope,
  CandidateValidationResult,
  PendingMessageEnsure,
  PendingVariableEnsure,
  ProgramContext,
} from '@/lib/llm/types';
import type { Project, Variable } from '@/types';

type AllowedReferences = {
  objects: Set<string>;
  objectNames: Set<string>;
  scenes: Set<string>;
  sceneNames: Set<string>;
  sounds: Set<string>;
  soundNames: Set<string>;
  messages: Set<string>;
  messageNames: Set<string>;
  variables: Set<string>;
  variableNames: Set<string>;
  componentTypes: Set<string>;
};

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function buildAllowedReferences(
  context: ProgramContext,
  pendingMessages: PendingMessageEnsure[],
  pendingVariables: PendingVariableEnsure[],
): AllowedReferences {
  const variables = new Set<string>([
    ...context.globalVariables.map((item) => item.id),
    ...context.localVariables.map((item) => item.id),
    ...pendingVariables.map((item) => item.tempId),
  ]);
  const variableNames = new Set<string>([
    ...context.globalVariables.map((item) => normalize(item.label)),
    ...context.localVariables.map((item) => normalize(item.label)),
    ...pendingVariables.map((item) => normalize(item.name)),
  ]);

  return {
    objects: new Set(context.sceneObjects.map((item) => item.id)),
    objectNames: new Set(context.sceneObjects.map((item) => normalize(item.label))),
    scenes: new Set(context.scenes.map((item) => item.id)),
    sceneNames: new Set(context.scenes.map((item) => normalize(item.label))),
    sounds: new Set(context.sounds.map((item) => item.id)),
    soundNames: new Set(context.sounds.map((item) => normalize(item.label))),
    messages: new Set([
      ...context.messages.map((item) => item.id),
      ...pendingMessages.map((item) => item.tempId),
    ]),
    messageNames: new Set([
      ...context.messages.map((item) => normalize(item.label)),
      ...pendingMessages.map((item) => normalize(item.name)),
    ]),
    variables,
    variableNames,
    componentTypes: new Set(context.componentTypes.map((item) => item.id)),
  };
}

function validateReferenceIntegrity(
  workspace: Blockly.Workspace,
  allowed: AllowedReferences,
  errors: string[],
): void {
  for (const block of workspace.getAllBlocks(false)) {
    const objectField = OBJECT_REFERENCE_BLOCKS[block.type];
    if (objectField) {
      const value = String(block.getFieldValue(objectField) || '');
      if (!value) {
        errors.push(`${block.type}: missing object reference`);
      } else if (VALID_OBJECT_SPECIAL_VALUES.has(value)) {
        // Valid special token
      } else if (value.startsWith(COMPONENT_ANY_PREFIX)) {
        const componentId = value.slice(COMPONENT_ANY_PREFIX.length);
        if (!allowed.componentTypes.has(componentId)) {
          errors.push(`${block.type}: component target "${value}" does not exist`);
        }
      } else if (!allowed.objects.has(value) && !allowed.objectNames.has(normalize(value))) {
        errors.push(`${block.type}: object reference "${value}" does not exist in scene`);
      }
    }

    const sceneField = SCENE_REFERENCE_BLOCKS[block.type];
    if (sceneField) {
      const value = String(block.getFieldValue(sceneField) || '');
      if (!value) {
        errors.push(`${block.type}: missing scene reference`);
      } else if (!allowed.scenes.has(value) && !allowed.sceneNames.has(normalize(value))) {
        errors.push(`${block.type}: scene reference "${value}" does not exist`);
      }
    }

    const soundField = SOUND_REFERENCE_BLOCKS[block.type];
    if (soundField) {
      const value = String(block.getFieldValue(soundField) || '');
      if (!value) {
        errors.push(`${block.type}: missing sound reference`);
      } else if (!allowed.sounds.has(value) && !allowed.soundNames.has(normalize(value))) {
        errors.push(`${block.type}: sound reference "${value}" does not exist on target object`);
      }
    }

    const messageField = MESSAGE_REFERENCE_BLOCKS[block.type];
    if (messageField) {
      const value = String(block.getFieldValue(messageField) || '');
      if (!value) {
        errors.push(`${block.type}: missing message reference`);
      } else if (!allowed.messages.has(value) && !allowed.messageNames.has(normalize(value))) {
        errors.push(`${block.type}: message reference "${value}" does not exist`);
      }
    }

    const variableField = VARIABLE_REFERENCE_BLOCKS[block.type];
    if (variableField) {
      const value = String(block.getFieldValue(variableField) || '');
      if (!value) {
        errors.push(`${block.type}: missing variable reference`);
      } else if (!allowed.variables.has(value) && !allowed.variableNames.has(normalize(value))) {
        errors.push(`${block.type}: variable reference "${value}" does not exist`);
      }
    }

    const typeField = TYPE_REFERENCE_BLOCKS[block.type];
    if (typeField) {
      const value = String(block.getFieldValue(typeField) || '');
      if (!value.startsWith('component:')) {
        errors.push(`${block.type}: invalid type token "${value}"`);
      } else {
        const componentId = value.slice('component:'.length);
        if (!allowed.componentTypes.has(componentId)) {
          errors.push(`${block.type}: component type "${value}" does not exist`);
        }
      }
    }
  }
}

function validateConnectionCompatibility(workspace: Blockly.Workspace, errors: string[]): void {
  for (const block of workspace.getAllBlocks(false)) {
    for (const input of block.inputList) {
      const parentConnection = input.connection;
      if (!parentConnection?.targetConnection) continue;

      const canConnect = (parentConnection as Blockly.Connection & {
        canConnectWithReason?: (other: Blockly.Connection) => number;
      }).canConnectWithReason;
      if (typeof canConnect === 'function') {
        const reason = canConnect.call(parentConnection, parentConnection.targetConnection);
        if (reason !== Blockly.Connection.CAN_CONNECT) {
          errors.push(`${block.type}.${input.name}: illegal connection (reason ${reason})`);
        }
      }
    }
  }
}

function cloneProjectWithCandidate(
  project: Project,
  scope: BlocklyEditScope,
  candidateXml: string,
  pendingMessages: PendingMessageEnsure[],
  pendingVariables: PendingVariableEnsure[],
): Project {
  const cloned = structuredClone(project);

  for (const pendingMessage of pendingMessages) {
    const exists = (cloned.messages || []).some((message) =>
      message.id === pendingMessage.tempId || normalize(message.name) === normalize(pendingMessage.name)
    );
    if (!exists) {
      cloned.messages.push({ id: pendingMessage.tempId, name: pendingMessage.name });
    }
  }

  const ensureGlobalVariable = (pending: PendingVariableEnsure) => {
    const exists = (cloned.globalVariables || []).some((variable) =>
      variable.id === pending.tempId || normalize(variable.name) === normalize(pending.name)
    );
    if (!exists) {
      cloned.globalVariables.push({
        id: pending.tempId,
        name: pending.name,
        type: pending.variableType,
        defaultValue: pending.defaultValue,
        scope: 'global',
      });
    }
  };

  const ensureLocalVariable = (pending: PendingVariableEnsure, targetVariables: Variable[]) => {
    const exists = targetVariables.some((variable) =>
      variable.id === pending.tempId || normalize(variable.name) === normalize(pending.name)
    );
    if (!exists) {
      targetVariables.push({
        id: pending.tempId,
        name: pending.name,
        type: pending.variableType,
        defaultValue: pending.defaultValue,
        scope: 'local',
      });
    }
  };

  if (scope.scope === 'component') {
    const component = (cloned.components || []).find((item) => item.id === scope.componentId);
    if (component) {
      component.blocklyXml = candidateXml;
      component.localVariables = component.localVariables || [];
      for (const pendingVariable of pendingVariables) {
        if (pendingVariable.scope === 'global') {
          ensureGlobalVariable(pendingVariable);
        } else {
          ensureLocalVariable(pendingVariable, component.localVariables);
        }
      }
    }
  } else {
    const scene = cloned.scenes.find((sceneItem) => sceneItem.id === scope.sceneId);
    const object = scene?.objects.find((objectItem) => objectItem.id === scope.objectId);
    if (scene && object) {
      if (object.componentId) {
        const component = (cloned.components || []).find((item) => item.id === object.componentId);
        if (component) {
          component.blocklyXml = candidateXml;
          component.localVariables = component.localVariables || [];
          for (const pendingVariable of pendingVariables) {
            if (pendingVariable.scope === 'global') {
              ensureGlobalVariable(pendingVariable);
            } else {
              ensureLocalVariable(pendingVariable, component.localVariables);
            }
          }
        }
      } else {
        object.blocklyXml = candidateXml;
        object.localVariables = object.localVariables || [];
        for (const pendingVariable of pendingVariables) {
          if (pendingVariable.scope === 'global') {
            ensureGlobalVariable(pendingVariable);
          } else {
            ensureLocalVariable(pendingVariable, object.localVariables);
          }
        }
      }
    }
  }

  return cloned;
}

function hasAnyEventBlock(workspace: Blockly.Workspace): boolean {
  return workspace.getAllBlocks(false).some((block) => block.type.startsWith('event_'));
}

export function validateCandidate(args: {
  project: Project;
  scope: BlocklyEditScope;
  context: ProgramContext;
  capabilities: BlocklyCapabilities;
  candidateXml: string;
  pendingMessages: PendingMessageEnsure[];
  pendingVariables: PendingVariableEnsure[];
}): CandidateValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const repairHints: string[] = [];

  let xmlDom: Element | null = null;
  try {
    xmlDom = Blockly.utils.xml.textToDom(args.candidateXml);
  } catch {
    return {
      pass: false,
      errors: ['Candidate XML parsing failed.'],
      warnings,
      repairHints: ['Return syntactically valid Blockly XML.'],
    };
  }

  const workspace = new Blockly.Workspace();
  try {
    try {
      Blockly.Xml.domToWorkspace(xmlDom, workspace);
    } catch {
      errors.push('Candidate XML could not be loaded into workspace.');
      repairHints.push('Ensure block connections and XML structure are valid.');
      return { pass: false, errors, warnings, repairHints };
    }

    for (const block of workspace.getAllBlocks(false)) {
      if (!args.capabilities.byType[block.type]) {
        errors.push(`Unknown block type "${block.type}"`);
      }
    }

    validateConnectionCompatibility(workspace, errors);

    const allowed = buildAllowedReferences(args.context, args.pendingMessages, args.pendingVariables);
    validateReferenceIntegrity(workspace, allowed, errors);

    const candidateProject = cloneProjectWithCandidate(
      args.project,
      args.scope,
      args.candidateXml,
      args.pendingMessages,
      args.pendingVariables,
    );
    const playIssues = validateProjectBeforePlay(candidateProject);
    if (playIssues.length > 0) {
      for (const issue of playIssues.slice(0, 25)) {
        errors.push(`[Pre-play] ${issue.objectName}: ${issue.message}`);
      }
      if (playIssues.length > 25) {
        errors.push(`[Pre-play] ...and ${playIssues.length - 25} more issue(s).`);
      }
    }

    registerCodeGenerators();
    const generatedCode = generateCodeForObject(args.candidateXml, 'llm-candidate');
    if (hasAnyEventBlock(workspace) && !generatedCode.trim()) {
      warnings.push('Code generation returned empty output for a program with event blocks.');
      repairHints.push('Check event blocks and statement chain connections.');
    }
  } finally {
    workspace.dispose();
  }

  if (errors.length > 0) {
    if (!repairHints.includes('Verify object/message/variable references resolve to existing IDs.')) {
      repairHints.push('Verify object/message/variable references resolve to existing IDs.');
    }
    if (!repairHints.includes('Use only block types and fields listed by get_capabilities.')) {
      repairHints.push('Use only block types and fields listed by get_capabilities.');
    }
  }

  return {
    pass: errors.length === 0,
    errors,
    warnings,
    repairHints,
  };
}
