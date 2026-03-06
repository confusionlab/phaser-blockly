"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { runUnifiedAssistantTurn } from "../packages/assistant-core/src";

const proposedEditsValidator = v.object({
  intentSummary: v.string(),
  assumptions: v.array(v.string()),
  semanticOps: v.array(v.any()),
  projectOps: v.array(v.any()),
});

const assistantTurnReturnValidator = v.object({
  provider: v.string(),
  model: v.string(),
  mode: v.union(v.literal("chat"), v.literal("edit")),
  answer: v.optional(v.string()),
  errorCode: v.optional(v.string()),
  proposedEdits: v.optional(proposedEditsValidator),
  debugTrace: v.optional(v.any()),
});

export const assistantTurn = action({
  args: {
    userIntent: v.string(),
    chatHistory: v.array(v.object({
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
    })),
    threadContext: v.optional(v.object({
      threadId: v.optional(v.string()),
      scopeKey: v.optional(v.string()),
    })),
    capabilities: v.any(),
    context: v.any(),
    programRead: v.any(),
    projectSnapshot: v.any(),
  },
  returns: assistantTurnReturnValidator,
  handler: async (_ctx, args) => {
    return runUnifiedAssistantTurn({
      userIntent: args.userIntent,
      chatHistory: args.chatHistory,
      threadContext: args.threadContext,
      capabilities: args.capabilities,
      context: args.context,
      programRead: args.programRead,
      projectSnapshot: args.projectSnapshot,
    });
  },
});
