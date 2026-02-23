import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

// Project data schema version. Keep aligned with src/db/database.ts.
export const SCHEMA_VERSION = 1;

// Shared bounds validator
const boundsValidator = v.object({
  x: v.number(),
  y: v.number(),
  width: v.number(),
  height: v.number(),
});

// Physics config validator
const physicsValidator = v.object({
  enabled: v.boolean(),
  bodyType: v.union(v.literal("dynamic"), v.literal("static")),
  gravityY: v.number(),
  velocityX: v.number(),
  velocityY: v.number(),
  bounce: v.number(),
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

export default defineSchema({
  // Legacy library table (kept for backwards compatibility)
  library: defineTable({
    name: v.string(),
    type: v.union(v.literal("image"), v.literal("sound")),
    storageId: v.id("_storage"),
    thumbnail: v.optional(v.string()),
    mimeType: v.string(),
    size: v.number(),
  }).index("by_type", ["type"]),

  // Costume library - images for sprites
  costumeLibrary: defineTable({
    name: v.string(),
    storageId: v.id("_storage"),
    thumbnail: v.string(), // Base64 small preview
    bounds: v.optional(boundsValidator),
    mimeType: v.string(),
    size: v.number(),
    createdAt: v.number(),
  }),

  // Sound library - audio files
  soundLibrary: defineTable({
    name: v.string(),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    size: v.number(),
    duration: v.optional(v.number()),
    createdAt: v.number(),
  }),

  // Object library - complete game objects with costumes, sounds, and code
  objectLibrary: defineTable({
    name: v.string(),
    thumbnail: v.string(), // Base64 preview
    costumes: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        storageId: v.id("_storage"),
        bounds: v.optional(boundsValidator),
      }),
    ),
    sounds: v.array(
      v.object({
        id: v.string(),
        name: v.string(),
        storageId: v.id("_storage"),
      }),
    ),
    blocklyXml: v.string(),
    physics: v.optional(physicsValidator),
    collider: v.optional(colliderValidator),
    createdAt: v.number(),
  }),

  // Projects - cloud-synced project storage
  projects: defineTable({
    localId: v.string(),
    name: v.string(),
    data: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    // Union preserves backwards compatibility with previously written string values.
    schemaVersion: v.union(v.number(), v.string()),
    appVersion: v.optional(v.string()),
  }).index("by_localId", ["localId"]),
});
