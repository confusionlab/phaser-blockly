import OpenAI from 'openai';
import { hashFnv1a64 } from './intent';
import { validateSemanticOpsPayload } from './semanticOps';
import type {
  AssistantProviderMode,
  AssistantTrace,
  AssistantTraceToolCall,
  AssistantTurnResponse,
  ProposedEdits,
} from './types';

type ChatHistoryTurn = {
  role: 'user' | 'assistant';
  content: string;
};

type AssistantProviderCredentials = {
  codexToken?: string;
};

type UnifiedAssistantTurnRequest = {
  userIntent: string;
  chatHistory: ChatHistoryTurn[];
  providerMode?: AssistantProviderMode;
  providerCredentials?: AssistantProviderCredentials;
  threadContext?: {
    threadId?: string;
    scopeKey?: string;
  };
  capabilities: unknown;
  context: unknown;
  programRead: unknown;
  projectSnapshot: unknown;
};

type ResolvedProviderConfig = {
  provider: 'openai';
  apiKey: string;
  model: string;
  appName: string;
};

type AgentRunContext = {
  projectSnapshot: Record<string, unknown>;
  capabilities: unknown;
};

type AssistantToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  strict: boolean;
};

type AssistantToolExecutor = (args: {
  input: Record<string, unknown>;
  context: AgentRunContext;
}) => Promise<Record<string, unknown>>;

type AssistantTool = {
  definition: AssistantToolDefinition;
  execute: AssistantToolExecutor;
};

type AssistantFinalSubmission =
  | {
      mode: 'chat';
      answer: string;
    }
  | {
      mode: 'edit';
      proposedEdits: unknown;
    };

type OpenAIApiError = {
  status?: number;
  error?: {
    message?: string;
    code?: string;
  };
  message?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function truncate(text: string, maxLength = 700): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength)}...`;
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
  if (typeof value === 'boolean') return value;
  return fallback;
}

function toNumber(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function toBoundedInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Math.floor(toNumber(value, fallback));
  return Math.max(min, Math.min(max, numeric));
}

function getEnv(name: string): string | undefined {
  const maybeProcess = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return maybeProcess.process?.env?.[name];
}

function toErrorCode(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64) || 'assistant_turn_error';
}

function getManagedOpenAIDefaults() {
  const model = (getEnv('OPENAI_MODEL') || getEnv('OPENAI_MANAGED_MODEL') || 'gpt-5').trim();
  const appName = (getEnv('OPENAI_APP_NAME') || getEnv('OPENAI_MANAGED_APP_NAME') || 'PochaCoding').trim();
  return {
    model,
    appName,
  };
}

function getCodexOpenAIDefaults() {
  const model = (getEnv('OPENAI_OAUTH_MODEL') || 'gpt-5').trim();
  const appName = (getEnv('OPENAI_OAUTH_APP_NAME') || 'PochaCoding').trim();
  return {
    model,
    appName,
  };
}

function getManagedOpenAIApiKey(): string {
  const apiKey = getEnv('OPENAI_API_KEY');
  if (!apiKey || !apiKey.trim()) {
    throw new Error('openai_api_key_missing');
  }
  return apiKey.trim();
}

function normalizeBearerToken(value: string): string {
  return value.replace(/^bearer\s+/i, '').trim();
}

function extractCodexToken(raw: string): string {
  const trimmed = normalizeBearerToken(raw.trim());
  if (!trimmed) return '';
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) || trimmed.startsWith('pochacoding://');

  if (trimmed.startsWith('{')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (isRecord(parsed)) {
        const keys = ['access_token', 'token', 'id_token', 'authToken'];
        for (const key of keys) {
          const candidate = parsed[key];
          if (typeof candidate === 'string' && candidate.trim()) {
            return normalizeBearerToken(candidate);
          }
        }
      }
      return '';
    } catch {
      // fall through to URL/raw parsing
    }
  }

  try {
    const url = new URL(trimmed);
    const hash = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const hashParams = new URLSearchParams(hash);
    const tokenCandidate =
      url.searchParams.get('access_token')
      || hashParams.get('access_token')
      || url.searchParams.get('token')
      || hashParams.get('token')
      || url.searchParams.get('id_token')
      || hashParams.get('id_token');
    if (typeof tokenCandidate === 'string' && tokenCandidate.trim()) {
      return normalizeBearerToken(tokenCandidate);
    }
    return '';
  } catch {
    if (looksLikeUrl) {
      return '';
    }
  }

  return trimmed;
}

function resolveProviderConfig(args: {
  providerMode: AssistantProviderMode;
  providerCredentials?: AssistantProviderCredentials;
}): ResolvedProviderConfig {
  const credentials = isRecord(args.providerCredentials) ? args.providerCredentials : {};

  if (args.providerMode === 'managed') {
    const defaults = getManagedOpenAIDefaults();
    return {
      provider: 'openai',
      apiKey: getManagedOpenAIApiKey(),
      model: defaults.model,
      appName: defaults.appName,
    };
  }

  const codexRaw =
    typeof credentials.codexToken === 'string'
      ? credentials.codexToken
      : '';
  const codexToken = extractCodexToken(codexRaw);
  if (!codexToken) {
    throw new Error('codex_oauth_missing_token');
  }
  const defaults = getCodexOpenAIDefaults();
  return {
    provider: 'openai',
    apiKey: codexToken,
    model: defaults.model,
    appName: defaults.appName,
  };
}

function buildAssistantTurnSystemPrompt(): string {
  return [
    'You are a Blockly assistant.',
    'Decide whether the user needs a conversational answer or an edit proposal.',
    'Use chat mode for questions/explanations/clarifications.',
    'Use edit mode only when the user asks to create/change/remove/fix project behavior.',
    'If the user is discussing capabilities/planning/tooling (not requesting concrete project changes now), use chat mode.',
    'When project details are needed (scenes, objects, properties, physics, components, block capabilities), call tools instead of guessing.',
    'Put Blockly code operations ONLY in semanticOps. Put scene/object/costume/project operations ONLY in projectOps.',
    'Finalize every turn by calling exactly one tool:',
    '- submit_chat_response(answer)',
    '- submit_edit_response(intentSummary, assumptions, semanticOps, projectOps)',
    'Do not output a JSON envelope in plain text.',
    'Edit mode semanticOps schema and rules:',
    '- create_event_flow / append_actions / replace_action / set_block_field / ensure_variable / ensure_message / retarget_reference / delete_subtree',
    'Edit mode projectOps schema and rules:',
    '- rename_project',
    '- create_scene / rename_scene / reorder_scenes',
    '- create_object / rename_object / set_object_property',
    '- set_object_physics / set_object_collider_type',
    '- create_folder / rename_folder / move_object_to_folder',
    '- add_costume_from_image_url / add_costume_text_circle / rename_costume / reorder_costumes / set_current_costume',
    '- validate_project',
    'Always include BOTH arrays in proposedEdits. Use empty arrays when not needed.',
    'Never emit placeholder/template operations. Required IDs/names must be non-empty concrete values.',
    'If required scene/object/costume references are unavailable, use submit_chat_response with a concise follow-up question.',
    '- Only use block types/field names present in capabilities/context.',
    '- If you already have enough information to answer without tools, answer directly through the chat finalization tool.',
  ].join('\n');
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
    const id = typeof component.id === 'string' ? component.id : '';
    if (!id) continue;
    componentsById.set(id, component);
  }

  for (const scene of scenes) {
    const sceneId = typeof scene.id === 'string' ? scene.id : '';
    if (!sceneId) continue;
    scenesById.set(sceneId, scene);
    const sceneName = typeof scene.name === 'string' ? scene.name : sceneId;

    const objects = Array.isArray(scene.objects) ? scene.objects.filter(isRecord) : [];
    for (const object of objects) {
      const objectId = typeof object.id === 'string' ? object.id : '';
      if (!objectId) continue;
      objectsById.set(objectId, object);
      objectSceneMeta.set(objectId, { sceneId, sceneName });
      const componentId = typeof object.componentId === 'string' ? object.componentId : '';
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
    case 'list_scenes': {
      return {
        scenes: indexes.scenes.map((scene) => {
          const objects = Array.isArray(scene.objects) ? scene.objects.filter(isRecord) : [];
          return {
            id: typeof scene.id === 'string' ? scene.id : '',
            name: typeof scene.name === 'string' ? scene.name : '',
            order: typeof scene.order === 'number' ? scene.order : null,
            objectCount: objects.length,
            hasGround: !!scene.ground,
          };
        }),
      };
    }
    case 'get_scene': {
      const sceneId = typeof toolArgs.sceneId === 'string' ? toolArgs.sceneId : '';
      const includeObjects = toBoolean(toolArgs.includeObjects, true);
      const includeObjectDetails = toBoolean(toolArgs.includeObjectDetails, false);
      const includeFolders = toBoolean(toolArgs.includeFolders, true);
      const scene = indexes.scenesById.get(sceneId);
      if (!scene) {
        return {
          error: `Scene not found: ${sceneId}`,
          availableSceneIds: Array.from(indexes.scenesById.keys()),
        };
      }

      const objects = Array.isArray(scene.objects) ? scene.objects.filter(isRecord) : [];
      const folders = Array.isArray(scene.objectFolders) ? scene.objectFolders.filter(isRecord) : [];
      return {
        scene: {
          id: typeof scene.id === 'string' ? scene.id : '',
          name: typeof scene.name === 'string' ? scene.name : '',
          order: typeof scene.order === 'number' ? scene.order : null,
          ground: isRecord(scene.ground) ? scene.ground : null,
          cameraConfig: isRecord(scene.cameraConfig) ? scene.cameraConfig : null,
          objectFolders: includeFolders
            ? folders.map((folder) => ({
                id: typeof folder.id === 'string' ? folder.id : '',
                name: typeof folder.name === 'string' ? folder.name : '',
                parentId: typeof folder.parentId === 'string' ? folder.parentId : null,
                order: typeof folder.order === 'number' ? folder.order : null,
              }))
            : [],
          objects: includeObjects
            ? objects.map((object) => {
                const componentId = typeof object.componentId === 'string' ? object.componentId : null;
                const component = componentId ? indexes.componentsById.get(componentId) : null;
                const base = {
                  id: typeof object.id === 'string' ? object.id : '',
                  name: typeof object.name === 'string' ? object.name : '',
                  componentId,
                  parentId: typeof object.parentId === 'string' ? object.parentId : null,
                  order: typeof object.order === 'number' ? object.order : null,
                };
                if (!includeObjectDetails) {
                  return base;
                }
                return {
                  ...base,
                  x: typeof object.x === 'number' ? object.x : null,
                  y: typeof object.y === 'number' ? object.y : null,
                  visible: typeof object.visible === 'boolean' ? object.visible : null,
                  rotation: typeof object.rotation === 'number' ? object.rotation : null,
                  physics: (isRecord(component?.physics) ? component.physics : object.physics) || null,
                  collider: (isRecord(component?.collider) ? component.collider : object.collider) || null,
                };
              })
            : [],
        },
      };
    }
    case 'list_scene_folders': {
      const sceneId = typeof toolArgs.sceneId === 'string' ? toolArgs.sceneId : '';
      const scene = indexes.scenesById.get(sceneId);
      if (!scene) {
        return {
          error: `Scene not found: ${sceneId}`,
          availableSceneIds: Array.from(indexes.scenesById.keys()),
        };
      }
      const folders = Array.isArray(scene.objectFolders) ? scene.objectFolders.filter(isRecord) : [];
      return {
        sceneId,
        folders: folders.map((folder) => ({
          id: typeof folder.id === 'string' ? folder.id : '',
          name: typeof folder.name === 'string' ? folder.name : '',
          parentId: typeof folder.parentId === 'string' ? folder.parentId : null,
          order: typeof folder.order === 'number' ? folder.order : null,
        })),
      };
    }
    case 'list_scene_objects': {
      const sceneId = typeof toolArgs.sceneId === 'string' ? toolArgs.sceneId : '';
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
          const componentId = typeof object.componentId === 'string' ? object.componentId : null;
          const component = componentId ? indexes.componentsById.get(componentId) : null;
          return {
            id: typeof object.id === 'string' ? object.id : '',
            name: typeof object.name === 'string' ? object.name : '',
            componentId,
            componentName: component && typeof component.name === 'string' ? component.name : null,
            x: typeof object.x === 'number' ? object.x : null,
            y: typeof object.y === 'number' ? object.y : null,
            visible: typeof object.visible === 'boolean' ? object.visible : null,
            hasPhysics: !!((component && component.physics) || object.physics),
          };
        }),
      };
    }
    case 'get_object': {
      const objectId = typeof toolArgs.objectId === 'string' ? toolArgs.objectId : '';
      const includeBlockly = toBoolean(toolArgs.includeBlockly, false);
      const object = indexes.objectsById.get(objectId);
      if (!object) {
        return {
          error: `Object not found: ${objectId}`,
          availableObjectIds: Array.from(indexes.objectsById.keys()).slice(0, 120),
        };
      }
      const meta = indexes.objectSceneMeta.get(objectId) || { sceneId: '', sceneName: '' };
      const componentId = typeof object.componentId === 'string' ? object.componentId : null;
      const component = componentId ? indexes.componentsById.get(componentId) : null;
      const effectivePhysics = (component && component.physics) || object.physics || null;
      const effectiveCollider = (component && component.collider) || object.collider || null;
      const effectiveLocalVariables = (component && component.localVariables) || object.localVariables || [];
      const effectiveSounds = (component && component.sounds) || object.sounds || [];
      const effectiveCostumes = (component && component.costumes) || object.costumes || [];
      const currentCostumeIndexRaw =
        (component && component.currentCostumeIndex)
        ?? object.currentCostumeIndex;
      const currentCostumeIndex = typeof currentCostumeIndexRaw === 'number'
        ? currentCostumeIndexRaw
        : 0;
      const effectiveBlocklyXml = typeof (component && component.blocklyXml) === 'string'
        ? String(component?.blocklyXml || '')
        : (typeof object.blocklyXml === 'string' ? object.blocklyXml : '');
      const blocklyXml = includeBlockly ? truncateText(effectiveBlocklyXml, 12000) : undefined;
      const localVariables = Array.isArray(effectiveLocalVariables)
        ? effectiveLocalVariables.filter(isRecord).map((item) => ({
            id: typeof item.id === 'string' ? item.id : '',
            name: typeof item.name === 'string' ? item.name : '',
            type: typeof item.type === 'string' ? item.type : '',
          }))
        : [];
      const sounds = Array.isArray(effectiveSounds)
        ? effectiveSounds.filter(isRecord).map((item) => ({
            id: typeof item.id === 'string' ? item.id : '',
            name: typeof item.name === 'string' ? item.name : '',
          }))
        : [];
      const costumes = Array.isArray(effectiveCostumes)
        ? effectiveCostumes.filter(isRecord).map((item) => ({
            id: typeof item.id === 'string' ? item.id : '',
            name: typeof item.name === 'string' ? item.name : '',
          }))
        : [];
      return {
        object: {
          id: typeof object.id === 'string' ? object.id : '',
          name: typeof object.name === 'string' ? object.name : '',
          sceneId: meta.sceneId,
          sceneName: meta.sceneName,
          componentId,
          componentName: component && typeof component.name === 'string' ? component.name : null,
          parentId: typeof object.parentId === 'string' ? object.parentId : null,
          order: typeof object.order === 'number' ? object.order : null,
          x: typeof object.x === 'number' ? object.x : null,
          y: typeof object.y === 'number' ? object.y : null,
          visible: typeof object.visible === 'boolean' ? object.visible : null,
          rotation: typeof object.rotation === 'number' ? object.rotation : null,
          scaleX: typeof object.scaleX === 'number' ? object.scaleX : null,
          scaleY: typeof object.scaleY === 'number' ? object.scaleY : null,
          physics: isRecord(effectivePhysics) ? effectivePhysics : null,
          collider: isRecord(effectiveCollider) ? effectiveCollider : null,
          costumes,
          currentCostumeIndex,
          localVariables,
          sounds,
          blocklyXml,
          blocklyXmlLength: effectiveBlocklyXml.length,
        },
      };
    }
    case 'list_object_costumes': {
      const objectId = typeof toolArgs.objectId === 'string' ? toolArgs.objectId : '';
      const object = indexes.objectsById.get(objectId);
      if (!object) {
        return {
          error: `Object not found: ${objectId}`,
          availableObjectIds: Array.from(indexes.objectsById.keys()).slice(0, 120),
        };
      }
      const componentId = typeof object.componentId === 'string' ? object.componentId : null;
      const component = componentId ? indexes.componentsById.get(componentId) : null;
      const effectiveCostumes = (component && component.costumes) || object.costumes || [];
      const currentCostumeIndexRaw =
        (component && component.currentCostumeIndex)
        ?? object.currentCostumeIndex;
      const currentCostumeIndex = typeof currentCostumeIndexRaw === 'number'
        ? currentCostumeIndexRaw
        : 0;
      const costumes = Array.isArray(effectiveCostumes)
        ? effectiveCostumes.filter(isRecord).map((item) => ({
            id: typeof item.id === 'string' ? item.id : '',
            name: typeof item.name === 'string' ? item.name : '',
          }))
        : [];
      return {
        objectId,
        componentId,
        currentCostumeIndex,
        costumes,
      };
    }
    case 'list_components': {
      return {
        components: indexes.components.map((component) => {
          const componentId = typeof component.id === 'string' ? component.id : '';
          const localVariables = Array.isArray(component.localVariables) ? component.localVariables : [];
          const sounds = Array.isArray(component.sounds) ? component.sounds : [];
          return {
            id: componentId,
            name: typeof component.name === 'string' ? component.name : '',
            instanceCount: indexes.componentInstanceCounts.get(componentId) || 0,
            hasPhysics: !!component.physics,
            localVariableCount: localVariables.length,
            soundCount: sounds.length,
          };
        }),
      };
    }
    case 'get_component': {
      const componentId = typeof toolArgs.componentId === 'string' ? toolArgs.componentId : '';
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
            id: typeof item.id === 'string' ? item.id : '',
            name: typeof item.name === 'string' ? item.name : '',
            type: typeof item.type === 'string' ? item.type : '',
          }))
        : [];
      const sounds = Array.isArray(component.sounds)
        ? component.sounds.filter(isRecord).map((item) => ({
            id: typeof item.id === 'string' ? item.id : '',
            name: typeof item.name === 'string' ? item.name : '',
          }))
        : [];
      const componentBlocklyXml = typeof component.blocklyXml === 'string' ? component.blocklyXml : '';
      return {
        component: {
          id: typeof component.id === 'string' ? component.id : '',
          name: typeof component.name === 'string' ? component.name : '',
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
    case 'list_messages': {
      return {
        messages: indexes.messages.map((message) => ({
          id: typeof message.id === 'string' ? message.id : '',
          name: typeof message.name === 'string' ? message.name : '',
        })),
      };
    }
    case 'list_global_variables': {
      return {
        globalVariables: indexes.globalVariables.map((variable) => ({
          id: typeof variable.id === 'string' ? variable.id : '',
          name: typeof variable.name === 'string' ? variable.name : '',
          type: typeof variable.type === 'string' ? variable.type : '',
          defaultValue: variable.defaultValue ?? null,
        })),
      };
    }
    case 'search_blocks': {
      const query = typeof toolArgs.query === 'string' ? toolArgs.query.trim().toLowerCase() : '';
      const limit = toBoundedInteger(toolArgs.limit, 10, 1, 30);
      const capabilityBlocks =
        isRecord(capabilities) && Array.isArray(capabilities.blocks)
          ? capabilities.blocks.filter(isRecord)
          : [];

      const scored = capabilityBlocks
        .map((block) => {
          const blockType = typeof block.type === 'string' ? block.type : '';
          const fields = Array.isArray(block.fields) ? block.fields.filter(isRecord) : [];
          const inputs = Array.isArray(block.inputs) ? block.inputs.filter(isRecord) : [];
          const haystack = [
            blockType,
            ...fields.flatMap((field) => [
              typeof field.name === 'string' ? field.name : '',
              typeof field.kind === 'string' ? field.kind : '',
            ]),
            ...inputs.flatMap((input) => [
              typeof input.name === 'string' ? input.name : '',
              ...(Array.isArray(input.checks) ? input.checks.filter((check): check is string => typeof check === 'string') : []),
            ]),
          ]
            .join(' ')
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
            name: typeof field.name === 'string' ? field.name : '',
            kind: typeof field.kind === 'string' ? field.kind : '',
          })),
          inputs: entry.inputs.slice(0, 8).map((input) => ({
            name: typeof input.name === 'string' ? input.name : '',
            kind: typeof input.kind === 'string' ? input.kind : '',
            checks: Array.isArray(input.checks)
              ? input.checks.filter((check): check is string => typeof check === 'string')
              : [],
          })),
        }));

      return {
        query,
        matches: scored,
      };
    }
    case 'get_block_type': {
      const blockType = typeof toolArgs.blockType === 'string' ? toolArgs.blockType : '';
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
              .map((block) => (typeof block.type === 'string' ? block.type : ''))
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

function buildAssistantTools(args: {
  onChatResponse: (answer: string) => void;
  onEditResponse: (proposedEdits: unknown) => void;
}): AssistantTool[] {
  const readToolSpecs: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  }> = [
    {
      name: 'list_scenes',
      description: 'List scenes in the current project.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: 'get_scene',
      description: 'Get scene details, folders, and optionally scene objects.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sceneId: { type: 'string' },
          includeObjects: { type: 'boolean' },
          includeObjectDetails: { type: 'boolean' },
          includeFolders: { type: 'boolean' },
        },
        required: ['sceneId'],
      },
    },
    {
      name: 'list_scene_folders',
      description: 'List folder hierarchy in a scene.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sceneId: { type: 'string' },
        },
        required: ['sceneId'],
      },
    },
    {
      name: 'list_scene_objects',
      description: 'List objects in a scene with key properties.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          sceneId: { type: 'string' },
        },
        required: ['sceneId'],
      },
    },
    {
      name: 'get_object',
      description: 'Get object details including hierarchy, costumes, effective physics/collider, and optional Blockly XML.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          objectId: { type: 'string' },
          includeBlockly: { type: 'boolean' },
        },
        required: ['objectId'],
      },
    },
    {
      name: 'list_object_costumes',
      description: 'List costumes for one object (effective for component instances).',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          objectId: { type: 'string' },
        },
        required: ['objectId'],
      },
    },
    {
      name: 'list_components',
      description: 'List component definitions and instance counts.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: 'get_component',
      description: 'Get component details and optional Blockly XML.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          componentId: { type: 'string' },
          includeBlockly: { type: 'boolean' },
        },
        required: ['componentId'],
      },
    },
    {
      name: 'list_messages',
      description: 'List broadcast messages.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: 'list_global_variables',
      description: 'List global variables and their types/defaults.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {},
      },
    },
    {
      name: 'search_blocks',
      description: 'Search available block capabilities by type/fields/inputs.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
    },
    {
      name: 'get_block_type',
      description: 'Get full capability details for one block type.',
      parameters: {
        type: 'object',
        additionalProperties: false,
        properties: {
          blockType: { type: 'string' },
        },
        required: ['blockType'],
      },
    },
  ];

  const readTools = readToolSpecs.map((spec) => ({
    definition: {
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      strict: false,
    },
    execute: async ({ input, context }: {
      input: Record<string, unknown>;
      context: AgentRunContext;
    }) => {
      const projectSnapshot = isRecord(context.projectSnapshot)
        ? context.projectSnapshot
        : {};
      return executeAssistantTool({
        toolName: spec.name,
        toolArgs: input,
        projectSnapshot,
        capabilities: context.capabilities,
      });
    },
  }));

  const submitChatResponseTool: AssistantTool = {
    definition: {
      name: 'submit_chat_response',
      description: 'Finalize the assistant turn with a conversational answer.',
      parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        answer: { type: 'string' },
      },
      required: ['answer'],
    },
      strict: true,
    },
    execute: async ({ input }) => {
      const answer = isRecord(input) && typeof input.answer === 'string' ? input.answer.trim() : '';
      if (!answer) {
        throw new Error('submit_chat_response requires a non-empty answer');
      }
      args.onChatResponse(answer);
      return {
        accepted: true,
        mode: 'chat',
      };
    },
  };

  const submitEditResponseTool: AssistantTool = {
    definition: {
      name: 'submit_edit_response',
      description: 'Finalize the assistant turn with a structured edit proposal.',
      parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        intentSummary: { type: 'string' },
        assumptions: {
          type: 'array',
          items: { type: 'string' },
        },
        semanticOps: {
          type: 'array',
          items: { type: 'object' },
        },
        projectOps: {
          type: 'array',
          items: { type: 'object' },
        },
      },
      required: ['intentSummary', 'assumptions', 'semanticOps', 'projectOps'],
    },
      strict: false,
    },
    execute: async ({ input }) => {
      if (!isRecord(input)) {
        throw new Error('submit_edit_response requires an object payload');
      }
      args.onEditResponse({
        intentSummary: typeof input.intentSummary === 'string' ? input.intentSummary.trim() : '',
        assumptions: Array.isArray(input.assumptions)
          ? input.assumptions.filter((entry): entry is string => typeof entry === 'string')
          : [],
        semanticOps: Array.isArray(input.semanticOps) ? input.semanticOps : [],
        projectOps: Array.isArray(input.projectOps) ? input.projectOps : [],
      });
      return {
        accepted: true,
        mode: 'edit',
      };
    },
  };

  return [
    ...readTools,
    submitChatResponseTool,
    submitEditResponseTool,
  ];
}

function buildFallbackChat(args: {
  provider: string;
  model: string;
  reason: string;
  message: string;
  debugTrace: AssistantTrace;
}): AssistantTurnResponse {
  const reasonCode = toErrorCode(args.reason);
  return {
    provider: args.provider,
    model: args.model,
    mode: 'chat',
    answer: args.message,
    errorCode: reasonCode,
    debugTrace: {
      ...args.debugTrace,
      finalVerdict: 'fallback_chat',
      fallbackReasonCode: reasonCode,
    },
  };
}

export async function runUnifiedAssistantTurn(args: UnifiedAssistantTurnRequest): Promise<AssistantTurnResponse> {
  const recentTurns = args.chatHistory
    .filter((turn) => (turn.role === 'user' || turn.role === 'assistant') && !!turn.content.trim())
    .slice(-16)
    .map((turn) => ({
      role: turn.role,
      content: truncate(turn.content.trim(), 1800),
    }));

  const providerMode = (args.providerMode || 'managed') as AssistantProviderMode;
  const threadContext = isRecord(args.threadContext) ? args.threadContext : {};
  const promptEnvelope = {
    userIntent: args.userIntent,
    providerMode,
    threadContext,
    chatHistory: recentTurns,
    context: args.context,
    programRead: args.programRead,
    capabilities: args.capabilities,
  };
  const promptEnvelopeHash = hashFnv1a64(JSON.stringify(promptEnvelope));

  const debugTraceBase: AssistantTrace = {
    promptEnvelopeHash,
    maxToolRounds: 8,
    modelRounds: 0,
    toolCalls: [],
    validationErrors: [],
    repairAttempts: 0,
    parsedPayloadPreview: null,
    finalResponsePreview: null,
    finalVerdict: 'fallback_chat',
  };

  let providerConfig: ResolvedProviderConfig;
  try {
    providerConfig = resolveProviderConfig({
      providerMode,
      providerCredentials: args.providerCredentials,
    });
  } catch (error) {
    const configError = error instanceof Error ? error.message : 'provider_configuration_error';
    const provider = 'openai';
    const model = providerMode === 'codex_oauth'
      ? getCodexOpenAIDefaults().model
      : getManagedOpenAIDefaults().model;
    return buildFallbackChat({
      provider,
      model,
      reason: configError,
      message:
        providerMode === 'codex_oauth'
          ? 'Codex mode is not authenticated. Use the desktop app\'s Login with ChatGPT flow and try again.'
          : 'Managed OpenAI configuration is incomplete. Check assistant provider settings and try again.',
      debugTrace: {
        ...debugTraceBase,
        validationErrors: [`provider:${configError}`],
      },
    });
  }

  let finalSubmission: AssistantFinalSubmission | null = null;
  const toolDefinitions = buildAssistantTools({
    onChatResponse: (answer) => {
      finalSubmission = {
        mode: 'chat',
        answer,
      };
    },
    onEditResponse: (proposedEdits) => {
      finalSubmission = {
        mode: 'edit',
        proposedEdits,
      };
    },
  });
  const modelClient = new OpenAI({
    apiKey: providerConfig.apiKey,
    defaultHeaders: {
      'X-Title': providerConfig.appName,
    },
  });
  const toolByName = new Map<string, AssistantTool>();
  for (const tool of toolDefinitions) {
    toolByName.set(tool.definition.name, tool);
  }

  const responseTools = toolDefinitions.map((tool) => ({
    type: 'function' as const,
    name: tool.definition.name,
    description: tool.definition.description,
    parameters: tool.definition.parameters,
    strict: tool.definition.strict,
  }));

  const inputItems = [
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: JSON.stringify(
            {
              task: 'Classify and handle Blockly assistant turn',
              context: args.context,
              programRead: args.programRead,
              capabilities: args.capabilities,
              providerMode,
              threadContext,
              toolingHint: 'Use tools to fetch project entities/properties before finalizing answer.',
            },
            null,
            2,
          ),
        },
      ],
    },
    ...recentTurns.map((turn) => ({
      role: turn.role,
      content: [
        {
          type: 'input_text',
          text: turn.content,
        },
      ],
    })),
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: args.userIntent,
        },
      ],
    },
  ];
  const runContext: AgentRunContext = {
    projectSnapshot: isRecord(args.projectSnapshot) ? args.projectSnapshot : {},
    capabilities: args.capabilities,
  };

  try {
    const toolCalls: AssistantTraceToolCall[] = [];
    const validationErrors: string[] = [];
    let parsedPayloadPreview: string | null = null;
    let finalResponsePreview: string | null = null;
    let responseCount = 0;
    let previousResponseId: string | null = null;
    let nextInput: any = inputItems;

    for (let round = 1; round <= debugTraceBase.maxToolRounds; round += 1) {
      const response: any = await modelClient.responses.create({
        model: providerConfig.model,
        instructions: buildAssistantTurnSystemPrompt(),
        input: nextInput,
        previous_response_id: previousResponseId,
        tools: responseTools,
        tool_choice: 'auto',
        temperature: 0.2,
        max_output_tokens: 1800,
        parallel_tool_calls: false,
      });

      responseCount += 1;
      previousResponseId = response.id;
      finalResponsePreview = truncateText(response.output_text || '', 4000);

      const outputItems = Array.isArray(response.output) ? response.output : [];
      const functionCalls = outputItems.filter((item: any) => isRecord(item) && item.type === 'function_call');

      if (functionCalls.length === 0) {
        break;
      }

      const toolOutputs: Array<Record<string, unknown>> = [];

      for (const item of functionCalls) {
        const callId = typeof item.call_id === 'string' ? item.call_id : '';
        const toolName = typeof item.name === 'string' ? item.name : 'unknown_tool';
        const toolArgs = parseToolArguments(typeof item.arguments === 'string' ? item.arguments : undefined);
        const traceIndex = toolCalls.length;
        toolCalls.push({
          round,
          name: toolName,
          args: toolArgs,
          resultPreview: '',
        });

        const tool = toolByName.get(toolName);
        if (!tool) {
          const result = { error: `Unknown tool: ${toolName}` };
          toolCalls[traceIndex].resultPreview = truncateText(JSON.stringify(result), 800);
          validationErrors.push(`unknown_tool:${toolName}`);
          if (callId) {
            toolOutputs.push({
              type: 'function_call_output',
              call_id: callId,
              output: JSON.stringify(result),
            });
          }
          continue;
        }

        const result = await tool.execute({
          input: toolArgs,
          context: runContext,
        });
        toolCalls[traceIndex].resultPreview = truncateText(JSON.stringify(result), 800);
        if (callId) {
          toolOutputs.push({
            type: 'function_call_output',
            call_id: callId,
            output: JSON.stringify(result),
          });
        }
      }

      if (finalSubmission) {
        break;
      }

      if (toolOutputs.length === 0) {
        break;
      }

      nextInput = toolOutputs;
    }

    const submission = finalSubmission as AssistantFinalSubmission | null;

    if (!submission) {
      return buildFallbackChat({
        provider: providerConfig.provider,
        model: providerConfig.model,
        reason: 'missing_finalization_tool',
        message: 'Assistant request completed without a final response tool call. Please retry.',
        debugTrace: {
          ...debugTraceBase,
          modelRounds: responseCount,
          toolCalls,
          validationErrors,
          parsedPayloadPreview,
          finalResponsePreview,
        },
      });
    }

    parsedPayloadPreview ||= truncateText(JSON.stringify(submission), 2000);

    if (submission.mode === 'chat') {
      return {
        provider: providerConfig.provider,
        model: providerConfig.model,
        mode: 'chat',
        answer: submission.answer,
        debugTrace: {
          ...debugTraceBase,
          modelRounds: responseCount,
          toolCalls,
          validationErrors,
          parsedPayloadPreview,
          finalResponsePreview,
          finalVerdict: 'chat',
        },
      };
    }

    const normalized = normalizeProposedEditsShape(submission.proposedEdits);
    const parsed = validateSemanticOpsPayload(normalized.value);
    if (!parsed.ok) {
      return buildFallbackChat({
        provider: providerConfig.provider,
        model: providerConfig.model,
        reason: 'schema_validation_failed',
        message: `I couldn't apply executable edits this turn because the edit payload was invalid (schema_validation_failed). Please retry with concrete scene/object names or IDs.\n\nValidation: ${parsed.errors.slice(0, 4).join('; ')}${parsed.errors.length > 4 ? '; ...' : ''}`,
        debugTrace: {
          ...debugTraceBase,
          modelRounds: responseCount,
          toolCalls,
          validationErrors: [...validationErrors, ...parsed.errors],
          parsedPayloadPreview,
          finalResponsePreview,
        },
      });
    }

    const editTrace: AssistantTrace = {
      ...debugTraceBase,
      modelRounds: responseCount,
      toolCalls,
      validationErrors,
      parsedPayloadPreview,
      finalResponsePreview,
      finalVerdict: 'edit',
    };

    if (isRecord(normalized) && (normalized.movedProjectOpsFromSemantic > 0 || normalized.renamedProjectOps > 0)) {
      editTrace.validationErrors = [
        ...editTrace.validationErrors,
        `normalized_project_ops:moved=${normalized.movedProjectOpsFromSemantic};renamed=${normalized.renamedProjectOps}`,
      ];
    }

    return {
      provider: providerConfig.provider,
      model: providerConfig.model,
      mode: 'edit',
      proposedEdits: parsed.value as ProposedEdits,
      debugTrace: editTrace,
    };
  } catch (error) {
    const err = error as OpenAIApiError;
    const message = err?.error?.message || err?.message || String(error);
    return buildFallbackChat({
      provider: providerConfig.provider,
      model: providerConfig.model,
      reason: 'assistant_transport_error',
      message: `Assistant request failed safely.\n\n${truncate(message, 280)}`,
      debugTrace: {
        ...debugTraceBase,
        validationErrors: [`transport:${truncate(message, 280)}`],
      },
    });
  }
}

export type {
  AssistantProviderCredentials,
  UnifiedAssistantTurnRequest,
};
