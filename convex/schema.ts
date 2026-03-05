import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Project data schema version. Keep aligned with src/db/database.ts.
export const SCHEMA_VERSION = 6;

// Shared bounds validator
const boundsValidator = v.object({
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
});

const editorModeValidator = v.union(v.literal("bitmap"), v.literal("vector"));

const vectorDocumentValidator = v.object({
  version: v.literal(1),
  fabricJson: v.string(),
});

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
  // Costume library - images for sprites
  costumeLibrary: defineTable({
    ownerUserId: v.optional(v.string()),
    name: v.string(),
    storageId: v.id("_storage"),
    thumbnail: v.string(), // Base64 small preview
    bounds: v.optional(boundsValidator),
    editorMode: v.optional(editorModeValidator),
    vectorDocument: v.optional(vectorDocumentValidator),
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
        editorMode: v.optional(editorModeValidator),
        vectorDocument: v.optional(vectorDocumentValidator),
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
  })
    .index("by_localId", ["localId"])
    .index("by_ownerUserId_and_localId", ["ownerUserId", "localId"])
    .index("by_ownerUserId_and_updatedAt", ["ownerUserId", "updatedAt"]),

  wallets: defineTable({
    userId: v.string(),
    planSlug: v.string(),
    subscriptionStatus: v.string(),
    balanceCredits: v.number(),
    activePeriodKey: v.optional(v.string()),
    periodEndsAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_userId", ["userId"]),

  creditLedger: defineTable({
    userId: v.string(),
    delta: v.number(),
    reason: v.string(),
    referenceId: v.string(),
    balanceAfter: v.number(),
    metadataJson: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_userId_and_createdAt", ["userId", "createdAt"])
    .index("by_userId_and_referenceId", ["userId", "referenceId"]),

  billingEvents: defineTable({
    eventId: v.string(),
    eventType: v.string(),
    payloadHash: v.string(),
    processedAt: v.number(),
  }).index("by_eventId", ["eventId"]),
});
