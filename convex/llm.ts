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

type OpenRouterChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
  }>;
};

const proposedEditsReturnValidator = v.object({
  provider: v.string(),
  model: v.string(),
  proposedEdits: v.object({
    intentSummary: v.string(),
    assumptions: v.array(v.string()),
    semanticOps: v.array(v.any()),
  }),
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

function buildSystemPrompt(): string {
  return [
    "You are a Blockly coding planner.",
    "Return ONLY JSON with shape:",
    '{ "intentSummary": string, "assumptions": string[], "semanticOps": SemanticOp[] }',
    "Allowed semantic op objects:",
    '- { "op":"create_event_flow", "event":string, "fields"?:Record<string,string|number|boolean>, "actions"?:ActionSpec[] }',
    '- { "op":"append_actions", "flowSelector":{"eventBlockId"?:string,"eventType"?:string,"eventFieldEquals"?:Record<string,string>,"index"?:number}, "actions":ActionSpec[] }',
    '- { "op":"replace_action", "targetBlockId":string, "action":ActionSpec }',
    '- { "op":"set_block_field", "targetBlockId":string, "field":string, "value":string|number|boolean }',
    '- { "op":"ensure_variable", "scope":"global"|"local", "name":string, "variableType":"string"|"integer"|"float"|"boolean", "defaultValue"?:string|number|boolean }',
    '- { "op":"ensure_message", "name":string }',
    '- { "op":"retarget_reference", "referenceKind":"object"|"scene"|"sound"|"message"|"variable"|"type", "from":string, "to":string }',
    '- { "op":"delete_subtree", "targetBlockId":string }',
    "ActionSpec format:",
    '{ "action": string, "fields"?: Record<string,scalar>, "inputs"?: Record<string, scalar|InputBlockSpec>, "statements"?: Record<string, ActionSpec[]> }',
    "InputBlockSpec format:",
    '{ "block": string, "fields"?: Record<string,scalar>, "inputs"?: Record<string, scalar|InputBlockSpec>, "statements"?: Record<string, ActionSpec[]> }',
    "Rules:",
    "- Use existing block IDs only when modifying existing blocks.",
    "- Prefer create_event_flow + append_actions for additive changes.",
    "- Only use block types/field names present in capabilities/context.",
    "- Never emit explanatory text outside JSON.",
  ].join("\n");
}

function getEnv(name: string): string | undefined {
  const maybeProcess = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return maybeProcess.process?.env?.[name];
}

export const proposeEdits = action({
  args: {
    userIntent: v.string(),
    capabilities: v.any(),
    context: v.any(),
    programRead: v.any(),
  },
  returns: proposedEditsReturnValidator,
  handler: async (_ctx, args) => {
    const apiKey = getEnv("OPENROUTER_API_KEY");
    if (!apiKey || !apiKey.trim()) {
      throw new Error("Missing OPENROUTER_API_KEY in Convex environment.");
    }

    const model = (getEnv("OPENROUTER_MODEL") || "openai/gpt-5.3-codex").trim();
    const referer = getEnv("OPENROUTER_REFERER")?.trim();
    const appName = (getEnv("OPENROUTER_APP_NAME") || "PochaCoding").trim();

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`,
        "Content-Type": "application/json",
        ...(referer ? { "HTTP-Referer": referer } : {}),
        "X-Title": appName,
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        max_tokens: 1800,
        response_format: {
          type: "json_object",
        },
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(),
          },
          {
            role: "user",
            content: JSON.stringify(
              {
                task: "Propose semantic ops for Blockly edit request",
                userIntent: args.userIntent,
                context: args.context,
                programRead: args.programRead,
                capabilities: args.capabilities,
                outputReminder: {
                  format: "JSON only",
                  rootKeys: ["intentSummary", "assumptions", "semanticOps"],
                },
              },
              null,
              2,
            ),
          },
        ],
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      throw new Error(`OpenRouter request failed (${response.status}): ${truncate(errorBody, 280)}`);
    }

    const payload = (await response.json()) as OpenRouterChatCompletionResponse;
    const content = extractResponseText(payload);
    const parsed = parseJsonFromResponse(content);
    const proposedEdits = validateSemanticOpsPayload(parsed);

    let maxOpsRaw: number | undefined;
    if (isRecord(args.capabilities)) {
      const limitsCandidate = getAlias<unknown>(args.capabilities, "limits");
      if (isRecord(limitsCandidate)) {
        const maxOpsCandidate = getAlias<unknown>(limitsCandidate, "maxOpsPerRequest", "max_ops_per_request");
        if (typeof maxOpsCandidate === "number") {
          maxOpsRaw = maxOpsCandidate;
        }
      }
    }
    if (typeof maxOpsRaw === "number" && proposedEdits.semanticOps.length > maxOpsRaw) {
      throw new Error(`Model proposed too many operations (${proposedEdits.semanticOps.length}/${maxOpsRaw}).`);
    }

    return {
      provider: "openrouter",
      model,
      proposedEdits: {
        intentSummary: proposedEdits.intentSummary,
        assumptions: proposedEdits.assumptions,
        semanticOps: proposedEdits.semanticOps,
      },
    };
  },
});
