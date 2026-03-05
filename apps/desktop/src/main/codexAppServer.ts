import { shell } from 'electron';
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import codexTurnOutputSchema from './codexTurnOutput.schema.json';
import { runUnifiedAssistantTurn } from '../../../../packages/assistant-core/src';
import { validateSemanticOpsPayload } from '../../../../packages/assistant-core/src/semanticOps';
import type {
  CodexAssistantTurnRequest,
  CodexAssistantTurnResponse,
  CodexAuthMethod,
  ProviderEventPayload,
} from '../shared/provider';

type JsonRpcId = number | string;

type JsonRpcResponse = {
  id: JsonRpcId;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
    data?: unknown;
  };
};

type JsonRpcNotification = {
  method: string;
  params?: unknown;
};

type JsonRpcServerRequest = {
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

type CodexAuthStatusResult = {
  authMethod: string | null;
  authToken: string | null;
  requiresOpenaiAuth: boolean | null;
};

type CodexAccountReadResult = {
  account: { type: string; email?: string; planType?: string } | null;
  requiresOpenaiAuth: boolean;
};

type CodexLoginResponse = {
  type?: string;
  loginId?: string;
  authUrl?: string;
};

type CodexStatusSnapshot = {
  available: boolean;
  hasToken: boolean;
  authMethod: CodexAuthMethod;
  email: string | null;
  planType: string | null;
  loginInProgress: boolean;
  statusMessage: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeAuthMethod(value: string | null): CodexAuthMethod {
  if (!value) return null;
  if (value === 'chatgpt') return 'chatgpt';
  if (value === 'api-key' || value === 'api_key') return 'api_key';
  return 'unknown';
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split('.');
  if (parts.length < 2) return null;
  const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=');
  try {
    const decoded = Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function extractAccountHintsFromToken(token: string): { accountId: string | null; planType: string | null } {
  const payload = decodeJwtPayload(token);
  if (!payload) {
    return { accountId: null, planType: null };
  }
  const authClaims = payload['https://api.openai.com/auth'];
  if (!isRecord(authClaims)) {
    return { accountId: null, planType: null };
  }
  const accountId = typeof authClaims.chatgpt_account_id === 'string' ? authClaims.chatgpt_account_id : null;
  const planType = typeof authClaims.chatgpt_plan_type === 'string' ? authClaims.chatgpt_plan_type : null;
  return { accountId, planType };
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-9;]*[A-Za-z]/g, '');
}

function truncateText(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function normalizeTraceLine(value: string): string {
  return truncateText(stripAnsi(value).replace(/\s+/g, ' ').trim(), 320);
}

function previewValue(value: unknown, maxChars: number): string | null {
  try {
    const raw = typeof value === 'string' ? value : JSON.stringify(value);
    const normalized = raw.replace(/\s+/g, ' ').trim();
    return normalized.length > 0 ? truncateText(normalized, maxChars) : null;
  } catch {
    return null;
  }
}

function validateCodexOutputSchema(schema: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(schema)) {
    return ['schema must be an object'];
  }

  const propertiesValue = schema.properties;
  if (!isRecord(propertiesValue)) {
    errors.push('schema.properties must be an object');
    return errors;
  }
  const propertyKeys = Object.keys(propertiesValue);
  if (propertyKeys.length === 0) {
    errors.push('schema.properties must declare at least one key');
  }

  const requiredValue = schema.required;
  if (!Array.isArray(requiredValue)) {
    errors.push('schema.required must be an array');
    return errors;
  }
  const requiredKeys = requiredValue.filter((value): value is string => typeof value === 'string');
  if (requiredKeys.length !== requiredValue.length) {
    errors.push('schema.required must contain only strings');
    return errors;
  }

  const requiredSet = new Set(requiredKeys);
  const missingRequired = propertyKeys.filter((key) => !requiredSet.has(key));
  if (missingRequired.length > 0) {
    errors.push(`schema.required is missing property keys: ${missingRequired.join(', ')}`);
  }
  const unknownRequired = requiredKeys.filter((key) => !Object.prototype.hasOwnProperty.call(propertiesValue, key));
  if (unknownRequired.length > 0) {
    errors.push(`schema.required has unknown keys: ${unknownRequired.join(', ')}`);
  }
  return errors;
}

function canExecuteCodexBinary(candidate: string): boolean {
  try {
    const result = spawnSync(candidate, ['--version'], {
      stdio: 'ignore',
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function resolveCodexExecutable(): string {
  const envOverride = process.env.POCHACODING_CODEX_BIN?.trim();
  if (envOverride) {
    return envOverride;
  }

  const homeDir = process.env.HOME || '';
  const pathCandidates = [
    '/Applications/Codex.app/Contents/Resources/codex',
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    homeDir ? path.join(homeDir, '.local/bin/codex') : '',
    homeDir ? path.join(homeDir, 'Library/pnpm/codex') : '',
  ].filter((value) => value.length > 0);

  for (const candidate of pathCandidates) {
    if (existsSync(candidate) && canExecuteCodexBinary(candidate)) {
      return candidate;
    }
  }

  if (canExecuteCodexBinary('codex')) {
    return 'codex';
  }
  return 'codex';
}

const CODEX_TURN_OUTPUT_SCHEMA = codexTurnOutputSchema as Record<string, unknown>;
const codexSchemaErrors = validateCodexOutputSchema(CODEX_TURN_OUTPUT_SCHEMA);
if (codexSchemaErrors.length > 0) {
  throw new Error(`Invalid codex output schema: ${codexSchemaErrors.join('; ')}`);
}

function buildCodexAssistantPrompt(args: CodexAssistantTurnRequest): string {
  const envelope = {
    task: 'Classify and handle Blockly assistant turn',
    outputContract: {
      mode: 'chat|edit',
      chat: 'Provide answer',
      edit: 'Provide proposedEditsJson stringified JSON with intentSummary, assumptions[], semanticOps[], projectOps[]',
    },
    rules: [
      'If the user is asking a question or clarification, choose mode=chat.',
      'If the user is asking for Blockly or project changes, choose mode=edit.',
      'If the user is discussing capabilities/planning/tooling (not requesting concrete project changes now), choose mode=chat.',
      'Use capabilities as strict source of truth for available blocks/actions.',
      'Do not use deprecated blocks. If unsupported, explain with mode=chat.',
      'When mode=edit, proposedEditsJson must be valid JSON and include BOTH semanticOps and projectOps arrays.',
      'Put Blockly code operations ONLY in semanticOps. Put scene/object/costume/project operations ONLY in projectOps.',
      'Never output placeholder/template operations. Do not emit empty strings for required IDs/names.',
      'If required scene/object/costume references are not available, choose mode=chat and ask a concise follow-up.',
      'Allowed projectOps: rename_project, create_scene, rename_scene, reorder_scenes, create_object, rename_object, set_object_property, set_object_physics, set_object_collider_type, create_folder, rename_folder, move_object_to_folder, add_costume_from_image_url, add_costume_text_circle, rename_costume, reorder_costumes, set_current_costume, validate_project.',
      'When mode=chat, put your response in answer and set proposedEditsJson=null.',
      'When mode=edit, set answer=null and put JSON string in proposedEditsJson.',
      'Do not include markdown fences in any field.',
    ],
    userIntent: args.userIntent,
    chatHistory: args.chatHistory.slice(-16),
    context: args.context,
    programRead: args.programRead,
    capabilities: args.capabilities,
    threadContext: args.threadContext ?? null,
  };

  return [
    'You are PochaCoding Blockly assistant.',
    'Return a JSON object matching the output schema.',
    JSON.stringify(envelope, null, 2),
  ].join('\n\n');
}

function shouldFallbackToCodexExecFromUnifiedTurn(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.mode !== 'chat') return false;

  const errorCode = typeof value.errorCode === 'string' ? value.errorCode : '';
  if (errorCode !== 'assistant_transport_error') {
    return false;
  }

  const answer = typeof value.answer === 'string' ? value.answer.toLowerCase() : '';
  if (answer.includes('missing scopes: model.request') || answer.includes('insufficient permissions')) {
    return true;
  }

  if (isRecord(value.debugTrace) && Array.isArray(value.debugTrace.validationErrors)) {
    const joined = value.debugTrace.validationErrors
      .map((entry) => (typeof entry === 'string' ? entry.toLowerCase() : ''))
      .join('\n');
    if (joined.includes('model.request') || joined.includes('insufficient permissions')) {
      return true;
    }
  }

  return false;
}

const PROJECT_OPS = new Set([
  'rename_project',
  'create_scene',
  'rename_scene',
  'reorder_scenes',
  'create_object',
  'rename_object',
  'set_object_property',
  'set_object_physics',
  'set_object_collider_type',
  'create_folder',
  'rename_folder',
  'move_object_to_folder',
  'add_costume_from_image_url',
  'add_costume_text_circle',
  'rename_costume',
  'reorder_costumes',
  'set_current_costume',
  'validate_project',
]);

const PROJECT_OP_ALIASES: Record<string, string> = {
  add_svg_text_costume: 'add_costume_text_circle',
  add_text_costume: 'add_costume_text_circle',
  create_text_costume: 'add_costume_text_circle',
  add_image_costume: 'add_costume_from_image_url',
  add_costume_from_image: 'add_costume_from_image_url',
  import_image_costume: 'add_costume_from_image_url',
  set_physics: 'set_object_physics',
  set_collider_type: 'set_object_collider_type',
};

function normalizeProjectOpName(op: string): string {
  const trimmed = op.trim();
  if (!trimmed) return trimmed;
  return PROJECT_OP_ALIASES[trimmed] ?? trimmed;
}

function normalizeProjectOpFields(value: Record<string, unknown>): Record<string, unknown> {
  const opName = typeof value.op === 'string' ? normalizeProjectOpName(value.op) : '';
  const next: Record<string, unknown> = {
    ...value,
    ...(opName ? { op: opName } : {}),
  };

  if (opName === 'add_costume_text_circle') {
    if (typeof next.text !== 'string' || !next.text.trim()) {
      const aliasText = [next.svgText, next.svg_text, next.label, next.content].find(
        (candidate) => typeof candidate === 'string' && candidate.trim().length > 0,
      ) as string | undefined;
      if (aliasText) {
        next.text = aliasText;
      }
    }
  }

  if (opName === 'add_costume_from_image_url') {
    if (typeof next.imageUrl !== 'string' || !next.imageUrl.trim()) {
      const aliasUrl = [next.url, next.image, next.src].find(
        (candidate) => typeof candidate === 'string' && candidate.trim().length > 0,
      ) as string | undefined;
      if (aliasUrl) {
        next.imageUrl = aliasUrl;
      }
    }
  }

  if (opName === 'set_object_collider_type') {
    if (typeof next.colliderType !== 'string' || !next.colliderType.trim()) {
      const aliasType = [next.type, next.collider].find(
        (candidate) => typeof candidate === 'string' && candidate.trim().length > 0,
      ) as string | undefined;
      if (aliasType) {
        next.colliderType = aliasType;
      }
    }
  }

  return next;
}

function normalizeProposedEditsShape(raw: unknown): {
  value: unknown;
  movedProjectOpsFromSemantic: number;
  renamedProjectOps: number;
} {
  if (!isRecord(raw)) {
    return {
      value: raw,
      movedProjectOpsFromSemantic: 0,
      renamedProjectOps: 0,
    };
  }

  const semanticRaw = Array.isArray(raw.semanticOps) ? raw.semanticOps : [];
  const projectRaw = Array.isArray(raw.projectOps) ? raw.projectOps : [];

  let movedProjectOpsFromSemantic = 0;
  let renamedProjectOps = 0;

  const normalizedSemantic: unknown[] = [];
  const normalizedProject: unknown[] = [];

  for (const entry of semanticRaw) {
    if (!isRecord(entry) || typeof entry.op !== 'string') {
      normalizedSemantic.push(entry);
      continue;
    }
    const normalizedName = normalizeProjectOpName(entry.op);
    if (normalizedName !== entry.op) {
      renamedProjectOps += 1;
    }
    if (PROJECT_OPS.has(normalizedName)) {
      movedProjectOpsFromSemantic += 1;
      normalizedProject.push(normalizeProjectOpFields(entry));
      continue;
    }
    normalizedSemantic.push(entry);
  }

  for (const entry of projectRaw) {
    if (!isRecord(entry) || typeof entry.op !== 'string') {
      normalizedProject.push(entry);
      continue;
    }
    const normalizedName = normalizeProjectOpName(entry.op);
    if (normalizedName !== entry.op) {
      renamedProjectOps += 1;
    }
    normalizedProject.push(normalizeProjectOpFields(entry));
  }

  return {
    value: {
      ...raw,
      semanticOps: normalizedSemantic,
      projectOps: normalizedProject,
    },
    movedProjectOpsFromSemantic,
    renamedProjectOps,
  };
}

function buildInvalidEditFallback(args: {
  reason: string;
  exitCode: number;
  stderr: string;
  validationErrors?: string[];
}): CodexAssistantTurnResponse {
  const details = args.validationErrors && args.validationErrors.length > 0
    ? `\n\nValidation: ${args.validationErrors.slice(0, 4).join('; ')}${args.validationErrors.length > 4 ? '; ...' : ''}`
    : '';
  return {
    provider: 'codex',
    model: 'gpt-5.3-codex',
    mode: 'chat',
    answer: `I couldn't apply executable edits this turn because the edit payload was invalid (${args.reason}). Please retry with concrete scene/object names or IDs.${details}`,
    debugTrace: {
      transport: 'codex-exec',
      exitCode: args.exitCode,
      stderrTail: args.stderr.slice(-1200),
      fallbackReason: args.reason,
      validationErrors: args.validationErrors ?? [],
    },
  };
}

type TurnEventEmitter = (payload: Omit<ProviderEventPayload, 'threadId' | 'scopeKey' | 'turnId' | 'sequence' | 'timestamp'>) => void;

function createTurnEventEmitter(
  emitEvent: (payload: ProviderEventPayload) => void,
  threadContext?: { threadId?: string; scopeKey?: string } | null,
): TurnEventEmitter {
  const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let sequence = 0;

  return (payload) => {
    sequence += 1;
    emitEvent({
      ...payload,
      threadId: threadContext?.threadId ?? null,
      scopeKey: threadContext?.scopeKey ?? null,
      turnId,
      sequence,
      timestamp: new Date().toISOString(),
    });
  };
}

function emitTraceDetails(emitTurnEvent: TurnEventEmitter, trace: unknown): void {
  if (!isRecord(trace)) return;

  if (typeof trace.transport === 'string' && trace.transport.trim()) {
    emitTurnEvent({
      type: 'assistant-turn-progress',
      phase: 'transport',
      message: `Transport: ${trace.transport.trim()}`,
    });
  }

  if (typeof trace.modelRounds === 'number') {
    emitTurnEvent({
      type: 'assistant-turn-progress',
      phase: 'model',
      message: `Model rounds: ${trace.modelRounds}`,
    });
  }

  if (typeof trace.maxToolRounds === 'number') {
    emitTurnEvent({
      type: 'assistant-turn-progress',
      phase: 'model',
      message: `Max tool rounds: ${trace.maxToolRounds}`,
    });
  }

  if (Array.isArray(trace.toolCalls)) {
    trace.toolCalls
      .filter(isRecord)
      .forEach((call, index) => {
        const name = typeof call.name === 'string' && call.name.trim().length > 0 ? call.name.trim() : 'unknown_tool';
        const round = typeof call.round === 'number' ? `round ${call.round}` : `step ${index + 1}`;
        const argsPreview = previewValue(call.args, 220);
        const resultPreview = previewValue(call.resultPreview, 260);
        emitTurnEvent({
          type: 'assistant-turn-progress',
          phase: 'tool',
          message: `Tool call [${round}] ${name}${argsPreview ? ` args=${argsPreview}` : ''}`,
          detail: resultPreview ? `result=${resultPreview}` : null,
        });
      });
  }

  if (Array.isArray(trace.validationErrors)) {
    trace.validationErrors
      .filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      .forEach((entry) => {
        emitTurnEvent({
          type: 'assistant-turn-progress',
          phase: 'validation',
          message: `Validation: ${entry.trim()}`,
        });
      });
  }

  const fallbackReason =
    typeof trace.fallbackReason === 'string' && trace.fallbackReason.trim()
      ? trace.fallbackReason.trim()
      : (typeof trace.fallbackReasonCode === 'string' && trace.fallbackReasonCode.trim()
          ? trace.fallbackReasonCode.trim()
          : null);
  if (fallbackReason) {
    emitTurnEvent({
      type: 'assistant-turn-progress',
      phase: 'fallback',
      message: `Fallback reason: ${fallbackReason}`,
    });
  }

  if (typeof trace.finalVerdict === 'string' && trace.finalVerdict.trim()) {
    emitTurnEvent({
      type: 'assistant-turn-progress',
      phase: 'result',
      message: `Final verdict: ${trace.finalVerdict.trim()}`,
    });
  }

  if (typeof trace.finalResponsePreview === 'string' && trace.finalResponsePreview.trim()) {
    emitTurnEvent({
      type: 'assistant-turn-progress',
      phase: 'result',
      message: 'Raw model output preview',
      detail: truncateText(trace.finalResponsePreview.replace(/\s+/g, ' ').trim(), 420),
    });
  }
}

export class CodexAppServerClient {
  private process: ChildProcessWithoutNullStreams | null = null;
  private startPromise: Promise<void> | null = null;
  private initialized = false;
  private nextRequestId = 1;
  private outputBuffer = '';
  private pending = new Map<string, PendingRequest>();
  private loginInProgress = false;
  private pendingLoginId: string | null = null;
  private statusMessage: string | null = null;
  private readonly codexExecutable = resolveCodexExecutable();

  constructor(
    private readonly clientInfo: { name: string; title: string; version: string },
    private readonly emitEvent: (payload: ProviderEventPayload) => void,
  ) {}

  async getStatus(): Promise<CodexStatusSnapshot> {
    try {
      await this.ensureStarted();
    } catch (error) {
      return {
        available: false,
        hasToken: false,
        authMethod: null,
        email: null,
        planType: null,
        loginInProgress: false,
        statusMessage: toErrorMessage(error),
      };
    }

    try {
      const [authStatus, accountStatus] = await Promise.all([
        this.request<CodexAuthStatusResult>('getAuthStatus', {
          includeToken: true,
          refreshToken: false,
        }),
        this.request<CodexAccountReadResult>('account/read', {
          refreshToken: false,
        }),
      ]);

      const account = isRecord(accountStatus.account) ? accountStatus.account : null;
      const email = account && typeof account.email === 'string' ? account.email : null;
      const planType = account && typeof account.planType === 'string' ? account.planType : null;
      const hasToken = typeof authStatus.authToken === 'string' && authStatus.authToken.trim().length > 0;
      const statusMessage =
        this.statusMessage
        || (this.loginInProgress ? 'Waiting for ChatGPT login completion...' : null);

      return {
        available: true,
        hasToken,
        authMethod: normalizeAuthMethod(typeof authStatus.authMethod === 'string' ? authStatus.authMethod : null),
        email,
        planType,
        loginInProgress: this.loginInProgress,
        statusMessage,
      };
    } catch (error) {
      return {
        available: true,
        hasToken: false,
        authMethod: null,
        email: null,
        planType: null,
        loginInProgress: this.loginInProgress,
        statusMessage: toErrorMessage(error),
      };
    }
  }

  async getAuthToken(): Promise<string | null> {
    try {
      await this.ensureStarted();
      const authStatus = await this.request<CodexAuthStatusResult>('getAuthStatus', {
        includeToken: true,
        refreshToken: true,
      });
      if (typeof authStatus.authToken !== 'string' || !authStatus.authToken.trim()) {
        return null;
      }
      return authStatus.authToken.trim();
    } catch {
      return null;
    }
  }

  async runAssistantTurn(args: CodexAssistantTurnRequest): Promise<CodexAssistantTurnResponse> {
    const emitTurnEvent = createTurnEventEmitter(this.emitEvent, args.threadContext ?? null);
    emitTurnEvent({
      type: 'assistant-turn-started',
      phase: 'start',
      message: 'Assistant turn started.',
    });

    try {
      await this.ensureStarted();
      const authToken = await this.getAuthToken();
      if (authToken) {
        emitTurnEvent({
          type: 'assistant-turn-progress',
          phase: 'transport',
          message: 'Trying unified Codex OAuth transport.',
        });
        const unifiedTurn = await runUnifiedAssistantTurn({
          userIntent: args.userIntent,
          chatHistory: args.chatHistory,
          providerMode: 'codex_oauth',
          providerCredentials: {
            codexToken: authToken,
          },
          threadContext: args.threadContext,
          capabilities: args.capabilities,
          context: args.context,
          programRead: args.programRead,
          projectSnapshot: args.projectSnapshot || {},
        });
        if (!shouldFallbackToCodexExecFromUnifiedTurn(unifiedTurn)) {
          emitTraceDetails(emitTurnEvent, unifiedTurn.debugTrace);
          emitTurnEvent({
            type: 'assistant-turn-completed',
            phase: 'complete',
            message: `Assistant turn completed in ${unifiedTurn.mode} mode.`,
          });
          return unifiedTurn;
        }

        emitTurnEvent({
          type: 'assistant-turn-progress',
          phase: 'fallback',
          message: 'Unified transport requested fallback to codex exec.',
        });

        try {
          const fallbackTurn = await this.runAssistantTurnViaCodexExec(args, emitTurnEvent);
          emitTurnEvent({
            type: 'assistant-turn-completed',
            phase: 'complete',
            message: `Assistant turn completed in ${fallbackTurn.mode} mode.`,
          });
          return fallbackTurn;
        } catch (fallbackError) {
          const fallbackMessage = toErrorMessage(fallbackError);
          if (isRecord(unifiedTurn)) {
            if (isRecord(unifiedTurn.debugTrace) && Array.isArray(unifiedTurn.debugTrace.validationErrors)) {
              unifiedTurn.debugTrace.validationErrors = [
                ...unifiedTurn.debugTrace.validationErrors,
                `codex_exec_fallback_error:${fallbackMessage}`,
              ];
            }
          }
          emitTraceDetails(emitTurnEvent, unifiedTurn.debugTrace);
          emitTurnEvent({
            type: 'assistant-turn-completed',
            phase: 'complete',
            message: `Assistant turn completed in ${unifiedTurn.mode} mode after fallback error.`,
            detail: fallbackMessage,
          });
          return unifiedTurn as CodexAssistantTurnResponse;
        }
      }

      const execTurn = await this.runAssistantTurnViaCodexExec(args, emitTurnEvent);
      emitTurnEvent({
        type: 'assistant-turn-completed',
        phase: 'complete',
        message: `Assistant turn completed in ${execTurn.mode} mode.`,
      });
      return execTurn;
    } catch (error) {
      emitTurnEvent({
        type: 'assistant-turn-error',
        phase: 'error',
        message: toErrorMessage(error),
      });
      throw error;
    }
  }

  private async runAssistantTurnViaCodexExec(
    args: CodexAssistantTurnRequest,
    emitTurnEvent?: TurnEventEmitter,
  ): Promise<CodexAssistantTurnResponse> {
    const prompt = buildCodexAssistantPrompt(args);
    emitTurnEvent?.({
      type: 'assistant-turn-progress',
      phase: 'transport',
      message: 'Launching codex exec transport.',
    });
    const { output, stderr, exitCode } = await this.runCodexExecWithSchema(prompt, (line: string) => {
      emitTurnEvent?.({
        type: 'assistant-turn-progress',
        phase: 'stderr',
        message: line,
      });
    });
    emitTurnEvent?.({
      type: 'assistant-turn-progress',
      phase: 'transport',
      message: `codex exec exited with code ${exitCode}.`,
    });

    let parsed: unknown;
    try {
      parsed = JSON.parse(output);
    } catch (error) {
      throw new Error(`Codex returned non-JSON output: ${toErrorMessage(error)}\n${output}`);
    }

    if (!isRecord(parsed)) {
      throw new Error('Codex returned invalid assistant payload (not an object).');
    }

    const mode = parsed.mode;
    if (mode === 'chat') {
      const answer = typeof parsed.answer === 'string' ? parsed.answer.trim() : '';
      if (!answer) {
        throw new Error('Codex returned chat mode without a non-empty answer.');
      }
      const response: CodexAssistantTurnResponse = {
        provider: 'codex',
        model: 'gpt-5.3-codex',
        mode: 'chat',
        answer,
        debugTrace: {
          transport: 'codex-exec',
          exitCode,
          stderrTail: stderr.slice(-1200),
        },
      };
      emitTraceDetails(emitTurnEvent ?? (() => undefined), response.debugTrace);
      return response;
    }

    if (mode === 'edit') {
      const proposedEditsRaw = typeof parsed.proposedEditsJson === 'string' ? parsed.proposedEditsJson.trim() : '';
      if (!proposedEditsRaw) {
        const fallback = buildInvalidEditFallback({
          reason: 'missing_proposedEditsJson',
          exitCode,
          stderr,
        });
        emitTraceDetails(emitTurnEvent ?? (() => undefined), fallback.debugTrace);
        return fallback;
      }
      let proposedEdits: unknown;
      try {
        proposedEdits = JSON.parse(proposedEditsRaw);
      } catch (error) {
        const fallback = buildInvalidEditFallback({
          reason: `invalid_proposedEditsJson:${toErrorMessage(error)}`,
          exitCode,
          stderr,
        });
        emitTraceDetails(emitTurnEvent ?? (() => undefined), fallback.debugTrace);
        return fallback;
      }
      const normalized = normalizeProposedEditsShape(proposedEdits);
      if (normalized.movedProjectOpsFromSemantic > 0 || normalized.renamedProjectOps > 0) {
        emitTurnEvent?.({
          type: 'assistant-turn-progress',
          phase: 'normalization',
          message: `Normalized edit payload (${normalized.movedProjectOpsFromSemantic} moved project op(s), ${normalized.renamedProjectOps} renamed op(s)).`,
        });
      } else {
        emitTurnEvent?.({
          type: 'assistant-turn-progress',
          phase: 'normalization',
          message: 'Parsed edit payload JSON.',
        });
      }
      const validated = validateSemanticOpsPayload(normalized.value);
      if (!validated.ok) {
        validated.errors.forEach((entry) => {
          emitTurnEvent?.({
            type: 'assistant-turn-progress',
            phase: 'validation',
            message: `Validation: ${entry}`,
          });
        });
        const fallback = buildInvalidEditFallback({
          reason: 'schema_validation_failed',
          exitCode,
          stderr,
          validationErrors: validated.errors,
        });
        emitTraceDetails(emitTurnEvent ?? (() => undefined), fallback.debugTrace);
        return fallback;
      }
      const response: CodexAssistantTurnResponse = {
        provider: 'codex',
        model: 'gpt-5.3-codex',
        mode: 'edit',
        proposedEdits: validated.value,
        debugTrace: {
          transport: 'codex-exec',
          exitCode,
          stderrTail: stderr.slice(-1200),
          movedProjectOpsFromSemantic: normalized.movedProjectOpsFromSemantic,
          renamedProjectOps: normalized.renamedProjectOps,
        },
      };
      emitTraceDetails(emitTurnEvent ?? (() => undefined), response.debugTrace);
      return response;
    }

    const fallback = buildInvalidEditFallback({
      reason: 'unsupported_mode',
      exitCode,
      stderr,
    });
    emitTraceDetails(emitTurnEvent ?? (() => undefined), fallback.debugTrace);
    return fallback;
  }

  async loginWithChatGpt(): Promise<void> {
    await this.ensureStarted();
    this.loginInProgress = true;
    this.statusMessage = 'Opening ChatGPT login in browser...';
    this.emitEvent({
      type: 'codex-login-started',
      message: this.statusMessage,
    });

    try {
      const response = await this.request<CodexLoginResponse>('account/login/start', {
        type: 'chatgpt',
      });

      if (response.type !== 'chatgpt' || typeof response.authUrl !== 'string' || !response.authUrl) {
        throw new Error('Codex login did not return a ChatGPT authorization URL.');
      }

      this.pendingLoginId = typeof response.loginId === 'string' ? response.loginId : null;
      await shell.openExternal(response.authUrl);
      this.statusMessage = 'Complete ChatGPT sign-in in your browser.';
      this.emitEvent({
        type: 'codex-status',
        message: this.statusMessage,
      });
    } catch (error) {
      this.loginInProgress = false;
      this.pendingLoginId = null;
      this.statusMessage = toErrorMessage(error);
      this.emitEvent({
        type: 'codex-error',
        message: this.statusMessage,
      });
      throw error;
    }
  }

  async logout(): Promise<void> {
    await this.ensureStarted();
    await this.request('account/logout');
    this.loginInProgress = false;
    this.pendingLoginId = null;
    this.statusMessage = 'Logged out from ChatGPT.';
    this.emitEvent({
      type: 'codex-logout',
      message: this.statusMessage,
    });
  }

  dispose(): void {
    this.teardownProcess('Codex app server stopped.');
  }

  private async ensureStarted(): Promise<void> {
    if (this.process && this.initialized) {
      return;
    }
    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = this.startInternal()
      .finally(() => {
        this.startPromise = null;
      });
    return this.startPromise;
  }

  private async startInternal(): Promise<void> {
    if (this.process) {
      this.teardownProcess('Restarting Codex app server.');
    }

    const process = spawn(this.codexExecutable, ['app-server', '--listen', 'stdio://'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.process = process;
    this.outputBuffer = '';
    this.initialized = false;

    process.stdout.setEncoding('utf8');
    process.stdout.on('data', (chunk: string | Buffer) => {
      this.handleStdout(chunk.toString());
    });

    process.stderr.on('data', (chunk: string | Buffer) => {
      const message = chunk.toString().trim();
      if (message) {
        this.statusMessage = message;
      }
    });

    process.on('error', (error) => {
      this.rejectPendingRequests(new Error(`Failed to launch codex app-server: ${toErrorMessage(error)}`));
      this.process = null;
      this.initialized = false;
    });

    process.on('exit', (code, signal) => {
      const reason = `Codex app-server exited (code=${String(code)}, signal=${String(signal)})`;
      this.rejectPendingRequests(new Error(reason));
      this.process = null;
      this.initialized = false;
      if (this.loginInProgress) {
        this.loginInProgress = false;
        this.pendingLoginId = null;
        this.statusMessage = reason;
        this.emitEvent({
          type: 'codex-error',
          message: reason,
        });
      }
    });

    await this.requestInternal('initialize', {
      clientInfo: this.clientInfo,
      capabilities: {
        experimentalApi: true,
        optOutNotificationMethods: [],
      },
    });
    this.initialized = true;
    this.statusMessage = 'Codex app server is ready.';
  }

  private async runCodexExecWithSchema(
    prompt: string,
    onProgress?: (line: string) => void,
  ): Promise<{
    output: string;
    stderr: string;
    exitCode: number;
  }> {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'pochacoding-codex-turn-'));
    const schemaPath = path.join(tempDir, 'schema.json');
    const outputPath = path.join(tempDir, 'out.json');

    await fs.writeFile(schemaPath, JSON.stringify(CODEX_TURN_OUTPUT_SCHEMA), 'utf8');

    const args = [
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      '-c',
      'ask_for_approval=never',
      '--output-schema',
      schemaPath,
      '--output-last-message',
      outputPath,
      '--cd',
      process.cwd(),
      '-',
    ];

    const child = spawn(this.codexExecutable, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string | Buffer) => {
      const raw = chunk.toString();
      stderr += raw;
      raw
        .split(/\r?\n/)
        .map((line) => normalizeTraceLine(line))
        .filter((line) => line.length > 0)
        .forEach((line) => {
          onProgress?.(line);
        });
    });

    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string | Buffer) => {
      stdout += chunk.toString();
    });

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill('SIGTERM');
      }, 90000);

      child.on('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });

      child.on('close', (code) => {
        clearTimeout(timeout);
        resolve(code ?? -1);
      });

      child.stdin.end(prompt, 'utf8');
    });

    let output = '';
    try {
      output = await fs.readFile(outputPath, 'utf8');
    } catch {
      output = '';
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }

    const normalizedOutput = output.trim();
    if (exitCode !== 0 || !normalizedOutput) {
      const detail = stderr || stdout || 'No output from codex exec.';
      throw new Error(`Codex exec failed (exit ${exitCode}): ${detail.slice(-2400)}`);
    }

    return {
      output: normalizedOutput,
      stderr,
      exitCode,
    };
  }

  private async request<T>(method: string, params?: unknown): Promise<T> {
    await this.ensureStarted();
    return this.requestInternal<T>(method, params);
  }

  private async requestInternal<T>(method: string, params?: unknown): Promise<T> {
    if (!this.process || !this.process.stdin.writable) {
      throw new Error('Codex app server is not running.');
    }

    const id = this.nextRequestId++;
    const payload: Record<string, unknown> = {
      id,
      method,
    };
    if (params !== undefined) {
      payload.params = params;
    }

    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(String(id));
        reject(new Error(`Timed out waiting for Codex app-server response to ${method}`));
      }, 15000);

      this.pending.set(String(id), {
        resolve: (value) => resolve(value as T),
        reject,
        timeoutId,
      });
      this.process?.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return;
        clearTimeout(timeoutId);
        this.pending.delete(String(id));
        reject(error);
      });
    });
  }

  private handleStdout(chunk: string): void {
    this.outputBuffer += chunk;
    let newlineIndex = this.outputBuffer.indexOf('\n');
    while (newlineIndex >= 0) {
      const line = this.outputBuffer.slice(0, newlineIndex).trim();
      this.outputBuffer = this.outputBuffer.slice(newlineIndex + 1);
      if (line) {
        this.handleLine(line);
      }
      newlineIndex = this.outputBuffer.indexOf('\n');
    }
  }

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(message)) return;

    const method = typeof message.method === 'string' ? message.method : null;
    const hasId = Object.prototype.hasOwnProperty.call(message, 'id');

    if (hasId && method) {
      void this.handleServerRequest({
        id: message.id as JsonRpcId,
        method,
        params: message.params,
      });
      return;
    }

    if (hasId) {
      this.handleResponse({
        id: message.id as JsonRpcId,
        result: message.result,
        error: isRecord(message.error)
          ? {
              code: typeof message.error.code === 'number' ? message.error.code : undefined,
              message: typeof message.error.message === 'string' ? message.error.message : undefined,
              data: message.error.data,
            }
          : undefined,
      });
      return;
    }

    if (method) {
      this.handleNotification({
        method,
        params: message.params,
      });
    }
  }

  private handleResponse(message: JsonRpcResponse): void {
    const pending = this.pending.get(String(message.id));
    if (!pending) return;
    clearTimeout(pending.timeoutId);
    this.pending.delete(String(message.id));

    if (message.error) {
      const detail = typeof message.error.message === 'string' ? message.error.message : 'Unknown error';
      pending.reject(new Error(detail));
      return;
    }
    pending.resolve(message.result);
  }

  private async handleServerRequest(message: JsonRpcServerRequest): Promise<void> {
    if (message.method === 'account/chatgptAuthTokens/refresh') {
      const refreshed = await this.tryRefreshAuthTokens();
      if (refreshed) {
        this.sendServerReply({
          id: message.id,
          result: refreshed,
        });
      } else {
        this.sendServerReply({
          id: message.id,
          error: {
            code: -32001,
            message: 'Unable to refresh ChatGPT auth tokens in this host.',
          },
        });
      }
      return;
    }

    this.sendServerReply({
      id: message.id,
      error: {
        code: -32601,
        message: `Unsupported server request method: ${message.method}`,
      },
    });
  }

  private async tryRefreshAuthTokens(): Promise<{
    accessToken: string;
    chatgptAccountId: string;
    chatgptPlanType: string | null;
  } | null> {
    try {
      const authStatus = await this.request<CodexAuthStatusResult>('getAuthStatus', {
        includeToken: true,
        refreshToken: true,
      });
      if (typeof authStatus.authToken !== 'string' || !authStatus.authToken.trim()) {
        return null;
      }
      const token = authStatus.authToken.trim();
      const hints = extractAccountHintsFromToken(token);
      if (!hints.accountId) {
        return null;
      }
      return {
        accessToken: token,
        chatgptAccountId: hints.accountId,
        chatgptPlanType: hints.planType,
      };
    } catch {
      return null;
    }
  }

  private handleNotification(message: JsonRpcNotification): void {
    if (message.method === 'account/login/completed') {
      const params = isRecord(message.params) ? message.params : {};
      const success = params.success === true;
      const loginId = typeof params.loginId === 'string' ? params.loginId : null;
      if (this.pendingLoginId && loginId && this.pendingLoginId !== loginId) {
        return;
      }
      this.loginInProgress = false;
      this.pendingLoginId = null;
      this.statusMessage = success
        ? 'ChatGPT login completed.'
        : (typeof params.error === 'string' && params.error) || 'ChatGPT login failed.';
      this.emitEvent({
        type: 'codex-login-completed',
        success,
        message: this.statusMessage,
      });
      return;
    }

    if (message.method === 'account/updated' || message.method === 'authStatusChange') {
      this.emitEvent({
        type: 'codex-status',
        message: this.statusMessage,
      });
      return;
    }

    if (message.method === 'error') {
      const params = isRecord(message.params) ? message.params : {};
      const info = isRecord(params.info) ? params.info : {};
      const errorMessage = typeof info.message === 'string' ? info.message : 'Codex app-server error.';
      this.statusMessage = errorMessage;
      this.emitEvent({
        type: 'codex-error',
        message: errorMessage,
      });
    }
  }

  private sendServerReply(payload: { id: JsonRpcId; result?: unknown; error?: unknown }): void {
    if (!this.process || !this.process.stdin.writable) return;
    this.process.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private teardownProcess(statusMessage: string): void {
    this.statusMessage = statusMessage;
    if (this.process) {
      this.process.kill('SIGTERM');
    }
    this.process = null;
    this.initialized = false;
    this.loginInProgress = false;
    this.pendingLoginId = null;
    this.rejectPendingRequests(new Error(statusMessage));
  }
}
