# AI Coding Assistant Spec

## Status

- Draft 1
- Date: 2026-03-06
- Scope: shared AI assistant for web and Electron PochaCoding clients backed by Convex and OpenAI Responses API

## Summary

PochaCoding will implement a project-editing AI assistant that runs entirely through the shared Convex backend. Web and Electron clients will use the same backend run loop, the same normalized project context format, the same domain tool set, and the same streamed event contract.

The assistant has full authority to modify the project, including destructive operations such as deleting blocks, objects, scenes, and folders. The user does not manually approve changes before they apply. Instead, the editor is locked during an agent run, the assistant builds a staged mutation plan through validated domain tools, and the final result is applied atomically as a single undoable edit when the run succeeds.

The assistant will use the OpenAI Responses API with a direct OpenAI API key. The following are explicitly out of scope:

- OpenRouter
- `codex-app-server`
- OpenAI Agents SDK

## Product Decisions

### Required behavior

- A user request starts an AI run for a single project.
- The editor locks for the duration of the run.
- The client sends a normalized project snapshot to Convex.
- Convex runs the agent loop against OpenAI Responses API.
- The model can use validated domain tools only.
- The model cannot directly rewrite the full raw project JSON.
- Convex validates tool inputs, intermediate staged state, and final state.
- If the run succeeds, the client applies one atomic change-set.
- The client records one undo checkpoint for the entire run.
- If the run fails, times out, or cannot validate, nothing is applied.
- The frontend streams reasoning and tool progress to the user.
- Analysis-only requests are supported through the same system with no mutation commit.

### Authority scope

The assistant is allowed to:

- create, delete, move, and edit Blockly blocks
- create, delete, move, and rename scenes
- create, delete, move, and rename folders
- create, delete, move, and rename objects
- edit object, scene, and project properties
- reorder objects and layers
- trigger code generation or preview refresh when needed

## Goals

- Use one assistant architecture across web and Electron.
- Keep all tool execution, validation, and guardrails in Convex.
- Prevent mid-run user edits from conflicting with AI edits.
- Make agent runs undoable in one step.
- Provide enough run logs to debug failures and model mistakes.
- Reduce token usage by sending a normalized project snapshot, not raw editor exports.
- Support follow-up runs via project patches instead of full snapshot retransmission when possible.

## Non-Goals

- No manual per-change approval UI in v1.
- No direct model writes from the client.
- No arbitrary model-authored JSON patches against the raw project shape.
- No client-specific assistant logic that changes behavior between Electron and web.
- No partial application of failed runs.

## Architecture

### High-level flow

1. User submits a request from web or Electron.
2. Client locks the editor for that project and captures the current project version.
3. Client normalizes the project into an AI-facing snapshot and sends it to Convex.
4. Convex creates an `agentRun` record and begins streaming run events.
5. Convex calls the OpenAI Responses API with:
   - the user request
   - system instructions for PochaCoding editing behavior
   - the normalized project snapshot
   - the current staged project summary
   - the domain tool definitions
6. The model reasons and issues tool calls.
7. Convex validates tool arguments, executes the tool against staged state, validates the result, records logs, and continues the loop.
8. When the model indicates completion, Convex runs final validation.
9. If the run is valid:
   - Convex stores the final change-set and summary.
   - the client receives completion
   - the client applies the change-set atomically
   - the client creates one undo checkpoint
10. The editor unlocks.
11. If the run fails, the editor unlocks and the project remains unchanged.

### Trust boundaries

- Clients are responsible for local editor lock state, local snapshot capture, event rendering, and final application of a validated change-set.
- Convex is responsible for orchestration, tool execution, validation, step limits, run logs, and guarding project version consistency.
- OpenAI is responsible only for reasoning and tool selection. It is not trusted to mutate project state directly.

## Agent Run Model

### Execution mode

Each user request creates a single run with one of two modes:

- `mutate`: the model may use read and write tools and may produce a final staged change-set
- `analyze`: the model may use read tools only and returns explanation/diagnosis with no project mutation

### Atomicity

- All write tools operate against staged state inside the run, not the live client state.
- The live project is unchanged until the run completes successfully.
- The final application is atomic from the user’s perspective.
- One run maps to one undo entry.

### Locking

- The editor must enter a locked state as soon as a run starts.
- While locked, the user cannot change the project.
- The lock is released only when the run reaches `completed`, `failed`, or `cancelled`.
- Final apply must verify that the client is still on the same locked project version captured at run start.

### Failure policy

- If any tool call is invalid, Convex returns a structured tool error to the model for recovery.
- If the staged state violates project invariants and cannot be repaired within limits, the run fails.
- If the run exceeds time, token, or step limits, it fails.
- Failed runs do not apply changes.
- Tool-level retries are allowed within run limits.

## AI-Facing Project Snapshot

### Purpose

The raw editor project state is too large and too noisy to send directly. The client must produce a normalized AI-facing snapshot that preserves editing semantics while removing irrelevant metadata and large assets.

### Snapshot requirements

The normalized snapshot must include:

- project identity and version
- scene tree and order
- folder tree and order
- object tree, order, and parentage
- relevant object properties
- relevant scene properties
- Blockly logic in a compact semantic representation
- references between scenes, objects, folders, assets, and logic
- available assets as lightweight descriptors
- names, IDs, and type information needed for unambiguous tool targets

The normalized snapshot must exclude:

- large binary data
- raster/vector payloads that are not required for reasoning
- thumbnail blobs
- rendering cache data
- editor-only layout metadata unless it affects semantics
- analytics/debug metadata unrelated to project behavior
- repeated default values that can be reconstructed

### Snapshot shape

The exact schema can evolve, but v1 should roughly contain:

```ts
type AiProjectSnapshot = {
  project: {
    id: string;
    version: number;
    name: string;
    settings: Record<string, unknown>;
  };
  scenes: SceneSummary[];
  folders: FolderSummary[];
  objects: ObjectSummary[];
  blockPrograms: BlockProgramSummary[];
  assets: AssetSummary[];
  indexes: {
    objectIdsByScene: Record<string, string[]>;
    childObjectIdsByParent: Record<string, string[]>;
    folderChildren: Record<string, string[]>;
  };
};
```

Each summary type should be intentionally compact and should contain only fields the agent can reason about or edit through tools.

### Follow-up optimization

For later requests in the same editing session:

- Convex may keep the prior normalized snapshot or staged summary.
- The client may send a patch from `baseSnapshotId` instead of a full snapshot.
- Patch application is valid only if the base snapshot ID and project version match.
- If not, the client must resend a fresh full normalized snapshot.

## Tool Model

### Tool philosophy

Tools must be domain-specific. They should describe user-meaningful operations and maintain invariants better than generic JSON patching.

The model must not emit arbitrary raw project patches.

### Tool categories

#### Read/query tools

- `get_project_summary`
- `get_scene`
- `get_object`
- `get_folder`
- `get_block_program`
- `search_entities`
- `list_references`
- `inspect_validation_issues`

#### Scene tools

- `create_scene`
- `delete_scene`
- `rename_scene`
- `move_scene`
- `reorder_scenes`
- `update_scene_properties`

#### Folder tools

- `create_folder`
- `delete_folder`
- `rename_folder`
- `move_folder`
- `reorder_folder_children`

#### Object tools

- `create_object`
- `delete_object`
- `duplicate_object`
- `rename_object`
- `move_object`
- `reparent_object`
- `reorder_object`
- `update_object_properties`

#### Blockly logic tools

- `create_block`
- `delete_block`
- `move_block`
- `connect_blocks`
- `disconnect_blocks`
- `replace_block`
- `update_block_fields`
- `update_block_inputs`
- `create_variable_or_list`
- `delete_variable_or_list`

#### Project-wide tools

- `update_project_settings`
- `organize_project_structure`
- `refresh_preview`
- `refresh_codegen`

### Tool execution contract

Each tool must define:

- strict JSON schema arguments
- required IDs and target scopes
- allowed side effects
- deterministic success payload
- deterministic error payload
- whether it mutates staged state

All mutation tools must return:

- a concise description of the staged change
- the affected entity IDs
- a staged state version increment
- any validation warnings

## Validation

### Validation layers

Convex validates at four layers:

1. request validation
2. tool argument validation
3. post-tool staged-state validation
4. final run validation

### Required invariants

The staged and final project state must satisfy these invariants:

- all IDs are unique within their entity domain
- all referenced scenes, folders, objects, variables, assets, and blocks exist
- parent-child links are valid and acyclic
- scene membership is valid for every object
- folder hierarchy is valid and acyclic
- object ordering is valid within its parent scope
- required properties exist for every entity type
- deleted entities leave no broken references
- Blockly graphs are structurally valid
- block connections reference valid compatible blocks
- variables/lists referenced by blocks exist
- project settings remain schema-valid
- final output still matches the locked project version started by the run

### Validation response to model

When a tool call produces an invalid staged state, Convex should return structured feedback to the model, including:

- validation code
- human-readable explanation
- affected entity IDs
- suggested recovery hints when available

This allows the model to repair instead of immediately failing.

## Streaming Contract

The frontend will use [`assistant-ui`](https://www.assistant-ui.com/) and must receive structured run events from Convex.

### Required events

- `editor_locked`
- `run_started`
- `context_prepared`
- `reasoning_delta`
- `tool_call_started`
- `tool_call_finished`
- `validation_started`
- `validation_failed`
- `retrying`
- `run_completed`
- `run_failed`
- `changes_applied`
- `editor_unlocked`

### Event payload requirements

Each event should include:

- `runId`
- `projectId`
- `timestamp`
- `sequence`
- `status`

Specific events should also include:

- reasoning text deltas for `reasoning_delta`
- tool name and args summary for `tool_call_started`
- tool result summary and affected entities for `tool_call_finished`
- validation codes/issues for validation events
- final natural-language summary and change summary for `run_completed`

### UX expectations

The frontend should show:

- concise reasoning updates
- current tool being executed
- scenes, objects, folders, or logic being changed
- final summary of what changed
- warnings if confidence is low or unresolved risks remain

## Convex Data Model

Convex should persist enough data to replay and debug runs.

### Suggested tables

#### `agentRuns`

- `projectId`
- `userId` when auth-scoped multi-user support exists
- `mode` (`mutate` or `analyze`)
- `status`
- `requestText`
- `projectVersion`
- `snapshotId`
- `startedAt`
- `completedAt`
- `failedAt`
- `errorCode`
- `errorMessage`
- `finalSummary`
- `finalChangeSetId`
- `tokenUsage`
- `stepCount`

#### `agentRunEvents`

- `runId`
- `sequence`
- `type`
- `payload`
- `createdAt`

#### `agentSnapshots`

- `projectId`
- `projectVersion`
- `normalizedSnapshot`
- `source` (`full` or `patch`)
- `baseSnapshotId`
- `createdAt`

#### `agentToolCalls`

- `runId`
- `step`
- `toolName`
- `arguments`
- `result`
- `success`
- `validationStatus`
- `createdAt`

#### `agentChangeSets`

- `runId`
- `projectId`
- `baseProjectVersion`
- `operations`
- `affectedEntities`
- `summary`
- `createdAt`

## OpenAI Integration

### API choice

The assistant will use the OpenAI Responses API directly via an OpenAI API key stored in Convex server configuration.

### Model responsibilities

The model is responsible for:

- interpreting the user’s request
- deciding whether more inspection is needed
- choosing domain tools
- iterating until the request is satisfied or blocked
- producing a concise user-facing summary

The model is not responsible for:

- mutating live project state directly
- bypassing tool validation
- inventing unsupported entity IDs
- deciding whether invalid state may be committed

### Conversation strategy

Each run should include:

- a stable system prompt for PochaCoding editing rules
- the latest user request
- the normalized snapshot or patch-derived staged summary
- tool results from the current run
- validation feedback when relevant

Follow-up requests should reuse prior run context only when it reduces cost without risking stale state.

## Limits and Guardrails

V1 should include strict execution limits:

- max run duration
- max step count
- max model/tool round trips
- max token budget per run
- max normalized snapshot size
- max reasoning text stored per event

Suggested starting defaults:

- run timeout: 60 seconds
- max steps: 30
- max tool calls: 30
- max snapshot payload: 500 KB before compression

These numbers should be tuned from production logs, but guardrails must exist from day one.

## Apply and Undo

### Apply contract

- Convex returns a validated change-set, not a rewritten full project blob.
- The client applies the change-set in one atomic local update.
- After apply succeeds, the client records one undo entry for the whole run.

### Undo contract

- Undo reverts the entire assistant run as one operation.
- The undo stack should identify the entry as an AI assistant change with the run summary when possible.
- Step-by-step undo inside a single AI run is out of scope for v1.

## Debugging and Observability

Good debugging is a hard requirement.

Each run must preserve:

- raw user request
- project version at run start
- normalized snapshot sent to the model
- OpenAI request/response IDs
- tool calls and results
- validation failures and repair attempts
- final change-set
- final summary
- timing metrics
- token usage

The system should make it easy to answer:

- what context was the model given
- why did it choose these tools
- which tool introduced a bad state
- why did validation fail
- what exactly was applied

## Security and Safety

- OpenAI API keys must remain server-side in Convex.
- Clients must never call OpenAI directly for project mutation runs.
- Tool execution must be schema-validated and authorization-checked.
- Client-provided snapshots must be treated as untrusted input and validated before use.
- Analysis-only mode must not accidentally surface mutation tools.

## Implementation Notes

### Shared client behavior

Web and Electron should share:

- snapshot normalization logic where possible
- the run event rendering model
- the final change-set apply path
- the editor lock semantics

### Preview/codegen behavior

`refresh_preview` and `refresh_codegen` may be exposed as explicit tools, but they should remain deterministic backend actions. If this creates unnecessary tool churn, they can become post-apply system actions later without changing the rest of the architecture.

## Initial Build Order

1. Define the normalized AI-facing snapshot schema.
2. Define the change-set schema and atomic apply path in the editor.
3. Implement Convex `agentRuns` storage and event streaming.
4. Implement read/query tools.
5. Implement a small validated write tool set for scenes, objects, and block edits.
6. Add staged-state validation.
7. Integrate OpenAI Responses API loop.
8. Add `assistant-ui` frontend rendering.
9. Add follow-up patch optimization.

## Open Questions

These do not block the first implementation draft, but will need decisions during build:

- exact normalized Blockly representation
- exact change-set operation format
- whether preview/codegen belongs inside the tool loop or after final apply
- whether large-project requests need snapshot summarization before model submission
- whether run cancellation should attempt graceful model shutdown or only mark the run cancelled locally
