"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";

type Scalar = string | number | boolean;
type ActionSpec = {
  action: string;
  fields?: Record<string, Scalar>;
  inputs?: Record<string, Scalar | InputBlockSpec>;
  statements?: Record<string, ActionSpec[]>;
};
type InputBlockSpec = {
  block: string;
  fields?: Record<string, Scalar>;
  inputs?: Record<string, Scalar | InputBlockSpec>;
  statements?: Record<string, ActionSpec[]>;
};
type SemanticOp =
  | {
      op: "create_event_flow";
      event: string;
      fields?: Record<string, Scalar>;
      actions?: ActionSpec[];
      index?: number;
    }
  | {
      op: "append_actions";
      flowSelector: {
        eventBlockId?: string;
        eventType?: string;
        eventFieldEquals?: Record<string, string>;
        index?: number;
      };
      actions: ActionSpec[];
    }
  | {
      op: "replace_action";
      targetBlockId: string;
      action: ActionSpec;
    }
  | {
      op: "set_block_field";
      targetBlockId: string;
      field: string;
      value: Scalar;
    }
  | {
      op: "ensure_variable";
      scope: "global" | "local";
      name: string;
      variableType: "string" | "integer" | "float" | "boolean";
      defaultValue?: Scalar;
    }
  | {
      op: "ensure_message";
      name: string;
    }
  | {
      op: "retarget_reference";
      referenceKind: "object" | "scene" | "sound" | "message" | "variable" | "type";
      from: string;
      to: string;
    }
  | {
      op: "delete_subtree";
      targetBlockId: string;
    };

type ProposedEdits = {
  intentSummary: string;
  assumptions: string[];
  semanticOps: SemanticOp[];
};

type AssistantTurnPayload =
  | {
      mode: "chat";
      answer: string;
    }
  | {
      mode: "edit";
      proposedEdits: ProposedEdits;
    };

type OpenRouterChatCompletionResponse = {
  choices?: Array<{
    message?: {
      role?: string;
      content?: string | Array<{ type?: string; text?: string }>;
      tool_calls?: Array<{
        id?: string;
        type?: string;
        function?: {
          name?: string;
          arguments?: string;
        };
      }>;
    };
  }>;
};

type ChatHistoryTurn = {
  role: "user" | "assistant";
  content: string;
};

const proposedEditsValidator = v.object({
  intentSummary: v.string(),
  assumptions: v.array(v.string()),
  semanticOps: v.array(v.any()),
});

const assistantTurnReturnValidator = v.object({
  provider: v.string(),
  model: v.string(),
  mode: v.union(v.literal("chat"), v.literal("edit")),
  answer: v.optional(v.string()),
  proposedEdits: v.optional(proposedEditsValidator),
  debugTrace: v.optional(v.any()),
});

function truncate(text: string, maxLength = 700): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is Scalar {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function getAlias<T>(obj: Record<string, unknown>, ...keys: string[]): T | undefined {
  for (const key of keys) {
    if (obj[key] !== undefined) {
      return obj[key] as T;
    }
  }
  return undefined;
}

function parseStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function parseInputLiteral(value: unknown, path: string, errors: string[]): Scalar | InputBlockSpec | null {
  if (isScalar(value)) return value;
  if (!isRecord(value)) {
    errors.push(`${path}: expected scalar or object`);
    return null;
  }
  const block = getAlias<string>(value, "block");
  if (typeof block !== "string" || !block.trim()) {
    errors.push(`${path}.block: expected non-empty string`);
    return null;
  }
  const parsed: InputBlockSpec = { block };

  const fieldsCandidate = getAlias<unknown>(value, "fields");
  if (fieldsCandidate !== undefined) {
    if (!isRecord(fieldsCandidate)) {
      errors.push(`${path}.fields: expected object`);
    } else {
      const fields: Record<string, Scalar> = {};
      for (const [fieldName, fieldValue] of Object.entries(fieldsCandidate)) {
        if (!isScalar(fieldValue)) {
          errors.push(`${path}.fields.${fieldName}: expected scalar`);
          continue;
        }
        fields[fieldName] = fieldValue;
      }
      if (Object.keys(fields).length > 0) {
        parsed.fields = fields;
      }
    }
  }

  const inputsCandidate = getAlias<unknown>(value, "inputs");
  if (inputsCandidate !== undefined) {
    if (!isRecord(inputsCandidate)) {
      errors.push(`${path}.inputs: expected object`);
    } else {
      const inputs: Record<string, Scalar | InputBlockSpec> = {};
      for (const [inputName, inputValue] of Object.entries(inputsCandidate)) {
        const parsedInput = parseInputLiteral(inputValue, `${path}.inputs.${inputName}`, errors);
        if (parsedInput !== null) {
          inputs[inputName] = parsedInput;
        }
      }
      if (Object.keys(inputs).length > 0) {
        parsed.inputs = inputs;
      }
    }
  }

  const statementsCandidate = getAlias<unknown>(value, "statements");
  if (statementsCandidate !== undefined) {
    if (!isRecord(statementsCandidate)) {
      errors.push(`${path}.statements: expected object`);
    } else {
      const statements: Record<string, ActionSpec[]> = {};
      for (const [inputName, statementValue] of Object.entries(statementsCandidate)) {
        const parsedStatements = parseActionArray(statementValue, `${path}.statements.${inputName}`, errors);
        if (parsedStatements.length > 0) {
          statements[inputName] = parsedStatements;
        }
      }
      if (Object.keys(statements).length > 0) {
        parsed.statements = statements;
      }
    }
  }

  return parsed;
}

function parseAction(value: unknown, path: string, errors: string[]): ActionSpec | null {
  if (!isRecord(value)) {
    errors.push(`${path}: expected object`);
    return null;
  }

  const action = getAlias<string>(value, "action");
  if (typeof action !== "string" || !action.trim()) {
    errors.push(`${path}.action: expected non-empty string`);
    return null;
  }

  const parsed: ActionSpec = { action };

  const fieldsCandidate = getAlias<unknown>(value, "fields");
  if (fieldsCandidate !== undefined) {
    if (!isRecord(fieldsCandidate)) {
      errors.push(`${path}.fields: expected object`);
    } else {
      const fields: Record<string, Scalar> = {};
      for (const [fieldName, fieldValue] of Object.entries(fieldsCandidate)) {
        if (!isScalar(fieldValue)) {
          errors.push(`${path}.fields.${fieldName}: expected scalar`);
          continue;
        }
        fields[fieldName] = fieldValue;
      }
      if (Object.keys(fields).length > 0) {
        parsed.fields = fields;
      }
    }
  }

  const inputsCandidate = getAlias<unknown>(value, "inputs");
  if (inputsCandidate !== undefined) {
    if (!isRecord(inputsCandidate)) {
      errors.push(`${path}.inputs: expected object`);
    } else {
      const inputs: Record<string, Scalar | InputBlockSpec> = {};
      for (const [inputName, inputValue] of Object.entries(inputsCandidate)) {
        const parsedInput = parseInputLiteral(inputValue, `${path}.inputs.${inputName}`, errors);
        if (parsedInput !== null) {
          inputs[inputName] = parsedInput;
        }
      }
      if (Object.keys(inputs).length > 0) {
        parsed.inputs = inputs;
      }
    }
  }

  const statementsCandidate = getAlias<unknown>(value, "statements");
  if (statementsCandidate !== undefined) {
    if (!isRecord(statementsCandidate)) {
      errors.push(`${path}.statements: expected object`);
    } else {
      const statements: Record<string, ActionSpec[]> = {};
      for (const [inputName, statementValue] of Object.entries(statementsCandidate)) {
        const parsedStatements = parseActionArray(statementValue, `${path}.statements.${inputName}`, errors);
        if (parsedStatements.length > 0) {
          statements[inputName] = parsedStatements;
        }
      }
      if (Object.keys(statements).length > 0) {
        parsed.statements = statements;
      }
    }
  }

  return parsed;
}

function parseActionArray(value: unknown, path: string, errors: string[]): ActionSpec[] {
  if (!Array.isArray(value)) {
    errors.push(`${path}: expected array`);
    return [];
  }

  const actions: ActionSpec[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const parsed = parseAction(value[index], `${path}[${index}]`, errors);
    if (parsed) {
      actions.push(parsed);
    }
  }
  return actions;
}

function parseSemanticOp(value: unknown, index: number, errors: string[]): SemanticOp | null {
  const path = `semanticOps[${index}]`;
  if (!isRecord(value)) {
    errors.push(`${path}: expected object`);
    return null;
  }

  const op = getAlias<string>(value, "op");
  if (typeof op !== "string" || !op.trim()) {
    errors.push(`${path}.op: expected non-empty string`);
    return null;
  }

  switch (op) {
    case "create_event_flow": {
      const event = getAlias<string>(value, "event");
      if (typeof event !== "string" || !event.trim()) {
        errors.push(`${path}.event: expected non-empty string`);
        return null;
      }
      const parsed: SemanticOp = { op: "create_event_flow", event };
      const fields = getAlias<unknown>(value, "fields");
      if (fields !== undefined) {
        if (!isRecord(fields)) {
          errors.push(`${path}.fields: expected object`);
        } else {
          const nextFields: Record<string, Scalar> = {};
          for (const [fieldName, fieldValue] of Object.entries(fields)) {
            if (!isScalar(fieldValue)) {
              errors.push(`${path}.fields.${fieldName}: expected scalar`);
              continue;
            }
            nextFields[fieldName] = fieldValue;
          }
          parsed.fields = nextFields;
        }
      }
      const actions = getAlias<unknown>(value, "actions");
      if (actions !== undefined) {
        parsed.actions = parseActionArray(actions, `${path}.actions`, errors);
      }
      const rawIndex = getAlias<number>(value, "index");
      if (typeof rawIndex === "number") {
        parsed.index = Math.max(0, Math.floor(rawIndex));
      }
      return parsed;
    }
    case "append_actions": {
      const flowSelector = getAlias<unknown>(value, "flowSelector", "flow_selector");
      if (!isRecord(flowSelector)) {
        errors.push(`${path}.flowSelector: expected object`);
        return null;
      }
      const actions = parseActionArray(getAlias<unknown>(value, "actions"), `${path}.actions`, errors);
      if (actions.length === 0) {
        errors.push(`${path}.actions: requires at least one action`);
      }
      const parsedSelector: {
        eventBlockId?: string;
        eventType?: string;
        eventFieldEquals?: Record<string, string>;
        index?: number;
      } = {};
      const eventBlockId = getAlias<string>(flowSelector, "eventBlockId", "event_block_id");
      if (typeof eventBlockId === "string" && eventBlockId.trim()) {
        parsedSelector.eventBlockId = eventBlockId;
      }
      const eventType = getAlias<string>(flowSelector, "eventType", "event_type");
      if (typeof eventType === "string" && eventType.trim()) {
        parsedSelector.eventType = eventType;
      }
      const eventFieldEquals = getAlias<unknown>(flowSelector, "eventFieldEquals", "event_field_equals");
      if (eventFieldEquals !== undefined) {
        if (!isRecord(eventFieldEquals)) {
          errors.push(`${path}.flowSelector.eventFieldEquals: expected object`);
        } else {
          const parsedFields: Record<string, string> = {};
          for (const [fieldName, fieldValue] of Object.entries(eventFieldEquals)) {
            if (typeof fieldValue !== "string") {
              errors.push(`${path}.flowSelector.eventFieldEquals.${fieldName}: expected string`);
              continue;
            }
            parsedFields[fieldName] = fieldValue;
          }
          parsedSelector.eventFieldEquals = parsedFields;
        }
      }
      const selectorIndex = getAlias<number>(flowSelector, "index");
      if (typeof selectorIndex === "number") {
        parsedSelector.index = Math.max(0, Math.floor(selectorIndex));
      }
      return {
        op: "append_actions",
        flowSelector: parsedSelector,
        actions,
      };
    }
    case "replace_action": {
      const targetBlockId = getAlias<string>(value, "targetBlockId", "target_block_id");
      if (typeof targetBlockId !== "string" || !targetBlockId.trim()) {
        errors.push(`${path}.targetBlockId: expected non-empty string`);
        return null;
      }
      const actionSpec = parseAction(getAlias<unknown>(value, "action"), `${path}.action`, errors);
      if (!actionSpec) return null;
      return {
        op: "replace_action",
        targetBlockId,
        action: actionSpec,
      };
    }
    case "set_block_field": {
      const targetBlockId = getAlias<string>(value, "targetBlockId", "target_block_id");
      const field = getAlias<string>(value, "field");
      const fieldValue = getAlias<unknown>(value, "value");
      if (typeof targetBlockId !== "string" || !targetBlockId.trim()) {
        errors.push(`${path}.targetBlockId: expected non-empty string`);
        return null;
      }
      if (typeof field !== "string" || !field.trim()) {
        errors.push(`${path}.field: expected non-empty string`);
        return null;
      }
      if (!isScalar(fieldValue)) {
        errors.push(`${path}.value: expected scalar`);
        return null;
      }
      return {
        op: "set_block_field",
        targetBlockId,
        field,
        value: fieldValue,
      };
    }
    case "ensure_variable": {
      const scope = getAlias<string>(value, "scope");
      const name = getAlias<string>(value, "name");
      const variableType = getAlias<string>(value, "variableType", "variable_type");
      const defaultValue = getAlias<unknown>(value, "defaultValue", "default_value");
      if (scope !== "global" && scope !== "local") {
        errors.push(`${path}.scope: expected "global" or "local"`);
        return null;
      }
      if (typeof name !== "string" || !name.trim()) {
        errors.push(`${path}.name: expected non-empty string`);
        return null;
      }
      if (
        variableType !== "string" &&
        variableType !== "integer" &&
        variableType !== "float" &&
        variableType !== "boolean"
      ) {
        errors.push(`${path}.variableType: invalid variable type`);
        return null;
      }
      if (defaultValue !== undefined && !isScalar(defaultValue)) {
        errors.push(`${path}.defaultValue: expected scalar`);
        return null;
      }
      return {
        op: "ensure_variable",
        scope,
        name,
        variableType,
        defaultValue,
      };
    }
    case "ensure_message": {
      const name = getAlias<string>(value, "name");
      if (typeof name !== "string" || !name.trim()) {
        errors.push(`${path}.name: expected non-empty string`);
        return null;
      }
      return { op: "ensure_message", name };
    }
    case "retarget_reference": {
      const referenceKindCandidate = getAlias<string>(value, "referenceKind", "reference_kind");
      const from = getAlias<string>(value, "from");
      const to = getAlias<string>(value, "to");
      const validKinds = ["object", "scene", "sound", "message", "variable", "type"] as const;
      const referenceKind = referenceKindCandidate as (typeof validKinds)[number];
      if (!referenceKindCandidate || !validKinds.includes(referenceKind)) {
        errors.push(`${path}.referenceKind: invalid reference kind`);
        return null;
      }
      if (typeof from !== "string" || !from.trim()) {
        errors.push(`${path}.from: expected non-empty string`);
        return null;
      }
      if (typeof to !== "string" || !to.trim()) {
        errors.push(`${path}.to: expected non-empty string`);
        return null;
      }
      return {
        op: "retarget_reference",
        referenceKind,
        from,
        to,
      };
    }
    case "delete_subtree": {
      const targetBlockId = getAlias<string>(value, "targetBlockId", "target_block_id");
      if (typeof targetBlockId !== "string" || !targetBlockId.trim()) {
        errors.push(`${path}.targetBlockId: expected non-empty string`);
        return null;
      }
      return {
        op: "delete_subtree",
        targetBlockId,
      };
    }
    default: {
      errors.push(`${path}.op: unsupported op "${op}"`);
      return null;
    }
  }
}

function validateSemanticOpsPayload(value: unknown): ProposedEdits {
  if (!isRecord(value)) {
    throw new Error("Payload must be an object");
  }
  const intentSummaryRaw = getAlias<string>(value, "intentSummary", "intent_summary");
  const intentSummary = typeof intentSummaryRaw === "string" && intentSummaryRaw.trim()
    ? intentSummaryRaw.trim()
    : "No summary provided.";
  const assumptions = parseStringArray(getAlias<unknown>(value, "assumptions"));
  const semanticOpsRaw = getAlias<unknown>(value, "semanticOps", "semantic_ops");
  if (!Array.isArray(semanticOpsRaw)) {
    throw new Error("semanticOps must be an array");
  }

  const errors: string[] = [];
  const semanticOps: SemanticOp[] = [];
  for (let index = 0; index < semanticOpsRaw.length; index += 1) {
    const parsed = parseSemanticOp(semanticOpsRaw[index], index, errors);
    if (parsed) {
      semanticOps.push(parsed);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Model output validation failed: ${errors.join("; ")}`);
  }

  return { intentSummary, assumptions, semanticOps };
}

function extractResponseText(payload: OpenRouterChatCompletionResponse): string {
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part.text === "string" ? part.text : ""))
      .join("\n")
      .trim();
  }
  return "";
}

function parseJsonFromResponse(content: string): unknown {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error("Empty model response");
  }
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const rawJson = fencedMatch ? fencedMatch[1].trim() : trimmed;
  return JSON.parse(rawJson);
}

function buildAssistantTurnSystemPrompt(): string {
  return [
    "You are a Blockly assistant.",
    "Decide whether the user needs a conversational answer or a block-edit proposal.",
    "Return ONLY JSON in one of these shapes:",
    '{ "mode":"chat", "answer": string }',
    '{ "mode":"edit", "proposedEdits": { "intentSummary": string, "assumptions": string[], "semanticOps": SemanticOp[] } }',
    "Use chat mode for questions/explanations/clarifications.",
    "Use edit mode only when the user asks to create/change/remove/fix program behavior.",
    "When project details are needed (scenes, objects, properties, physics, components, block capabilities), call tools instead of guessing.",
    "Edit mode semantic op schema and rules:",
    '- create_event_flow / append_actions / replace_action / set_block_field / ensure_variable / ensure_message / retarget_reference / delete_subtree',
    "- Only use block types/field names present in capabilities/context.",
    "- Never emit explanatory text outside JSON.",
  ].join("\n");
}

function getEnv(name: string): string | undefined {
  const maybeProcess = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return maybeProcess.process?.env?.[name];
}

function validateAssistantTurnPayload(value: unknown): AssistantTurnPayload {
  if (!isRecord(value)) {
    throw new Error("Assistant turn payload must be an object");
  }

  const mode = getAlias<string>(value, "mode");
  if (mode === "chat") {
    const answerRaw = getAlias<string>(value, "answer", "chatAnswer", "chat_answer");
    if (typeof answerRaw !== "string" || !answerRaw.trim()) {
      throw new Error("Assistant chat mode requires non-empty answer");
    }
    return {
      mode: "chat",
      answer: answerRaw.trim(),
    };
  }

  if (mode === "edit") {
    const proposedEditsRaw = getAlias<unknown>(value, "proposedEdits", "proposed_edits");
    if (proposedEditsRaw === undefined) {
      throw new Error("Assistant edit mode requires proposedEdits object");
    }
    const proposedEdits = validateSemanticOpsPayload(proposedEditsRaw);
    return {
      mode: "edit",
      proposedEdits,
    };
  }

  throw new Error('Assistant turn mode must be "chat" or "edit"');
}

function getOpenRouterConfig() {
  const apiKey = getEnv("OPENROUTER_API_KEY");
  if (!apiKey || !apiKey.trim()) {
    throw new Error("Missing OPENROUTER_API_KEY in Convex environment.");
  }

  const model = (getEnv("OPENROUTER_MODEL") || "openai/gpt-5.3-codex").trim();
  const referer = getEnv("OPENROUTER_REFERER")?.trim();
  const appName = (getEnv("OPENROUTER_APP_NAME") || "PochaCoding").trim();

  return {
    apiKey: apiKey.trim(),
    model,
    referer,
    appName,
  };
}

async function sendOpenRouterChatCompletion(args: {
  model: string;
  apiKey: string;
  referer?: string;
  appName: string;
  temperature: number;
  maxTokens: number;
  messages: Array<Record<string, unknown>>;
  responseFormat?: { type: "json_object" };
  tools?: Array<Record<string, unknown>>;
  toolChoice?: "auto" | "none";
}): Promise<OpenRouterChatCompletionResponse> {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      "Content-Type": "application/json",
      ...(args.referer ? { "HTTP-Referer": args.referer } : {}),
      "X-Title": args.appName,
    },
    body: JSON.stringify({
      model: args.model,
      temperature: args.temperature,
      max_tokens: args.maxTokens,
      ...(args.responseFormat ? { response_format: args.responseFormat } : {}),
      ...(args.tools ? { tools: args.tools } : {}),
      ...(args.toolChoice ? { tool_choice: args.toolChoice } : {}),
      messages: args.messages,
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`OpenRouter request failed (${response.status}): ${truncate(errorBody, 280)}`);
  }

  return (await response.json()) as OpenRouterChatCompletionResponse;
}

function parseToolArguments(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function toBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  return fallback;
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Math.floor(toNumber(value, fallback));
  return Math.max(min, Math.min(max, numeric));
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
}

function getMaxOpsPerRequest(capabilities: unknown): number | null {
  if (!isRecord(capabilities)) return null;
  const limits = getAlias<unknown>(capabilities, "limits");
  if (!isRecord(limits)) return null;
  const maxOps = getAlias<unknown>(limits, "maxOpsPerRequest", "max_ops_per_request");
  if (typeof maxOps !== "number" || !Number.isFinite(maxOps) || maxOps <= 0) return null;
  return Math.floor(maxOps);
}

function buildAssistantToolDefinitions(): Array<Record<string, unknown>> {
  return [
    {
      type: "function",
      function: {
        name: "list_scenes",
        description: "List scenes in the current project.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_scene",
        description: "Get scene details and optionally scene objects.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            sceneId: { type: "string" },
            includeObjects: { type: "boolean" },
            includeObjectDetails: { type: "boolean" },
          },
          required: ["sceneId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_scene_objects",
        description: "List objects in a scene with key properties.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            sceneId: { type: "string" },
          },
          required: ["sceneId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_object",
        description: "Get object details including effective physics/collider and optional Blockly XML.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            objectId: { type: "string" },
            includeBlockly: { type: "boolean" },
          },
          required: ["objectId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_components",
        description: "List component definitions and instance counts.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_component",
        description: "Get component details and optional Blockly XML.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            componentId: { type: "string" },
            includeBlockly: { type: "boolean" },
          },
          required: ["componentId"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_messages",
        description: "List broadcast messages.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_global_variables",
        description: "List global variables and their types/defaults.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {},
        },
      },
    },
    {
      type: "function",
      function: {
        name: "search_blocks",
        description: "Search available block capabilities by type/fields/inputs.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            query: { type: "string" },
            limit: { type: "number" },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "get_block_type",
        description: "Get full capability details for one block type.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            blockType: { type: "string" },
          },
          required: ["blockType"],
        },
      },
    },
  ];
}

function buildSnapshotIndexes(projectSnapshot: Record<string, unknown>) {
  const scenes = Array.isArray(projectSnapshot.scenes) ? projectSnapshot.scenes.filter(isRecord) : [];
  const components = Array.isArray(projectSnapshot.components) ? projectSnapshot.components.filter(isRecord) : [];
  const messages = Array.isArray(projectSnapshot.messages) ? projectSnapshot.messages.filter(isRecord) : [];
  const globalVariables = Array.isArray(projectSnapshot.globalVariables)
    ? projectSnapshot.globalVariables.filter(isRecord)
    : [];

  const scenesById = new Map<string, Record<string, unknown>>();
  const componentsById = new Map<string, Record<string, unknown>>();
  const objectsById = new Map<string, Record<string, unknown>>();
  const objectSceneMeta = new Map<string, { sceneId: string; sceneName: string }>();
  const componentInstanceCounts = new Map<string, number>();

  for (const component of components) {
    const id = typeof component.id === "string" ? component.id : "";
    if (!id) continue;
    componentsById.set(id, component);
  }

  for (const scene of scenes) {
    const sceneId = typeof scene.id === "string" ? scene.id : "";
    if (!sceneId) continue;
    scenesById.set(sceneId, scene);
    const sceneName = typeof scene.name === "string" ? scene.name : sceneId;

    const objects = Array.isArray(scene.objects) ? scene.objects.filter(isRecord) : [];
    for (const object of objects) {
      const objectId = typeof object.id === "string" ? object.id : "";
      if (!objectId) continue;
      objectsById.set(objectId, object);
      objectSceneMeta.set(objectId, { sceneId, sceneName });
      const componentId = typeof object.componentId === "string" ? object.componentId : "";
      if (componentId) {
        componentInstanceCounts.set(componentId, (componentInstanceCounts.get(componentId) || 0) + 1);
      }
    }
  }

  return {
    scenes,
    components,
    messages,
    globalVariables,
    scenesById,
    componentsById,
    objectsById,
    objectSceneMeta,
    componentInstanceCounts,
  };
}

function executeAssistantTool(args: {
  toolName: string;
  toolArgs: Record<string, unknown>;
  projectSnapshot: Record<string, unknown>;
  capabilities: unknown;
}): Record<string, unknown> {
  const { toolName, toolArgs, projectSnapshot, capabilities } = args;
  const indexes = buildSnapshotIndexes(projectSnapshot);

  switch (toolName) {
    case "list_scenes": {
      return {
        scenes: indexes.scenes.map((scene) => {
          const objects = Array.isArray(scene.objects) ? scene.objects.filter(isRecord) : [];
          return {
            id: typeof scene.id === "string" ? scene.id : "",
            name: typeof scene.name === "string" ? scene.name : "",
            order: typeof scene.order === "number" ? scene.order : null,
            objectCount: objects.length,
            hasGround: !!scene.ground,
          };
        }),
      };
    }
    case "get_scene": {
      const sceneId = typeof toolArgs.sceneId === "string" ? toolArgs.sceneId : "";
      const includeObjects = toBoolean(toolArgs.includeObjects, true);
      const includeObjectDetails = toBoolean(toolArgs.includeObjectDetails, false);
      const scene = indexes.scenesById.get(sceneId);
      if (!scene) {
        return {
          error: `Scene not found: ${sceneId}`,
          availableSceneIds: Array.from(indexes.scenesById.keys()),
        };
      }

      const objects = Array.isArray(scene.objects) ? scene.objects.filter(isRecord) : [];
      return {
        scene: {
          id: typeof scene.id === "string" ? scene.id : "",
          name: typeof scene.name === "string" ? scene.name : "",
          order: typeof scene.order === "number" ? scene.order : null,
          ground: isRecord(scene.ground) ? scene.ground : null,
          cameraConfig: isRecord(scene.cameraConfig) ? scene.cameraConfig : null,
          objects: includeObjects
            ? objects.map((object) => {
                const componentId = typeof object.componentId === "string" ? object.componentId : null;
                const component = componentId ? indexes.componentsById.get(componentId) : null;
                const base = {
                  id: typeof object.id === "string" ? object.id : "",
                  name: typeof object.name === "string" ? object.name : "",
                  componentId,
                };
                if (!includeObjectDetails) {
                  return base;
                }
                return {
                  ...base,
                  x: typeof object.x === "number" ? object.x : null,
                  y: typeof object.y === "number" ? object.y : null,
                  visible: typeof object.visible === "boolean" ? object.visible : null,
                  rotation: typeof object.rotation === "number" ? object.rotation : null,
                  physics: (isRecord(component?.physics) ? component.physics : object.physics) || null,
                  collider: (isRecord(component?.collider) ? component.collider : object.collider) || null,
                };
              })
            : [],
        },
      };
    }
    case "list_scene_objects": {
      const sceneId = typeof toolArgs.sceneId === "string" ? toolArgs.sceneId : "";
      const scene = indexes.scenesById.get(sceneId);
      if (!scene) {
        return {
          error: `Scene not found: ${sceneId}`,
          availableSceneIds: Array.from(indexes.scenesById.keys()),
        };
      }
      const objects = Array.isArray(scene.objects) ? scene.objects.filter(isRecord) : [];
      return {
        sceneId,
        objects: objects.map((object) => {
          const componentId = typeof object.componentId === "string" ? object.componentId : null;
          const component = componentId ? indexes.componentsById.get(componentId) : null;
          return {
            id: typeof object.id === "string" ? object.id : "",
            name: typeof object.name === "string" ? object.name : "",
            componentId,
            componentName: component && typeof component.name === "string" ? component.name : null,
            x: typeof object.x === "number" ? object.x : null,
            y: typeof object.y === "number" ? object.y : null,
            visible: typeof object.visible === "boolean" ? object.visible : null,
            hasPhysics: !!((component && component.physics) || object.physics),
          };
        }),
      };
    }
    case "get_object": {
      const objectId = typeof toolArgs.objectId === "string" ? toolArgs.objectId : "";
      const includeBlockly = toBoolean(toolArgs.includeBlockly, false);
      const object = indexes.objectsById.get(objectId);
      if (!object) {
        return {
          error: `Object not found: ${objectId}`,
          availableObjectIds: Array.from(indexes.objectsById.keys()).slice(0, 120),
        };
      }
      const meta = indexes.objectSceneMeta.get(objectId) || { sceneId: "", sceneName: "" };
      const componentId = typeof object.componentId === "string" ? object.componentId : null;
      const component = componentId ? indexes.componentsById.get(componentId) : null;
      const effectivePhysics = (component && component.physics) || object.physics || null;
      const effectiveCollider = (component && component.collider) || object.collider || null;
      const effectiveLocalVariables = (component && component.localVariables) || object.localVariables || [];
      const effectiveSounds = (component && component.sounds) || object.sounds || [];
      const effectiveBlocklyXml = typeof (component && component.blocklyXml) === "string"
        ? String(component?.blocklyXml || "")
        : (typeof object.blocklyXml === "string" ? object.blocklyXml : "");
      const blocklyXml = includeBlockly ? truncateText(effectiveBlocklyXml, 12000) : undefined;
      const localVariables = Array.isArray(effectiveLocalVariables)
        ? effectiveLocalVariables.filter(isRecord).map((item) => ({
            id: typeof item.id === "string" ? item.id : "",
            name: typeof item.name === "string" ? item.name : "",
            type: typeof item.type === "string" ? item.type : "",
          }))
        : [];
      const sounds = Array.isArray(effectiveSounds)
        ? effectiveSounds.filter(isRecord).map((item) => ({
            id: typeof item.id === "string" ? item.id : "",
            name: typeof item.name === "string" ? item.name : "",
          }))
        : [];
      return {
        object: {
          id: typeof object.id === "string" ? object.id : "",
          name: typeof object.name === "string" ? object.name : "",
          sceneId: meta.sceneId,
          sceneName: meta.sceneName,
          componentId,
          componentName: component && typeof component.name === "string" ? component.name : null,
          x: typeof object.x === "number" ? object.x : null,
          y: typeof object.y === "number" ? object.y : null,
          visible: typeof object.visible === "boolean" ? object.visible : null,
          rotation: typeof object.rotation === "number" ? object.rotation : null,
          scaleX: typeof object.scaleX === "number" ? object.scaleX : null,
          scaleY: typeof object.scaleY === "number" ? object.scaleY : null,
          physics: isRecord(effectivePhysics) ? effectivePhysics : null,
          collider: isRecord(effectiveCollider) ? effectiveCollider : null,
          localVariables,
          sounds,
          blocklyXml,
          blocklyXmlLength: effectiveBlocklyXml.length,
        },
      };
    }
    case "list_components": {
      return {
        components: indexes.components.map((component) => {
          const componentId = typeof component.id === "string" ? component.id : "";
          const localVariables = Array.isArray(component.localVariables) ? component.localVariables : [];
          const sounds = Array.isArray(component.sounds) ? component.sounds : [];
          return {
            id: componentId,
            name: typeof component.name === "string" ? component.name : "",
            instanceCount: indexes.componentInstanceCounts.get(componentId) || 0,
            hasPhysics: !!component.physics,
            localVariableCount: localVariables.length,
            soundCount: sounds.length,
          };
        }),
      };
    }
    case "get_component": {
      const componentId = typeof toolArgs.componentId === "string" ? toolArgs.componentId : "";
      const includeBlockly = toBoolean(toolArgs.includeBlockly, false);
      const component = indexes.componentsById.get(componentId);
      if (!component) {
        return {
          error: `Component not found: ${componentId}`,
          availableComponentIds: Array.from(indexes.componentsById.keys()),
        };
      }
      const localVariables = Array.isArray(component.localVariables)
        ? component.localVariables.filter(isRecord).map((item) => ({
            id: typeof item.id === "string" ? item.id : "",
            name: typeof item.name === "string" ? item.name : "",
            type: typeof item.type === "string" ? item.type : "",
          }))
        : [];
      const sounds = Array.isArray(component.sounds)
        ? component.sounds.filter(isRecord).map((item) => ({
            id: typeof item.id === "string" ? item.id : "",
            name: typeof item.name === "string" ? item.name : "",
          }))
        : [];
      const componentBlocklyXml = typeof component.blocklyXml === "string" ? component.blocklyXml : "";
      return {
        component: {
          id: typeof component.id === "string" ? component.id : "",
          name: typeof component.name === "string" ? component.name : "",
          instanceCount: indexes.componentInstanceCounts.get(componentId) || 0,
          physics: isRecord(component.physics) ? component.physics : null,
          collider: isRecord(component.collider) ? component.collider : null,
          localVariables,
          sounds,
          blocklyXml: includeBlockly ? truncateText(componentBlocklyXml, 12000) : undefined,
          blocklyXmlLength: componentBlocklyXml.length,
        },
      };
    }
    case "list_messages": {
      return {
        messages: indexes.messages.map((message) => ({
          id: typeof message.id === "string" ? message.id : "",
          name: typeof message.name === "string" ? message.name : "",
        })),
      };
    }
    case "list_global_variables": {
      return {
        globalVariables: indexes.globalVariables.map((variable) => ({
          id: typeof variable.id === "string" ? variable.id : "",
          name: typeof variable.name === "string" ? variable.name : "",
          type: typeof variable.type === "string" ? variable.type : "",
          defaultValue: variable.defaultValue ?? null,
        })),
      };
    }
    case "search_blocks": {
      const query = typeof toolArgs.query === "string" ? toolArgs.query.trim().toLowerCase() : "";
      const limit = toBoundedInteger(toolArgs.limit, 10, 1, 30);
      const capabilityBlocks =
        isRecord(capabilities) && Array.isArray(capabilities.blocks)
          ? capabilities.blocks.filter(isRecord)
          : [];

      const scored = capabilityBlocks
        .map((block) => {
          const blockType = typeof block.type === "string" ? block.type : "";
          const fields = Array.isArray(block.fields) ? block.fields.filter(isRecord) : [];
          const inputs = Array.isArray(block.inputs) ? block.inputs.filter(isRecord) : [];
          const haystack = [
            blockType,
            ...fields.flatMap((field) => [
              typeof field.name === "string" ? field.name : "",
              typeof field.kind === "string" ? field.kind : "",
            ]),
            ...inputs.flatMap((input) => [
              typeof input.name === "string" ? input.name : "",
              ...(Array.isArray(input.checks) ? input.checks.filter((check): check is string => typeof check === "string") : []),
            ]),
          ]
            .join(" ")
            .toLowerCase();

          const score = query
            ? (haystack.includes(query) ? 1 : 0)
            : 1;

          return {
            score,
            blockType,
            fields,
            inputs,
          };
        })
        .filter((entry) => entry.score > 0)
        .slice(0, limit)
        .map((entry) => ({
          type: entry.blockType,
          fields: entry.fields.slice(0, 8).map((field) => ({
            name: typeof field.name === "string" ? field.name : "",
            kind: typeof field.kind === "string" ? field.kind : "",
          })),
          inputs: entry.inputs.slice(0, 8).map((input) => ({
            name: typeof input.name === "string" ? input.name : "",
            kind: typeof input.kind === "string" ? input.kind : "",
            checks: Array.isArray(input.checks)
              ? input.checks.filter((check): check is string => typeof check === "string")
              : [],
          })),
        }));

      return {
        query,
        matches: scored,
      };
    }
    case "get_block_type": {
      const blockType = typeof toolArgs.blockType === "string" ? toolArgs.blockType : "";
      const byType =
        isRecord(capabilities) && isRecord(capabilities.byType)
          ? capabilities.byType
          : {};
      const entry = isRecord(byType) && isRecord(byType[blockType])
        ? byType[blockType]
        : null;
      if (!entry) {
        const blockTypes =
          isRecord(capabilities) && Array.isArray(capabilities.blocks)
            ? capabilities.blocks
              .filter(isRecord)
              .map((block) => (typeof block.type === "string" ? block.type : ""))
              .filter((value) => value.length > 0)
              .slice(0, 200)
            : [];
        return {
          error: `Unknown block type: ${blockType}`,
          availableBlockTypesSample: blockTypes,
        };
      }
      return {
        block: entry,
      };
    }
    default:
      return {
        error: `Unknown tool: ${toolName}`,
      };
  }
}

export const assistantTurn = action({
  args: {
    userIntent: v.string(),
    chatHistory: v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
    })),
    capabilities: v.any(),
    context: v.any(),
    programRead: v.any(),
    projectSnapshot: v.any(),
  },
  returns: assistantTurnReturnValidator,
  handler: async (_ctx, args) => {
    const { apiKey, model, referer, appName } = getOpenRouterConfig();

    const recentTurns = args.chatHistory
      .filter((turn) => (turn.role === "user" || turn.role === "assistant") && !!turn.content.trim())
      .slice(-16)
      .map((turn): ChatHistoryTurn => ({
        role: turn.role,
        content: truncate(turn.content.trim(), 1800),
      }));
    const projectSnapshot = isRecord(args.projectSnapshot) ? args.projectSnapshot : {};
    const tools = buildAssistantToolDefinitions();
    const messages: Array<Record<string, unknown>> = [
      {
        role: "system",
        content: buildAssistantTurnSystemPrompt(),
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            task: "Classify and handle Blockly assistant turn",
            context: args.context,
            programRead: args.programRead,
            capabilities: args.capabilities,
            toolingHint: "Use tools to fetch project entities/properties before finalizing answer.",
          },
          null,
          2,
        ),
      },
      ...recentTurns.map((turn) => ({
        role: turn.role,
        content: turn.content,
      })),
      {
        role: "user",
        content: args.userIntent,
      },
    ];

    const maxToolRounds = 8;
    let turn: AssistantTurnPayload | null = null;
    let lastValidationError: string | null = null;
    const maxOpsPerRequest = getMaxOpsPerRequest(args.capabilities);
    const debugTrace: {
      maxToolRounds: number;
      modelRounds: number;
      toolCalls: Array<{
        round: number;
        name: string;
        args: Record<string, unknown>;
        resultPreview: string;
      }>;
      validationErrors: string[];
      finalResponsePreview: string | null;
    } = {
      maxToolRounds,
      modelRounds: 0,
      toolCalls: [],
      validationErrors: [],
      finalResponsePreview: null,
    };

    for (let round = 0; round < maxToolRounds; round += 1) {
      debugTrace.modelRounds += 1;
      const payload = await sendOpenRouterChatCompletion({
        model,
        apiKey,
        referer,
        appName,
        temperature: 0.2,
        maxTokens: 1800,
        responseFormat: {
          type: "json_object",
        },
        tools,
        toolChoice: "auto",
        messages,
      });

      const message = payload.choices?.[0]?.message;
      const toolCalls = Array.isArray(message?.tool_calls) ? message.tool_calls : [];
      if (toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: typeof message?.content === "string" ? message.content : "",
          tool_calls: toolCalls,
        });

        for (let index = 0; index < toolCalls.length; index += 1) {
          const toolCall = toolCalls[index];
          const toolName = typeof toolCall.function?.name === "string" ? toolCall.function.name : "";
          const parsedToolArgs = parseToolArguments(toolCall.function?.arguments);
          const toolResult = executeAssistantTool({
            toolName,
            toolArgs: parsedToolArgs,
            projectSnapshot,
            capabilities: args.capabilities,
          });
          debugTrace.toolCalls.push({
            round,
            name: toolName || "unknown_tool",
            args: parsedToolArgs,
            resultPreview: truncateText(JSON.stringify(toolResult), 800),
          });
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id || `tool_call_${round}_${index}`,
            name: toolName || "unknown_tool",
            content: JSON.stringify(toolResult),
          });
        }
        continue;
      }

      const content = extractResponseText(payload);
      debugTrace.finalResponsePreview = truncateText(content, 4000);
      try {
        const parsed = parseJsonFromResponse(content);
        const candidateTurn = validateAssistantTurnPayload(parsed);

        if (
          candidateTurn.mode === "edit" &&
          typeof maxOpsPerRequest === "number" &&
          candidateTurn.proposedEdits.semanticOps.length > maxOpsPerRequest
        ) {
          throw new Error(
            `Too many semantic ops (${candidateTurn.proposedEdits.semanticOps.length}/${maxOpsPerRequest}).`
          );
        }

        turn = candidateTurn;
        break;
      } catch (error) {
        const validationError = error instanceof Error ? error.message : "Unknown validation failure";
        lastValidationError = validationError;
        debugTrace.validationErrors.push(validationError);
        messages.push({
          role: "user",
          content: JSON.stringify(
            {
              repair: "Previous response invalid",
              error: validationError,
              instruction:
                "Return corrected JSON now. If you cannot safely produce a valid edit payload, return mode='chat' with an explanation.",
            },
            null,
            2,
          ),
        });
        continue;
      }
    }

    if (!turn) {
      return {
        provider: "openrouter",
        model,
        mode: "chat" as const,
        answer:
          "I could not produce a valid structured response for this request. Please rephrase or ask in smaller steps."
          + (lastValidationError ? `\n\nValidation issue: ${lastValidationError}` : ""),
        debugTrace,
      };
    }

    if (turn.mode === "chat") {
      return {
        provider: "openrouter",
        model,
        mode: "chat" as const,
        answer: turn.answer,
        debugTrace,
      };
    }

    return {
      provider: "openrouter",
      model,
      mode: "edit" as const,
      proposedEdits: {
        intentSummary: turn.proposedEdits.intentSummary,
        assumptions: turn.proposedEdits.assumptions,
        semanticOps: turn.proposedEdits.semanticOps,
      },
      debugTrace,
    };
  },
});
