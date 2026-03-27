import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { boundsValidator, costumeDocumentValidator } from "./costumeValidators";

// Project data schema version. Keep aligned with src/db/database.ts.
export const SCHEMA_VERSION = 9;

// Physics config validator
const physicsValidator = v.object({
  enabled: v.boolean(),
  bodyType: v.union(v.literal("dynamic"), v.literal("static")),
  gravityY: v.number(),
  velocityX: v.number(),
  velocityY: v.number(),
  bounce: v.number(),
  friction: v.number(),
  allowRotation: v.boolean(),
});

// Collider config validator
const colliderValidator = v.object({
  type: v.union(
    v.literal("none"),
    v.literal("box"),
    v.literal("circle"),
    v.literal("capsule"),
  ),
  offsetX: v.number(),
  offsetY: v.number(),
  width: v.number(),
  height: v.number(),
  radius: v.number(),
});

const variableValidator = v.object({
  id: v.string(),
  name: v.string(),
  type: v.union(
    v.literal("string"),
    v.literal("integer"),
    v.literal("float"),
    v.literal("boolean"),
  ),
  defaultValue: v.union(v.number(), v.string(), v.boolean()),
  scope: v.union(v.literal("global"), v.literal("local")),
  objectId: v.optional(v.string()),
});

export default defineSchema({
  projectAssets: defineTable({
    ownerUserId: v.optional(v.string()),
    assetId: v.string(),
    kind: v.union(v.literal("image"), v.literal("audio"), v.literal("background")),
    mimeType: v.string(),
    size: v.number(),
    storageId: v.id("_storage"),
    createdAt: v.number(),
    orphanedAt: v.optional(v.number()),
  })
    .index("by_ownerUserId_and_assetId", ["ownerUserId", "assetId"])
    .index("by_ownerUserId_and_createdAt", ["ownerUserId", "createdAt"]),

  // Costume library - images for sprites
  costumeLibrary: defineTable({
    ownerUserId: v.optional(v.string()),
    name: v.string(),
    storageId: v.id("_storage"),
    thumbnail: v.string(), // Base64 small preview
    bounds: v.optional(boundsValidator),
    document: costumeDocumentValidator,
    mimeType: v.string(),
    size: v.number(),
    createdAt: v.number(),
  }).index("by_ownerUserId_and_createdAt", ["ownerUserId", "createdAt"]),

  // Sound library - audio files
  soundLibrary: defineTable({
    ownerUserId: v.optional(v.string()),
    name: v.string(),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    size: v.number(),
    duration: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_ownerUserId_and_createdAt", ["ownerUserId", "createdAt"]),

  // Object library - complete game objects with costumes, sounds, and code
  objectLibrary: defineTable({
    ownerUserId: v.optional(v.string()),
    name: v.string(),
    thumbnail: v.string(), // Base64 preview
    costumes: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        storageId: v.id("_storage"),
        bounds: v.optional(boundsValidator),
        document: costumeDocumentValidator,
      }),
    ),
    sounds: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        storageId: v.id("_storage"),
        duration: v.optional(v.number()),
        trimStart: v.optional(v.number()),
        trimEnd: v.optional(v.number()),
      }),
    ),
    blocklyXml: v.string(),
    currentCostumeIndex: v.optional(v.number()),
    physics: v.optional(physicsValidator),
    collider: v.optional(colliderValidator),
    localVariables: v.optional(v.array(variableValidator)),
    createdAt: v.number(),
  }).index("by_ownerUserId_and_createdAt", ["ownerUserId", "createdAt"]),

  // Projects - cloud-synced project storage
  projects: defineTable({
    ownerUserId: v.optional(v.string()),
    localId: v.string(),
    name: v.string(),
    storageId: v.optional(v.id("_storage")),
    // Kept optional for backwards compatibility with legacy inline records.
    data: v.optional(v.string()),
    dataSizeBytes: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Union preserves backwards compatibility with previously written string values.
    schemaVersion: v.union(v.number(), v.string()),
    appVersion: v.optional(v.string()),
    contentHash: v.optional(v.string()),
    assetIds: v.optional(v.array(v.string())),
    revisionCount: v.optional(v.number()),
    latestRevisionId: v.optional(v.string()),
    latestRevisionCreatedAt: v.optional(v.number()),
    latestRevisionContentHash: v.optional(v.string()),
    revisionsUpdatedAt: v.optional(v.number()),
  })
    .index("by_localId", ["localId"])
    .index("by_ownerUserId_and_localId", ["ownerUserId", "localId"])
    .index("by_ownerUserId_and_updatedAt", ["ownerUserId", "updatedAt"]),

  // Project revision history - cloud-synced checkpoint/revision storage
  projectRevisions: defineTable({
    ownerUserId: v.optional(v.string()),
    projectLocalId: v.string(),
    revisionId: v.string(),
    parentRevisionId: v.optional(v.string()),
    kind: v.union(v.literal("snapshot"), v.literal("delta")),
    baseRevisionId: v.string(),
    storageId: v.optional(v.id("_storage")),
    data: v.optional(v.string()),
    dataSizeBytes: v.optional(v.number()),
    contentHash: v.string(),
    createdAt: v.number(),
    updatedAt: v.optional(v.number()),
    schemaVersion: v.union(v.number(), v.string()),
    appVersion: v.optional(v.string()),
    reason: v.union(
      v.literal("manual_checkpoint"),
      v.literal("auto_checkpoint"),
      v.literal("import"),
      v.literal("restore"),
      v.literal("edit_revision"),
    ),
    checkpointName: v.optional(v.string()),
    isCheckpoint: v.boolean(),
    restoredFromRevisionId: v.optional(v.string()),
    assetIds: v.optional(v.array(v.string())),
  })
    .index("by_projectLocalId_and_createdAt", ["projectLocalId", "createdAt"])
    .index("by_projectLocalId_and_isCheckpoint_and_createdAt", ["projectLocalId", "isCheckpoint", "createdAt"])
    .index("by_projectLocalId_and_revisionId", ["projectLocalId", "revisionId"])
    .index("by_projectLocalId_and_contentHash", ["projectLocalId", "contentHash"])
    .index("by_ownerUserId_and_createdAt", ["ownerUserId", "createdAt"])
    .index("by_ownerUserId_and_projectLocalId_and_createdAt", ["ownerUserId", "projectLocalId", "createdAt"])
    .index("by_ownerUserId_and_projectLocalId_and_isCheckpoint_and_createdAt", ["ownerUserId", "projectLocalId", "isCheckpoint", "createdAt"])
    .index("by_ownerUserId_and_projectLocalId_and_revisionId", ["ownerUserId", "projectLocalId", "revisionId"])
    .index("by_ownerUserId_and_projectLocalId_and_contentHash", ["ownerUserId", "projectLocalId", "contentHash"]),

  projectEditorLeases: defineTable({
    ownerUserId: v.string(),
    projectLocalId: v.string(),
    editorSessionId: v.string(),
    acquiredAt: v.number(),
    heartbeatAt: v.number(),
  })
    .index("by_ownerUserId_and_projectLocalId", ["ownerUserId", "projectLocalId"])
    .index("by_ownerUserId_and_editorSessionId", ["ownerUserId", "editorSessionId"]),

  userSettings: defineTable({
    userId: v.string(),
    isDarkMode: v.optional(v.boolean()),
    assistantModelMode: v.optional(v.union(v.literal("fast"), v.literal("smart"))),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  assistantSnapshots: defineTable({
    ownerUserId: v.optional(v.string()),
    projectId: v.string(),
    projectVersion: v.string(),
    snapshotJson: v.string(),
    source: v.union(v.literal("full"), v.literal("patch")),
    baseSnapshotId: v.optional(v.id("assistantSnapshots")),
    createdAt: v.number(),
  })
    .index("by_ownerUserId_and_projectId_and_createdAt", ["ownerUserId", "projectId", "createdAt"])
    .index("by_ownerUserId_and_projectId_and_projectVersion_and_createdAt", [
      "ownerUserId",
      "projectId",
      "projectVersion",
      "createdAt",
    ]),

  assistantRuns: defineTable({
    ownerUserId: v.optional(v.string()),
    projectId: v.string(),
    mode: v.union(v.literal("mutate"), v.literal("analyze")),
    modelMode: v.optional(v.union(v.literal("fast"), v.literal("smart"))),
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
  })
    .index("by_ownerUserId_and_projectId_and_createdAt", ["ownerUserId", "projectId", "createdAt"])
    .index("by_ownerUserId_and_projectId_and_status", ["ownerUserId", "projectId", "status"]),

  assistantRunEvents: defineTable({
    runId: v.id("assistantRuns"),
    sequence: v.number(),
    type: v.string(),
    payloadJson: v.string(),
    createdAt: v.number(),
  }).index("by_runId_and_sequence", ["runId", "sequence"]),
});
