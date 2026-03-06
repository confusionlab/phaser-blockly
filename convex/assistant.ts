import OpenAI from "openai";
import { v } from "convex/values";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  applyAssistantProjectOperations,
  getAssistantFolderSummary,
  listAssistantEntityReferences,
  materializeAssistantOperationIds,
  validateAssistantProjectState,
  type AssistantChangeSet,
  type AssistantOperationResult,
  type AssistantProjectOperation,
  type AssistantProjectSnapshot,
  type AssistantProjectState,
  type AssistantReferenceEntityType,
  type AssistantValidationIssue,
} from "../packages/ui-shared/src/assistant";
import {
  buildAssistantRunInputText,
  normalizeAssistantConversationTurns,
  type AssistantConversationTurn,
} from "../packages/ui-shared/src/assistantConversation";
import {
  buildAssistantModelComponent,
  buildAssistantModelObject,
  buildAssistantModelScene,
} from "../packages/ui-shared/src/assistantReadModel";

const internalAssistant = (internal as any).assistant;
const ASSISTANT_SNAPSHOT_MISSING_ERROR = "assistant_snapshot_missing_for_project_version";

type AssistantRunStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type AssistantRunMode = "mutate" | "analyze";

type StoredRun = {
  _id: Id<"assistantRuns">;
  ownerUserId?: string;
  projectId: string;
  mode: AssistantRunMode;
  status: AssistantRunStatus;
  requestText: string;
  conversationHistoryJson?: string;
  projectVersion: string;
  snapshotId: Id<"assistantSnapshots">;
  finalSummary?: string;
  changeSetJson?: string;
  errorCode?: string;
  errorMessage?: string;
  tokenUsageJson?: string;
  stepCount?: number;
  model?: string;
  appliedAt?: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  failedAt?: number;
};

const runValidator = v.object({
  _id: v.id("assistantRuns"),
  projectId: v.string(),
  mode: v.union(v.literal("mutate"), v.literal("analyze")),
  status: v.union(
    v.literal("queued"),
    v.literal("running"),
    v.literal("completed"),
    v.literal("failed"),
    v.literal("cancelled"),
  ),
  requestText: v.string(),
  conversationHistoryJson: v.optional(v.string()),
  projectVersion: v.string(),
  finalSummary: v.optional(v.string()),
  changeSetJson: v.optional(v.string()),
  errorCode: v.optional(v.string()),
  errorMessage: v.optional(v.string()),
  tokenUsageJson: v.optional(v.string()),
  stepCount: v.optional(v.number()),
  model: v.optional(v.string()),
  appliedAt: v.optional(v.number()),
  createdAt: v.number(),
  startedAt: v.optional(v.number()),
  completedAt: v.optional(v.number()),
  failedAt: v.optional(v.number()),
});

const runEventValidator = v.object({
  _id: v.id("assistantRunEvents"),
  runId: v.id("assistantRuns"),
  sequence: v.number(),
  type: v.string(),
  payloadJson: v.string(),
  createdAt: v.number(),
});

async function requireAuthenticatedUserId(ctx: any): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (identity?.subject) {
    return identity.subject;
  }

  const e2eBypassUserId = process.env.ASSISTANT_E2E_BYPASS_USER_ID?.trim();
  if (e2eBypassUserId) {
    return e2eBypassUserId;
  }

  throw new Error("unauthenticated");
}

function safeStringify(value: unknown): string {
  return JSON.stringify(value);
}

async function findReusableSnapshot(
  ctx: any,
  ownerUserId: string,
  projectId: string,
  projectVersion: string,
) {
  return await ctx.db
    .query("assistantSnapshots")
    .withIndex("by_ownerUserId_and_projectId_and_projectVersion_and_createdAt", (q: any) =>
      q
        .eq("ownerUserId", ownerUserId)
        .eq("projectId", projectId)
        .eq("projectVersion", projectVersion),
    )
    .order("desc")
    .first();
}

function parseSnapshot(snapshotJson: string): AssistantProjectSnapshot {
  return JSON.parse(snapshotJson) as AssistantProjectSnapshot;
}

function parseJsonObject<T>(value: string): T {
  return JSON.parse(value) as T;
}

function parseConversationHistory(conversationHistoryJson?: string): AssistantConversationTurn[] {
  if (!conversationHistoryJson) {
    return [];
  }

  try {
    const parsed = JSON.parse(conversationHistoryJson) as AssistantConversationTurn[];
    return normalizeAssistantConversationTurns(parsed);
  } catch {
    return [];
  }
}

function summarizeState(state: AssistantProjectState) {
  return {
    projectId: state.project.id,
    projectName: state.project.name,
    sceneCount: state.scenes.length,
    objectCount: state.scenes.reduce((count, scene) => count + scene.objects.length, 0),
    folderCount: state.scenes.reduce((count, scene) => count + scene.objectFolders.length, 0),
    componentCount: state.components.length,
    scenes: state.scenes.map((scene) => ({
      id: scene.id,
      name: scene.name,
      objectCount: scene.objects.length,
      folderCount: scene.objectFolders.length,
    })),
  };
}

function summarizeValidationIssues(issues: AssistantValidationIssue[]) {
  return issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    entityIds: issue.entityIds,
  }));
}

function getSceneSummary(state: AssistantProjectState, sceneId: string) {
  const scene = state.scenes.find((candidate) => candidate.id === sceneId);
  if (!scene) {
    throw new Error(`Scene "${sceneId}" was not found.`);
  }
  return scene;
}

function getObjectSummary(state: AssistantProjectState, sceneId: string, objectId: string) {
  const scene = getSceneSummary(state, sceneId);
  const object = scene.objects.find((candidate) => candidate.id === objectId);
  if (!object) {
    throw new Error(`Object "${objectId}" was not found in scene "${sceneId}".`);
  }
  const linkedComponent = object.componentId
    ? state.components.find((component) => component.id === object.componentId) ?? null
    : null;

  return {
    ...object,
    logicOwner: linkedComponent
      ? { type: "component" as const, componentId: linkedComponent.id }
      : { type: "object" as const, objectId: object.id },
    effectiveBlocklyXml: linkedComponent?.blocklyXml ?? object.blocklyXml,
    effectivePhysics: linkedComponent?.physics ?? object.physics,
    effectiveCollider: linkedComponent?.collider ?? object.collider,
    linkedComponent,
  };
}

function getComponentSummary(state: AssistantProjectState, componentId: string) {
  const component = state.components.find((candidate) => candidate.id === componentId);
  if (!component) {
    throw new Error(`Component "${componentId}" was not found.`);
  }
  return component;
}

function searchEntities(state: AssistantProjectState, queryText: string) {
  const query = queryText.trim().toLowerCase();
  if (!query) {
    return {
      scenes: [],
      folders: [],
      objects: [],
      components: [],
      variables: [],
      messages: [],
    };
  }

  return {
    scenes: state.scenes
      .filter((scene) => scene.id.toLowerCase().includes(query) || scene.name.toLowerCase().includes(query))
      .map((scene) => ({ id: scene.id, name: scene.name })),
    folders: state.scenes.flatMap((scene) =>
      scene.objectFolders
        .filter((folder) => folder.id.toLowerCase().includes(query) || folder.name.toLowerCase().includes(query))
        .map((folder) => ({
          id: folder.id,
          name: folder.name,
          sceneId: scene.id,
        })),
    ),
    objects: state.scenes.flatMap((scene) =>
      scene.objects
        .filter((object) => object.id.toLowerCase().includes(query) || object.name.toLowerCase().includes(query))
        .map((object) => ({
          id: object.id,
          name: object.name,
          sceneId: scene.id,
          componentId: object.componentId ?? null,
        })),
    ),
    components: state.components
      .filter((component) => component.id.toLowerCase().includes(query) || component.name.toLowerCase().includes(query))
      .map((component) => ({ id: component.id, name: component.name })),
    variables: [...state.globalVariables, ...state.scenes.flatMap((scene) => scene.objects.flatMap((object) => object.localVariables))]
      .filter((variable) => variable.id.toLowerCase().includes(query) || variable.name.toLowerCase().includes(query))
      .map((variable) => ({
        id: variable.id,
        name: variable.name,
        scope: variable.scope,
        objectId: variable.objectId ?? null,
      })),
    messages: state.messages
      .filter((message) => message.id.toLowerCase().includes(query) || message.name.toLowerCase().includes(query))
      .map((message) => ({ id: message.id, name: message.name })),
  };
}

function buildMutationResult(
  operation: AssistantProjectOperation,
  result: AssistantOperationResult,
) {
  return {
    ok: true,
    operation,
    createdEntities: result.createdEntities,
    affectedEntityIds: result.affectedEntityIds,
    validationIssues: summarizeValidationIssues(result.issues),
    stateSummary: summarizeState(result.state),
  };
}

function buildToolError(message: string, code = "tool_error", details?: unknown) {
  return {
    ok: false,
    error: {
      code,
      message,
      details: details ?? null,
    },
  };
}

function createChangeSet(
  state: AssistantProjectState,
  baseProjectVersion: string,
  operations: AssistantProjectOperation[],
  summary: string,
): AssistantChangeSet {
  const affected = new Set<string>();
  for (const operation of operations) {
    switch (operation.kind) {
      case "delete_scene":
      case "rename_scene":
      case "update_scene_properties":
        affected.add(operation.sceneId);
        break;
      case "reorder_scenes":
        operation.sceneIds.forEach((sceneId) => affected.add(sceneId));
        break;
      case "delete_folder":
      case "rename_folder":
      case "move_folder":
        affected.add(operation.sceneId);
        affected.add(operation.folderId);
        break;
      case "delete_object":
      case "rename_object":
      case "move_object":
      case "update_object_properties":
      case "set_object_blockly_xml":
      case "set_object_logic":
        affected.add(operation.sceneId);
        affected.add(operation.objectId);
        break;
      case "duplicate_object":
        affected.add(operation.sceneId);
        affected.add(operation.objectId);
        if (operation.duplicateObjectId) {
          affected.add(operation.duplicateObjectId);
        }
        break;
      case "make_component":
        affected.add(operation.sceneId);
        affected.add(operation.objectId);
        if (operation.componentId) {
          affected.add(operation.componentId);
        }
        break;
      case "add_component_instance":
        affected.add(operation.sceneId);
        affected.add(operation.componentId);
        if (operation.objectId) {
          affected.add(operation.objectId);
        }
        break;
      case "detach_from_component":
        affected.add(operation.sceneId);
        affected.add(operation.objectId);
        break;
      case "delete_component":
      case "rename_component":
      case "update_component_properties":
      case "set_component_blockly_xml":
      case "set_component_logic":
        affected.add(operation.componentId);
        break;
      case "create_folder":
        affected.add(operation.sceneId);
        if (operation.folderId) {
          affected.add(operation.folderId);
        }
        break;
      case "create_object":
        affected.add(operation.sceneId);
        if (operation.objectId) {
          affected.add(operation.objectId);
        }
        break;
      case "create_scene":
        if (operation.sceneId) {
          affected.add(operation.sceneId);
        } else {
          affected.add(state.project.id);
        }
        break;
      case "update_project_settings":
        break;
    }
  }

  return {
    baseProjectId: state.project.id,
    baseProjectVersion,
    operations,
    summary,
    affectedEntityIds: [...affected],
  };
}

const logicConditionAtomSchema = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["key_pressed"] },
        key: { type: "string" },
      },
      required: ["kind", "key"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["touching_ground"] },
      },
      required: ["kind"],
    },
  ],
} as const;

const logicConditionSchema = {
  anyOf: [
    logicConditionAtomSchema,
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["all", "any"] },
        conditions: {
          type: "array",
          items: logicConditionAtomSchema,
        },
      },
      required: ["kind", "conditions"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["not"] },
        condition: logicConditionAtomSchema,
      },
      required: ["kind", "condition"],
    },
  ],
} as const;

const logicPrimitiveActionSchema = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["set_velocity"] },
        x: { type: "number" },
        y: { type: "number" },
      },
      required: ["kind", "x", "y"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["set_velocity_x", "set_velocity_y", "change_x", "change_y"] },
        value: { type: "number" },
      },
      required: ["kind", "value"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["wait"] },
        seconds: { type: "number" },
      },
      required: ["kind", "seconds"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["broadcast"] },
        message: { type: "string" },
        wait: { type: "boolean" },
      },
      required: ["kind", "message"],
    },
  ],
} as const;

const logicActionSchema = {
  anyOf: [
    logicPrimitiveActionSchema,
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["if"] },
        condition: logicConditionSchema,
        thenActions: {
          type: "array",
          items: logicPrimitiveActionSchema,
        },
        elseActions: {
          type: "array",
          items: logicPrimitiveActionSchema,
        },
      },
      required: ["kind", "condition", "thenActions"],
    },
  ],
} as const;

const logicTriggerSchema = {
  anyOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["on_start"] },
      },
      required: ["kind"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["forever"] },
      },
      required: ["kind"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["on_clicked"] },
      },
      required: ["kind"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["on_key_pressed"] },
        key: { type: "string" },
      },
      required: ["kind", "key"],
    },
  ],
} as const;

const logicProgramSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    formatVersion: { type: "number", enum: [1] },
    scripts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          trigger: logicTriggerSchema,
          actions: {
            type: "array",
            items: logicActionSchema,
          },
        },
        required: ["trigger", "actions"],
      },
    },
  },
  required: ["formatVersion", "scripts"],
} as const;

const rawToolDefinitions: OpenAI.Responses.Tool[] = [
  {
    type: "function",
    name: "emit_progress",
    description: "Emit a concise user-visible progress update before or during work.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        message: { type: "string" },
      },
      required: ["message"],
    },
  },
  {
    type: "function",
    name: "get_project_summary",
    description: "Read the staged project summary, including scene and object counts.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "get_scene",
    description: "Read one scene with folders, objects, camera, and background details.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
      },
      required: ["sceneId"],
    },
  },
  {
    type: "function",
    name: "get_folder",
    description: "Read one folder inside a scene, including its direct child folders and direct child objects.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
        folderId: { type: "string" },
      },
      required: ["sceneId", "folderId"],
    },
  },
  {
    type: "function",
    name: "get_object",
    description: "Read one object and its effective logic owner. Use this before editing complex object logic.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
        objectId: { type: "string" },
      },
      required: ["sceneId", "objectId"],
    },
  },
  {
    type: "function",
    name: "get_component",
    description: "Read one component definition when an object is backed by a component.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        componentId: { type: "string" },
      },
      required: ["componentId"],
    },
  },
  {
    type: "function",
    name: "search_entities",
    description: "Search scenes, folders, objects, components, variables, and messages by name or id.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        query: { type: "string" },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "list_references",
    description: "List direct references for a scene, folder, object, or component before destructive edits or moves.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        entityType: { type: "string", enum: ["scene", "folder", "object", "component"] },
        id: { type: "string" },
        sceneId: { type: "string" },
      },
      required: ["entityType", "id"],
    },
  },
  {
    type: "function",
    name: "inspect_validation_issues",
    description: "Inspect the current staged validation issues, if any.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {},
      required: [],
    },
  },
  {
    type: "function",
    name: "update_project_settings",
    description: "Update project-level settings like canvas size or background color.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        settings: {
          type: "object",
          additionalProperties: false,
          properties: {
            canvasWidth: { type: "number" },
            canvasHeight: { type: "number" },
            backgroundColor: { type: "string" },
          },
        },
      },
      required: ["settings"],
    },
  },
  {
    type: "function",
    name: "create_scene",
    description: "Create a new scene. Provide sceneId when you will reference the new scene later in the same run.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        name: { type: "string" },
        sceneId: { type: "string" },
        insertIndex: { type: "number" },
      },
      required: ["name"],
    },
  },
  {
    type: "function",
    name: "delete_scene",
    description: "Delete a scene. Never use this if it would remove the final remaining scene.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
      },
      required: ["sceneId"],
    },
  },
  {
    type: "function",
    name: "rename_scene",
    description: "Rename an existing scene.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
        name: { type: "string" },
      },
      required: ["sceneId", "name"],
    },
  },
  {
    type: "function",
    name: "reorder_scenes",
    description: "Reorder all scenes by providing the complete ordered scene id list.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneIds: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["sceneIds"],
    },
  },
  {
    type: "function",
    name: "update_scene_properties",
    description: "Update scene camera config or ground config.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
        properties: {
          type: "object",
          additionalProperties: false,
          properties: {
            cameraConfig: {
              type: "object",
              additionalProperties: false,
              properties: {
                followTarget: { anyOf: [{ type: "string" }, { type: "null" }] },
                bounds: {
                  anyOf: [
                    { type: "null" },
                    {
                      type: "object",
                      additionalProperties: false,
                      properties: {
                        x: { type: "number" },
                        y: { type: "number" },
                        width: { type: "number" },
                        height: { type: "number" },
                      },
                      required: ["x", "y", "width", "height"],
                    },
                  ],
                },
                zoom: { type: "number" },
              },
            },
            ground: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    enabled: { type: "boolean" },
                    y: { type: "number" },
                    color: { type: "string" },
                  },
                  required: ["enabled", "y", "color"],
                },
              ],
            },
          },
        },
      },
      required: ["sceneId", "properties"],
    },
  },
  {
    type: "function",
    name: "create_folder",
    description: "Create a folder inside a scene. Provide folderId when you will reference the new folder later in the same run.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
        name: { type: "string" },
        folderId: { type: "string" },
        parentId: { anyOf: [{ type: "string" }, { type: "null" }] },
        index: { type: "number" },
      },
      required: ["sceneId", "name"],
    },
  },
  {
    type: "function",
    name: "delete_folder",
    description: "Delete a folder and everything nested under it in the scene tree.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
        folderId: { type: "string" },
      },
      required: ["sceneId", "folderId"],
    },
  },
  {
    type: "function",
    name: "rename_folder",
    description: "Rename a folder.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
        folderId: { type: "string" },
        name: { type: "string" },
      },
      required: ["sceneId", "folderId", "name"],
    },
  },
  {
    type: "function",
    name: "move_folder",
    description: "Move a folder to a new parent or order index.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
        folderId: { type: "string" },
        parentId: { anyOf: [{ type: "string" }, { type: "null" }] },
        index: { type: "number" },
      },
      required: ["sceneId", "folderId"],
    },
  },
  {
    type: "function",
    name: "create_object",
    description: "Create a new object in a scene or folder. Provide objectId when you will reference the new object later in the same run.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
        name: { type: "string" },
        objectId: { type: "string" },
        parentId: { anyOf: [{ type: "string" }, { type: "null" }] },
        index: { type: "number" },
        properties: {
          type: "object",
          additionalProperties: false,
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            scaleX: { type: "number" },
            scaleY: { type: "number" },
            rotation: { type: "number" },
            visible: { type: "boolean" },
            currentCostumeIndex: { type: "number" },
          },
        },
      },
      required: ["sceneId", "name"],
    },
  },
  {
    type: "function",
    name: "delete_object",
    description: "Delete an object from a scene.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
        objectId: { type: "string" },
        duplicateObjectId: { type: "string" },
      },
      required: ["sceneId", "objectId"],
    },
  },
  {
    type: "function",
    name: "rename_object",
    description: "Rename an object.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
        objectId: { type: "string" },
        name: { type: "string" },
      },
      required: ["sceneId", "objectId", "name"],
    },
  },
  {
    type: "function",
    name: "move_object",
    description: "Move an object to a new folder or order index.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
        objectId: { type: "string" },
        parentId: { anyOf: [{ type: "string" }, { type: "null" }] },
        index: { type: "number" },
      },
      required: ["sceneId", "objectId"],
    },
  },
  {
    type: "function",
    name: "duplicate_object",
    description: "Duplicate an object in place. Provide duplicateObjectId when you will reference the copy later in the same run. Use follow-up rename, move, or property tools to customize the copy.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
        objectId: { type: "string" },
      },
      required: ["sceneId", "objectId"],
    },
  },
  {
    type: "function",
    name: "update_object_properties",
    description: "Update object properties. Do not use for gameplay logic. For component-backed logic or physics, inspect the object first and then edit the component instead if needed.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
        objectId: { type: "string" },
        properties: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
            scaleX: { type: "number" },
            scaleY: { type: "number" },
            rotation: { type: "number" },
            visible: { type: "boolean" },
            currentCostumeIndex: { type: "number" },
            physics: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    enabled: { type: "boolean" },
                    bodyType: { type: "string", enum: ["dynamic", "static"] },
                    gravityY: { type: "number" },
                    velocityX: { type: "number" },
                    velocityY: { type: "number" },
                    bounce: { type: "number" },
                    friction: { type: "number" },
                    allowRotation: { type: "boolean" },
                  },
                  required: ["enabled", "bodyType", "gravityY", "velocityX", "velocityY", "bounce", "friction", "allowRotation"],
                },
              ],
            },
            collider: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    type: { type: "string", enum: ["none", "box", "circle", "capsule"] },
                    offsetX: { type: "number" },
                    offsetY: { type: "number" },
                    width: { type: "number" },
                    height: { type: "number" },
                    radius: { type: "number" },
                  },
                  required: ["type", "offsetX", "offsetY", "width", "height", "radius"],
                },
              ],
            },
          },
        },
      },
      required: ["sceneId", "objectId", "properties"],
    },
  },
  {
    type: "function",
    name: "set_object_logic",
    description: "Replace an object's gameplay logic using a typed logic program. Use this only when the object owns its logic. If the object is component-backed, edit the component instead.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
        objectId: { type: "string" },
        logic: logicProgramSchema,
      },
      required: ["sceneId", "objectId", "logic"],
    },
  },
  {
    type: "function",
    name: "make_component",
    description: "Convert a standalone object into a reusable component while keeping the object as the first instance. Provide componentId when you will reference the new component later in the same run.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
        objectId: { type: "string" },
        componentId: { type: "string" },
        name: { type: "string" },
      },
      required: ["sceneId", "objectId"],
    },
  },
  {
    type: "function",
    name: "delete_component",
    description: "Delete a component definition. Existing instances become standalone objects and keep the component's current fields.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        componentId: { type: "string" },
      },
      required: ["componentId"],
    },
  },
  {
    type: "function",
    name: "add_component_instance",
    description: "Create a new object instance from a reusable component inside a scene or folder. Provide objectId when you will reference the new instance later in the same run.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
        componentId: { type: "string" },
        objectId: { type: "string" },
        parentId: { anyOf: [{ type: "string" }, { type: "null" }] },
        index: { type: "number" },
        properties: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
            scaleX: { type: "number" },
            scaleY: { type: "number" },
            rotation: { type: "number" },
            visible: { type: "boolean" },
          },
        },
      },
      required: ["sceneId", "componentId"],
    },
  },
  {
    type: "function",
    name: "detach_from_component",
    description: "Detach one object from its component so it becomes a standalone object with copied fields.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        sceneId: { type: "string" },
        objectId: { type: "string" },
      },
      required: ["sceneId", "objectId"],
    },
  },
  {
    type: "function",
    name: "rename_component",
    description: "Rename a component definition.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        componentId: { type: "string" },
        name: { type: "string" },
      },
      required: ["componentId", "name"],
    },
  },
  {
    type: "function",
    name: "update_component_properties",
    description: "Update component-level shared physics, collider, or costume selection.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        componentId: { type: "string" },
        properties: {
          type: "object",
          additionalProperties: false,
          properties: {
            name: { type: "string" },
            currentCostumeIndex: { type: "number" },
            physics: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    enabled: { type: "boolean" },
                    bodyType: { type: "string", enum: ["dynamic", "static"] },
                    gravityY: { type: "number" },
                    velocityX: { type: "number" },
                    velocityY: { type: "number" },
                    bounce: { type: "number" },
                    friction: { type: "number" },
                    allowRotation: { type: "boolean" },
                  },
                  required: ["enabled", "bodyType", "gravityY", "velocityX", "velocityY", "bounce", "friction", "allowRotation"],
                },
              ],
            },
            collider: {
              anyOf: [
                { type: "null" },
                {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    type: { type: "string", enum: ["none", "box", "circle", "capsule"] },
                    offsetX: { type: "number" },
                    offsetY: { type: "number" },
                    width: { type: "number" },
                    height: { type: "number" },
                    radius: { type: "number" },
                  },
                  required: ["type", "offsetX", "offsetY", "width", "height", "radius"],
                },
              ],
            },
          },
        },
      },
      required: ["componentId", "properties"],
    },
  },
  {
    type: "function",
    name: "set_component_logic",
    description: "Replace a component definition's shared gameplay logic using a typed logic program.",
    strict: true,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        componentId: { type: "string" },
        logic: logicProgramSchema,
      },
      required: ["componentId", "logic"],
    },
  },
];

const toolDefinitions: OpenAI.Responses.Tool[] = rawToolDefinitions.map((tool) =>
  tool.type === "function"
    ? {
        ...tool,
        strict: false,
      }
    : tool,
);

export const createRun = mutation({
  args: {
    projectId: v.string(),
    mode: v.union(v.literal("mutate"), v.literal("analyze")),
    requestText: v.string(),
    conversationHistoryJson: v.optional(v.string()),
    projectVersion: v.string(),
    snapshotJson: v.optional(v.string()),
  },
  returns: v.object({
    runId: v.id("assistantRuns"),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const activeRuns = await ctx.db
      .query("assistantRuns")
      .withIndex("by_ownerUserId_and_projectId_and_createdAt", (q) =>
        q.eq("ownerUserId", ownerUserId).eq("projectId", args.projectId),
      )
      .collect();

    if (activeRuns.some((run) => run.status === "queued" || run.status === "running")) {
      throw new Error("An assistant run is already active for this project.");
    }

    const existingSnapshot = await findReusableSnapshot(
      ctx,
      ownerUserId,
      args.projectId,
      args.projectVersion,
    );
    let snapshotId = existingSnapshot?._id;
    if (!snapshotId) {
      if (!args.snapshotJson) {
        throw new Error(ASSISTANT_SNAPSHOT_MISSING_ERROR);
      }

      snapshotId = await ctx.db.insert("assistantSnapshots", {
        ownerUserId,
        projectId: args.projectId,
        projectVersion: args.projectVersion,
        snapshotJson: args.snapshotJson,
        source: "full",
        createdAt: Date.now(),
      });
    }

    const runId = await ctx.db.insert("assistantRuns", {
      ownerUserId,
      projectId: args.projectId,
      mode: args.mode,
      status: "queued",
      requestText: args.requestText,
      conversationHistoryJson: args.conversationHistoryJson,
      projectVersion: args.projectVersion,
      snapshotId,
      createdAt: Date.now(),
    });

    await ctx.db.insert("assistantRunEvents", {
      runId,
      sequence: 0,
      type: "editor_locked",
      payloadJson: safeStringify({
        runId,
        projectId: args.projectId,
        status: "queued",
      }),
      createdAt: Date.now(),
    });

    await ctx.db.insert("assistantRunEvents", {
      runId,
      sequence: 1,
      type: "run_started",
      payloadJson: safeStringify({
        runId,
        projectId: args.projectId,
        mode: args.mode,
        requestText: args.requestText,
        conversationTurnCount: parseConversationHistory(args.conversationHistoryJson).length,
      }),
      createdAt: Date.now(),
    });

    await ctx.scheduler.runAfter(0, internalAssistant.executeRunInternal, { runId });


    return { runId };
  },
});

export const getRun = query({
  args: {
    runId: v.id("assistantRuns"),
  },
  returns: v.union(runValidator, v.null()),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerUserId !== ownerUserId) {
      return null;
    }
    return {
      _id: run._id,
      projectId: run.projectId,
      mode: run.mode,
      status: run.status,
      requestText: run.requestText,
      conversationHistoryJson: run.conversationHistoryJson,
      projectVersion: run.projectVersion,
      finalSummary: run.finalSummary,
      changeSetJson: run.changeSetJson,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      tokenUsageJson: run.tokenUsageJson,
      stepCount: run.stepCount,
      model: run.model,
      appliedAt: run.appliedAt,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      failedAt: run.failedAt,
    };
  },
});

export const listRunEvents = query({
  args: {
    runId: v.id("assistantRuns"),
  },
  returns: v.array(runEventValidator),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerUserId !== ownerUserId) {
      return [];
    }
    const events = await ctx.db
      .query("assistantRunEvents")
      .withIndex("by_runId_and_sequence", (q) => q.eq("runId", args.runId))
      .collect();
    return events.map((event) => ({
      _id: event._id,
      runId: event.runId,
      sequence: event.sequence,
      type: event.type,
      payloadJson: event.payloadJson,
      createdAt: event.createdAt,
    }));
  },
});

export const markRunApplied = mutation({
  args: {
    runId: v.id("assistantRuns"),
  },
  returns: v.object({
    applied: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerUserId = await requireAuthenticatedUserId(ctx);
    const run = await ctx.db.get(args.runId);
    if (!run || run.ownerUserId !== ownerUserId) {
      return { applied: false };
    }
    if (run.status !== "completed" || !run.changeSetJson || run.appliedAt) {
      return { applied: false };
    }

    await ctx.db.patch(args.runId, { appliedAt: Date.now() });
    const lastEvent = await ctx.db
      .query("assistantRunEvents")
      .withIndex("by_runId_and_sequence", (q) => q.eq("runId", args.runId))
      .order("desc")
      .first();
    const nextSequence = lastEvent ? lastEvent.sequence + 1 : 0;
    await ctx.db.insert("assistantRunEvents", {
      runId: args.runId,
      sequence: nextSequence,
      type: "changes_applied",
      payloadJson: safeStringify({
        runId: args.runId,
        appliedAt: Date.now(),
      }),
      createdAt: Date.now(),
    });
    return { applied: true };
  },
});

export const executeRun = action({
  args: {
    runId: v.id("assistantRuns"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runAction(internalAssistant.executeRunInternal, args);
    return null;
  },
});

export const getRunContextInternal = internalQuery({
  args: {
    runId: v.id("assistantRuns"),
  },
  returns: v.union(
    v.object({
      run: v.object({
        _id: v.id("assistantRuns"),
        projectId: v.string(),
        mode: v.union(v.literal("mutate"), v.literal("analyze")),
        status: v.union(
          v.literal("queued"),
          v.literal("running"),
          v.literal("completed"),
          v.literal("failed"),
          v.literal("cancelled"),
        ),
        requestText: v.string(),
        conversationHistoryJson: v.optional(v.string()),
        projectVersion: v.string(),
        snapshotId: v.id("assistantSnapshots"),
      }),
      snapshot: v.object({
        _id: v.id("assistantSnapshots"),
        projectId: v.string(),
        projectVersion: v.string(),
        snapshotJson: v.string(),
      }),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const run = await ctx.db.get(args.runId);
    if (!run) return null;
    const snapshot = await ctx.db.get(run.snapshotId);
    if (!snapshot) return null;
    return {
      run: {
        _id: run._id,
        projectId: run.projectId,
        mode: run.mode,
        status: run.status,
        requestText: run.requestText,
        conversationHistoryJson: run.conversationHistoryJson,
        projectVersion: run.projectVersion,
        snapshotId: run.snapshotId,
      },
      snapshot: {
        _id: snapshot._id,
        projectId: snapshot.projectId,
        projectVersion: snapshot.projectVersion,
        snapshotJson: snapshot.snapshotJson,
      },
    };
  },
});

export const appendRunEventInternal = internalMutation({
  args: {
    runId: v.id("assistantRuns"),
    type: v.string(),
    payloadJson: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const lastEvent = await ctx.db
      .query("assistantRunEvents")
      .withIndex("by_runId_and_sequence", (q) => q.eq("runId", args.runId))
      .order("desc")
      .first();
    const nextSequence = lastEvent ? lastEvent.sequence + 1 : 0;
    await ctx.db.insert("assistantRunEvents", {
      runId: args.runId,
      sequence: nextSequence,
      type: args.type,
      payloadJson: args.payloadJson,
      createdAt: Date.now(),
    });
    return null;
  },
});

export const setRunStatusInternal = internalMutation({
  args: {
    runId: v.id("assistantRuns"),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    startedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    failedAt: v.optional(v.number()),
    finalSummary: v.optional(v.string()),
    changeSetJson: v.optional(v.string()),
    errorCode: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
    tokenUsageJson: v.optional(v.string()),
    stepCount: v.optional(v.number()),
    model: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const patch: Partial<StoredRun> = {
      status: args.status,
    };
    if (args.startedAt !== undefined) patch.startedAt = args.startedAt;
    if (args.completedAt !== undefined) patch.completedAt = args.completedAt;
    if (args.failedAt !== undefined) patch.failedAt = args.failedAt;
    if (args.finalSummary !== undefined) patch.finalSummary = args.finalSummary;
    if (args.changeSetJson !== undefined) patch.changeSetJson = args.changeSetJson;
    if (args.errorCode !== undefined) patch.errorCode = args.errorCode;
    if (args.errorMessage !== undefined) patch.errorMessage = args.errorMessage;
    if (args.tokenUsageJson !== undefined) patch.tokenUsageJson = args.tokenUsageJson;
    if (args.stepCount !== undefined) patch.stepCount = args.stepCount;
    if (args.model !== undefined) patch.model = args.model;
    await ctx.db.patch(args.runId, patch);
    return null;
  },
});

function buildSystemInstructions(mode: AssistantRunMode) {
  return [
    "You are the PochaCoding AI coding assistant.",
    "You are operating on a staged project state inside Convex.",
    "Never assume IDs. Read them from the provided snapshot or query tools.",
    "Use emit_progress before significant work and when your plan changes.",
    "Use the domain tools only. Do not invent unsupported operations.",
    "Prefer the narrowest inspection tool that answers the question: get_scene/get_folder/get_object/get_component before broad search when you already know the target.",
    "Before deleting or moving scenes, folders, objects, or components when impact is unclear, call list_references first.",
    "When you create a scene, folder, object, or component that you will reference again in the same run, provide a stable id in that create call and reuse it in follow-up calls.",
    "When a write tool creates or duplicates an entity and you need to use it later in the same run, reuse the id returned in createdEntities instead of guessing by name.",
    "After duplicate_object, keep the original object unchanged unless the user explicitly asks to edit it too. Apply follow-up rename/move/property edits to the newly created duplicate id.",
    "If the user wants reusable actors, use make_component to convert a standalone object, add_component_instance to place copies, and detach_from_component to break inheritance for one object.",
    "Never write or describe raw Blockly XML. Use set_object_logic or set_component_logic with typed JSON logic programs instead.",
    "For continuous movement, prefer a forever trigger and explicitly reset horizontal velocity to 0 before conditional left/right movement.",
    "For jumping, use an if condition with all:[key_pressed, touching_ground] and set_velocity_y for the jump impulse.",
    "Use only the supported typed logic actions and conditions from the tool schema. Do not invent new action kinds.",
    "For mutate runs, stage safe project operations until the request is fulfilled, then return a concise final summary.",
    "For analyze runs, do not call mutation tools. Read state, diagnose, and return a concise explanation.",
    "If an object is component-backed, inspect the component and edit the component for shared logic/physics/collider changes.",
    "If a tool returns an error or validation issue, repair the plan and continue when possible.",
    mode === "mutate"
      ? "This is a mutate run. If no changes are needed, explain that clearly."
      : "This is an analyze run. Do not attempt any mutation.",
  ].join("\n");
}

function buildInitialInput(
  requestText: string,
  snapshot: AssistantProjectSnapshot,
  mode: AssistantRunMode,
  conversationHistory: readonly AssistantConversationTurn[],
) {
  return [
    {
      role: "user" as const,
      content: [
        {
          type: "input_text" as const,
          text: buildAssistantRunInputText({
            mode,
            requestText,
            snapshot,
            conversationHistory,
          }),
        },
      ],
    },
  ];
}

type ToolExecutionContext = {
  runId: Id<"assistantRuns">;
  mode: AssistantRunMode;
  stagedState: AssistantProjectState;
  stagedOperations: AssistantProjectOperation[];
};

async function appendRunEvent(
  ctx: any,
  runId: Id<"assistantRuns">,
  type: string,
  payload: unknown,
) {
  await ctx.runMutation(internalAssistant.appendRunEventInternal, {
    runId,
    type,
    payloadJson: safeStringify(payload),
  });
}

async function executeToolCall(
  ctx: any,
  toolCall: OpenAI.Responses.ResponseFunctionToolCall,
  execution: ToolExecutionContext,
) {
  let parsedArgs: Record<string, unknown>;
  try {
    parsedArgs = toolCall.arguments ? parseJsonObject<Record<string, unknown>>(toolCall.arguments) : {};
  } catch (error) {
    return buildToolError(
      error instanceof Error ? error.message : "Failed to parse tool arguments.",
      "invalid_arguments",
    );
  }

  await appendRunEvent(ctx, execution.runId, "tool_call_started", {
    runId: execution.runId,
    tool: toolCall.name,
    args: parsedArgs,
  });

  const toolResult = await performTool(ctx, toolCall.name, parsedArgs, execution);

  if ((toolResult as { ok?: boolean }).ok === false) {
    await appendRunEvent(ctx, execution.runId, "validation_failed", {
      runId: execution.runId,
      tool: toolCall.name,
      args: parsedArgs,
      result: toolResult,
    });
  }

  await appendRunEvent(ctx, execution.runId, "tool_call_finished", {
    runId: execution.runId,
    tool: toolCall.name,
    result: toolResult,
  });

  return toolResult;
}

function refuseMutationTool(mode: AssistantRunMode, toolName: string) {
  if (mode !== "analyze") return null;

  const readOnlyTools = new Set([
    "emit_progress",
    "get_project_summary",
    "get_scene",
    "get_folder",
    "get_object",
    "get_component",
    "search_entities",
    "list_references",
    "inspect_validation_issues",
  ]);
  if (readOnlyTools.has(toolName)) return null;
  return buildToolError(`Tool "${toolName}" is not allowed in analyze mode.`, "analyze_mode_write_blocked");
}

async function performTool(
  ctx: any,
  toolName: string,
  args: Record<string, unknown>,
  execution: ToolExecutionContext,
) {
  const blocked = refuseMutationTool(execution.mode, toolName);
  if (blocked) return blocked;

  try {
    switch (toolName) {
      case "emit_progress": {
        const message = typeof args.message === "string" ? args.message : "";
        await appendRunEvent(ctx, execution.runId, "reasoning_delta", {
          runId: execution.runId,
          text: message.trim(),
        });
        return { ok: true };
      }
      case "get_project_summary":
        return {
          ok: true,
          summary: summarizeState(execution.stagedState),
        };
      case "get_scene":
        return {
          ok: true,
          scene: buildAssistantModelScene(getSceneSummary(execution.stagedState, String(args.sceneId ?? ""))),
        };
      case "get_folder":
        return {
          ok: true,
          folder: getAssistantFolderSummary(
            execution.stagedState,
            String(args.sceneId ?? ""),
            String(args.folderId ?? ""),
          ),
        };
      case "get_object":
        {
          const object = getObjectSummary(
            execution.stagedState,
            String(args.sceneId ?? ""),
            String(args.objectId ?? ""),
          );
          return {
            ok: true,
            object: {
              ...buildAssistantModelObject(object),
              logicOwner: object.logicOwner,
              linkedComponent: object.linkedComponent
                ? {
                    id: object.linkedComponent.id,
                    name: object.linkedComponent.name,
                  }
                : null,
            },
          };
        }
      case "get_component":
        return {
          ok: true,
          component: buildAssistantModelComponent(
            getComponentSummary(execution.stagedState, String(args.componentId ?? "")),
          ),
        };
      case "search_entities":
        return {
          ok: true,
          results: searchEntities(execution.stagedState, String(args.query ?? "")),
        };
      case "list_references":
        return {
          ok: true,
          references: listAssistantEntityReferences(
            execution.stagedState,
            String(args.entityType ?? "") as AssistantReferenceEntityType,
            String(args.id ?? ""),
            typeof args.sceneId === "string" ? args.sceneId : undefined,
          ),
        };
      case "inspect_validation_issues":
        return {
          ok: true,
          issues: summarizeValidationIssues(validateAssistantProjectState(execution.stagedState)),
        };
      case "update_project_settings":
        return stageOperation(execution, {
          kind: "update_project_settings",
          settings: (args.settings ?? {}) as any,
        });
      case "create_scene":
        return stageOperation(execution, {
          kind: "create_scene",
          name: String(args.name ?? "Scene"),
          sceneId: typeof args.sceneId === "string" ? args.sceneId : undefined,
          insertIndex: typeof args.insertIndex === "number" ? args.insertIndex : undefined,
        });
      case "delete_scene":
        return stageOperation(execution, {
          kind: "delete_scene",
          sceneId: String(args.sceneId ?? ""),
        });
      case "rename_scene":
        return stageOperation(execution, {
          kind: "rename_scene",
          sceneId: String(args.sceneId ?? ""),
          name: String(args.name ?? ""),
        });
      case "reorder_scenes":
        return stageOperation(execution, {
          kind: "reorder_scenes",
          sceneIds: Array.isArray(args.sceneIds) ? args.sceneIds.map(String) : [],
        });
      case "update_scene_properties":
        return stageOperation(execution, {
          kind: "update_scene_properties",
          sceneId: String(args.sceneId ?? ""),
          properties: (args.properties ?? {}) as any,
        });
      case "create_folder":
        return stageOperation(execution, {
          kind: "create_folder",
          sceneId: String(args.sceneId ?? ""),
          name: String(args.name ?? ""),
          folderId: typeof args.folderId === "string" ? args.folderId : undefined,
          parentId: args.parentId === null ? null : typeof args.parentId === "string" ? args.parentId : undefined,
          index: typeof args.index === "number" ? args.index : undefined,
        });
      case "delete_folder":
        return stageOperation(execution, {
          kind: "delete_folder",
          sceneId: String(args.sceneId ?? ""),
          folderId: String(args.folderId ?? ""),
        });
      case "rename_folder":
        return stageOperation(execution, {
          kind: "rename_folder",
          sceneId: String(args.sceneId ?? ""),
          folderId: String(args.folderId ?? ""),
          name: String(args.name ?? ""),
        });
      case "move_folder":
        return stageOperation(execution, {
          kind: "move_folder",
          sceneId: String(args.sceneId ?? ""),
          folderId: String(args.folderId ?? ""),
          parentId: args.parentId === null ? null : typeof args.parentId === "string" ? args.parentId : undefined,
          index: typeof args.index === "number" ? args.index : undefined,
        });
      case "create_object":
        return stageOperation(execution, {
          kind: "create_object",
          sceneId: String(args.sceneId ?? ""),
          name: String(args.name ?? ""),
          objectId: typeof args.objectId === "string" ? args.objectId : undefined,
          parentId: args.parentId === null ? null : typeof args.parentId === "string" ? args.parentId : undefined,
          index: typeof args.index === "number" ? args.index : undefined,
          properties: (args.properties ?? {}) as any,
        });
      case "delete_object":
        return stageOperation(execution, {
          kind: "delete_object",
          sceneId: String(args.sceneId ?? ""),
          objectId: String(args.objectId ?? ""),
        });
      case "rename_object":
        return stageOperation(execution, {
          kind: "rename_object",
          sceneId: String(args.sceneId ?? ""),
          objectId: String(args.objectId ?? ""),
          name: String(args.name ?? ""),
        });
      case "move_object":
        return stageOperation(execution, {
          kind: "move_object",
          sceneId: String(args.sceneId ?? ""),
          objectId: String(args.objectId ?? ""),
          parentId: args.parentId === null ? null : typeof args.parentId === "string" ? args.parentId : undefined,
          index: typeof args.index === "number" ? args.index : undefined,
        });
      case "duplicate_object":
        return stageOperation(execution, {
          kind: "duplicate_object",
          sceneId: String(args.sceneId ?? ""),
          objectId: String(args.objectId ?? ""),
          duplicateObjectId: typeof args.duplicateObjectId === "string" ? args.duplicateObjectId : undefined,
        });
      case "update_object_properties": {
        const sceneId = String(args.sceneId ?? "");
        const objectId = String(args.objectId ?? "");
        const objectSummary = getObjectSummary(execution.stagedState, sceneId, objectId);
        if (objectSummary.linkedComponent) {
          const requestedProperties = args.properties as Record<string, unknown> | undefined;
          const sharedKeys = ["physics", "collider", "currentCostumeIndex"];
          const requestedSharedKeys = sharedKeys.filter((key) => requestedProperties && key in requestedProperties);
          if (requestedSharedKeys.length > 0) {
            return buildToolError(
              `Object "${objectId}" is component-backed. Update the component "${objectSummary.linkedComponent.id}" for shared fields: ${requestedSharedKeys.join(", ")}.`,
              "component_backed_object",
              { componentId: objectSummary.linkedComponent.id },
            );
          }
        }
        return stageOperation(execution, {
          kind: "update_object_properties",
          sceneId,
          objectId,
          properties: (args.properties ?? {}) as any,
        });
      }
      case "set_object_blockly_xml": {
        const sceneId = String(args.sceneId ?? "");
        const objectId = String(args.objectId ?? "");
        const objectSummary = getObjectSummary(execution.stagedState, sceneId, objectId);
        if (objectSummary.linkedComponent) {
          return buildToolError(
            `Object "${objectId}" is component-backed. Edit component "${objectSummary.linkedComponent.id}" instead.`,
            "component_backed_object",
            { componentId: objectSummary.linkedComponent.id },
          );
        }
        return stageOperation(execution, {
          kind: "set_object_blockly_xml",
          sceneId,
          objectId,
          blocklyXml: String(args.blocklyXml ?? ""),
        });
      }
      case "set_object_logic": {
        const sceneId = String(args.sceneId ?? "");
        const objectId = String(args.objectId ?? "");
        const objectSummary = getObjectSummary(execution.stagedState, sceneId, objectId);
        if (objectSummary.linkedComponent) {
          return buildToolError(
            `Object "${objectId}" is component-backed. Edit component "${objectSummary.linkedComponent.id}" instead.`,
            "component_backed_object",
            { componentId: objectSummary.linkedComponent.id },
          );
        }
        return stageOperation(execution, {
          kind: "set_object_logic",
          sceneId,
          objectId,
          logic: (args.logic ?? {}) as any,
        });
      }
      case "make_component":
        return stageOperation(execution, {
          kind: "make_component",
          sceneId: String(args.sceneId ?? ""),
          objectId: String(args.objectId ?? ""),
          componentId: typeof args.componentId === "string" ? args.componentId : undefined,
          name: typeof args.name === "string" ? args.name : undefined,
        });
      case "delete_component":
        return stageOperation(execution, {
          kind: "delete_component",
          componentId: String(args.componentId ?? ""),
        });
      case "add_component_instance":
        return stageOperation(execution, {
          kind: "add_component_instance",
          sceneId: String(args.sceneId ?? ""),
          componentId: String(args.componentId ?? ""),
          objectId: typeof args.objectId === "string" ? args.objectId : undefined,
          parentId: args.parentId === null ? null : typeof args.parentId === "string" ? args.parentId : undefined,
          index: typeof args.index === "number" ? args.index : undefined,
          properties: (args.properties ?? {}) as any,
        });
      case "detach_from_component":
        return stageOperation(execution, {
          kind: "detach_from_component",
          sceneId: String(args.sceneId ?? ""),
          objectId: String(args.objectId ?? ""),
        });
      case "rename_component":
        return stageOperation(execution, {
          kind: "rename_component",
          componentId: String(args.componentId ?? ""),
          name: String(args.name ?? ""),
        });
      case "update_component_properties":
        return stageOperation(execution, {
          kind: "update_component_properties",
          componentId: String(args.componentId ?? ""),
          properties: (args.properties ?? {}) as any,
        });
      case "set_component_blockly_xml":
        return stageOperation(execution, {
          kind: "set_component_blockly_xml",
          componentId: String(args.componentId ?? ""),
          blocklyXml: String(args.blocklyXml ?? ""),
        });
      case "set_component_logic":
        return stageOperation(execution, {
          kind: "set_component_logic",
          componentId: String(args.componentId ?? ""),
          logic: (args.logic ?? {}) as any,
        });
      default:
        return buildToolError(`Unknown tool "${toolName}".`, "unknown_tool");
    }
  } catch (error) {
    return buildToolError(
      error instanceof Error ? error.message : "Tool execution failed.",
      "tool_execution_failed",
    );
  }
}

function stageOperation(
  execution: ToolExecutionContext,
  operation: AssistantProjectOperation,
) {
  const stabilizedOperation = materializeAssistantOperationIds(operation);
  const nextOperations = [...execution.stagedOperations, stabilizedOperation];
  const result = applyAssistantProjectOperations(execution.stagedState, [stabilizedOperation]);
  if (result.issues.length > 0) {
    return buildToolError(
      "The proposed operation produced an invalid staged state.",
      "validation_failed",
      {
        operation: stabilizedOperation,
        issues: summarizeValidationIssues(result.issues),
      },
    );
  }

  execution.stagedState = result.state;
  execution.stagedOperations = nextOperations;
  return buildMutationResult(stabilizedOperation, result);
}

export const executeRunInternal = internalAction({
  args: {
    runId: v.id("assistantRuns"),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const runContext = await ctx.runQuery(internalAssistant.getRunContextInternal, {
      runId: args.runId,
    });
    if (!runContext || runContext.run.status !== "queued") {
      return null;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      await ctx.runMutation(internalAssistant.setRunStatusInternal, {
        runId: args.runId,
        status: "failed",
        failedAt: Date.now(),
        errorCode: "missing_openai_api_key",
        errorMessage: "OPENAI_API_KEY is not configured in Convex.",
      });
      await appendRunEvent(ctx, args.runId, "run_failed", {
        runId: args.runId,
        errorCode: "missing_openai_api_key",
        errorMessage: "OPENAI_API_KEY is not configured in Convex.",
      });
      await appendRunEvent(ctx, args.runId, "editor_unlocked", {
        runId: args.runId,
      });
      return null;
    }

    const openai = new OpenAI({ apiKey });
    const model = process.env.OPENAI_ASSISTANT_MODEL ?? "gpt-4.1-mini";
    const snapshot = parseSnapshot(runContext.snapshot.snapshotJson);
    const initialIssues = validateAssistantProjectState(snapshot.state);
    if (initialIssues.length > 0) {
      await ctx.runMutation(internalAssistant.setRunStatusInternal, {
        runId: args.runId,
        status: "failed",
        failedAt: Date.now(),
        errorCode: "invalid_snapshot",
        errorMessage: safeStringify(summarizeValidationIssues(initialIssues)),
      });
      await appendRunEvent(ctx, args.runId, "validation_failed", {
        runId: args.runId,
        issues: summarizeValidationIssues(initialIssues),
      });
      await appendRunEvent(ctx, args.runId, "run_failed", {
        runId: args.runId,
        errorCode: "invalid_snapshot",
      });
      await appendRunEvent(ctx, args.runId, "editor_unlocked", {
        runId: args.runId,
      });
      return null;
    }

    await ctx.runMutation(internalAssistant.setRunStatusInternal, {
      runId: args.runId,
      status: "running",
      startedAt: Date.now(),
      model,
    });

    await appendRunEvent(ctx, args.runId, "context_prepared", {
      runId: args.runId,
      snapshotId: snapshot.snapshotId,
      summary: summarizeState(snapshot.state),
    });

    const execution: ToolExecutionContext = {
      runId: args.runId,
      mode: runContext.run.mode,
      stagedState: snapshot.state,
      stagedOperations: [],
    };
    const conversationHistory = parseConversationHistory(runContext.run.conversationHistoryJson);

    const maxSteps = 30;
    let previousResponseId: string | null = null;
    let nextInput: OpenAI.Responses.ResponseInput = buildInitialInput(
      runContext.run.requestText,
      snapshot,
      runContext.run.mode,
      conversationHistory,
    );
    let finalSummary = "";
    let totalUsage = {
      input_tokens: 0,
      output_tokens: 0,
      total_tokens: 0,
    };

    try {
      for (let step = 1; step <= maxSteps; step += 1) {
        const response: OpenAI.Responses.Response = await openai.responses.create({
          model,
          instructions: previousResponseId ? undefined : buildSystemInstructions(runContext.run.mode),
          input: nextInput,
          previous_response_id: previousResponseId ?? undefined,
          tools: toolDefinitions,
          tool_choice: "auto",
          truncation: "auto",
        });

        previousResponseId = response.id;
        totalUsage = {
          input_tokens: totalUsage.input_tokens + (response.usage?.input_tokens ?? 0),
          output_tokens: totalUsage.output_tokens + (response.usage?.output_tokens ?? 0),
          total_tokens: totalUsage.total_tokens + (response.usage?.total_tokens ?? 0),
        };

        const functionCalls = response.output.filter(
          (item: OpenAI.Responses.ResponseOutputItem): item is OpenAI.Responses.ResponseFunctionToolCall =>
            item.type === "function_call",
        );

        if (functionCalls.length === 0) {
          finalSummary = response.output_text.trim();
          if (!finalSummary) {
            finalSummary =
              runContext.run.mode === "mutate"
                ? "Completed the requested project changes."
                : "Completed the requested project analysis.";
          }
          const finalIssues = validateAssistantProjectState(execution.stagedState);
          if (finalIssues.length > 0) {
            throw new Error(`Final validation failed: ${safeStringify(summarizeValidationIssues(finalIssues))}`);
          }

          const changeSetJson =
            runContext.run.mode === "mutate" && execution.stagedOperations.length > 0
              ? safeStringify(
                  createChangeSet(
                    execution.stagedState,
                    runContext.run.projectVersion,
                    execution.stagedOperations,
                    finalSummary,
                  ),
                )
              : undefined;

          await ctx.runMutation(internalAssistant.setRunStatusInternal, {
            runId: args.runId,
            status: "completed",
            completedAt: Date.now(),
            finalSummary,
            changeSetJson,
            tokenUsageJson: safeStringify(totalUsage),
            stepCount: step,
            model,
          });
          await appendRunEvent(ctx, args.runId, "run_completed", {
            runId: args.runId,
            summary: finalSummary,
            stateSummary: summarizeState(execution.stagedState),
          });
          await appendRunEvent(ctx, args.runId, "editor_unlocked", {
            runId: args.runId,
          });
          return null;
        }

        const toolOutputs: OpenAI.Responses.ResponseInput = [];
        for (const toolCall of functionCalls) {
          const toolResult = await executeToolCall(ctx, toolCall, execution);
          toolOutputs.push({
            type: "function_call_output",
            call_id: toolCall.call_id,
            output: safeStringify(toolResult),
          });
        }
        nextInput = toolOutputs;
      }

      throw new Error(`Assistant exceeded the max step limit of ${maxSteps}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Assistant run failed.";
      await ctx.runMutation(internalAssistant.setRunStatusInternal, {
        runId: args.runId,
        status: "failed",
        failedAt: Date.now(),
        errorCode: "run_failed",
        errorMessage: message,
        tokenUsageJson: safeStringify(totalUsage),
        model,
      });
      await appendRunEvent(ctx, args.runId, "run_failed", {
        runId: args.runId,
        errorCode: "run_failed",
        errorMessage: message,
      });
      await appendRunEvent(ctx, args.runId, "editor_unlocked", {
        runId: args.runId,
      });
      return null;
    }
  },
});
