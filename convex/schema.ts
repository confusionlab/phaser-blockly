import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  library: defineTable({
    name: v.string(),
    type: v.union(v.literal("image"), v.literal("sound")),
    storageId: v.id("_storage"),
    thumbnail: v.optional(v.string()),
    mimeType: v.string(),
    size: v.number(),
  }).index("by_type", ["type"]),
});
