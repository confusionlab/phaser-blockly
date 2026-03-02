# LLM Integration Spec (Blockly Coding Agent)

## Document Status
- Status: Draft v1
- Last Updated: 2026-03-03
- Scope: PochaCoding Blockly authoring assistant (read + write)

## 1. Goal
Enable a reliable coding agent that can read and edit Blockly programs using natural language while keeping Blockly as the source of truth.

The agent must:
- Explain existing block logic.
- Propose edits from user intent.
- Apply edits safely with deterministic validation and rollback.

## 2. Non-Goals
- Full arbitrary JavaScript-to-Blockly reverse compilation.
- Direct freeform XML generation by the model in production.
- Model-direct writes to project storage without validation.

## 3. Current System Alignment
This spec is designed to match current architecture:
- Blockly programs are stored as `blocklyXml` per object/component.
- XML is loaded/saved via Blockly workspace in editor flow.
- Runtime executes generated JavaScript from Blockly codegen.
- Pre-play validation already checks reference integrity.

Relevant implementation files:
- `/Users/kihaahn/code/0040-pochacoding/src/components/blockly/BlocklyEditor.tsx`
- `/Users/kihaahn/code/0040-pochacoding/src/components/blockly/toolbox.ts`
- `/Users/kihaahn/code/0040-pochacoding/src/phaser/CodeGenerator.ts`
- `/Users/kihaahn/code/0040-pochacoding/src/lib/playValidation.ts`
- `/Users/kihaahn/code/0040-pochacoding/src/store/projectStore.ts`
- `/Users/kihaahn/code/0040-pochacoding/src/components/stage/PhaserCanvas.tsx`

## 4. Source of Truth and Safety Model
- Source of truth: Blockly program (`blocklyXml`), not model output.
- Model role: planner that proposes semantic edits.
- System role: deterministic executor of edits in sandbox workspace.
- Apply path: preview -> validate -> explicit user confirm -> commit.

Hard constraints:
- No direct model write to DB/store.
- No direct model execution of code.
- Every candidate change must pass validation pipeline.

## 5. High-Level Architecture
```text
User Prompt
  -> Agent Orchestrator
    -> Context Builder
    -> LLM (tool/function call mode)
    -> Semantic Ops
    -> Deterministic Compiler (ops -> Blockly workspace mutations)
    -> Candidate XML + Diff
    -> Validation Pipeline
    -> User Confirmation
    -> Apply + History Snapshot
```

## 6. Tool Contracts (Provider-Agnostic)
The LLM calls typed tools. These tools can be internal functions or exposed via MCP later.

### 6.1 `get_capabilities`
Returns:
- Supported block types.
- Block field schema.
- Input schema and connection constraints.
- Allowed special tokens (e.g. `EDGE`, `MOUSE`, `GROUND`, `MY_CLONES`).
- Limits (max blocks per operation, depth limits, etc).

### 6.2 `get_program_context`
Inputs:
- `scope`: `object` | `component` | `scene`
- IDs for selected scope.

Returns minimal context:
- Current target XML (or normalized IR).
- IDs and labels for objects/scenes/messages/variables/sounds.
- Component instance metadata (single-instance vs shared component).

### 6.3 `read_program`
Inputs:
- target scope IDs.

Returns:
- Normalized IR representation.
- Human-readable summary of event flows and major actions.
- Detected warnings (if any).

### 6.4 `propose_edits`
Inputs:
- User intent.
- Capabilities + relevant context.

Returns:
- `intent_summary` (plain language).
- `semantic_ops[]` (strict JSON schema).
- Optional assumptions list.

### 6.5 `build_candidate`
System tool (not model-authored freeform):
- Applies semantic ops to temp workspace.
- Produces candidate XML.
- Produces structured diff (`added/removed/changed` blocks, connection changes).

### 6.6 `validate_candidate`
Runs all validators:
- XML parse/load.
- Block type existence.
- Field-level reference validity.
- Connection/type compatibility.
- Existing pre-play validation.
- Optional compile sanity check (codegen success).

Returns:
- `pass` boolean.
- `errors[]` (blocking).
- `warnings[]` (non-blocking).
- `repair_hints[]` (for optional one retry loop).

### 6.7 `apply_candidate`
Applies candidate only when:
- Validation passes.
- User confirms.

Writes through existing store semantics:
- Object update vs component update rules.
- History record + rollback snapshot.

### 6.8 `rollback_candidate`
Reverts to pre-apply snapshot if requested or post-check fails.

## 7. Semantic Ops Schema
Do not use low-level socket wiring ops directly as model interface.
Use semantic operations that preserve model reasoning quality.

Example semantic ops:
- `create_event_flow`
- `append_actions`
- `replace_action`
- `set_block_field`
- `ensure_variable`
- `ensure_message`
- `retarget_reference`
- `delete_subtree`

Example payload:
```json
{
  "intent_summary": "When game starts, move right and play jump sound.",
  "semantic_ops": [
    {
      "op": "create_event_flow",
      "event": "event_game_start",
      "actions": [
        { "action": "motion_change_x", "inputs": { "VALUE": 10 } },
        { "action": "sound_play", "fields": { "SOUND": "sound-id-123" } }
      ]
    }
  ]
}
```

Compiler responsibility:
- Expand semantic ops into deterministic Blockly workspace mutations.
- Allocate stable block IDs.
- Insert required shadow blocks for missing numeric/text inputs.

## 8. Deterministic Compiler Rules
- Reject unknown block/action names.
- Reject unknown fields/inputs per block schema.
- Fill safe defaults for omitted optional inputs.
- Maintain top-level hat block ordering deterministically.
- Preserve unchanged subtrees by ID where possible.
- Enforce connection legality before XML serialization.

## 9. Validation Pipeline
Validation stages (all required):

1. Structural validation
- `Blockly.utils.xml.textToDom` parse success.
- `Blockly.Xml.domToWorkspace` load success.

2. Block schema validation
- Every block type exists.
- Fields satisfy allowed enums/types.
- Inputs satisfy connection/type constraints.

3. Reference integrity validation
- Object/sound/scene/message/variable references exist in context.
- Special tokens validated against allowed block rules.
- Component-any references preserve prefix semantics.

4. Existing project-level validation
- Run current pre-play checks from `validateProjectBeforePlay`.

5. Optional runtime compile sanity
- Run Blockly code generation on candidate target.
- Ensure generation does not throw.

## 10. Scope and Apply Semantics
Agent requests must declare edit scope explicitly:
- `object:<sceneId>:<objectId>`
- `component:<componentId>`

If selected object is a component instance:
- Default to object-level suggestion only.
- Require explicit user confirmation for component-wide propagation.

Apply behavior must match existing store rules for `updateObject`/`updateComponent`.

## 11. User Experience Flow
1. User asks in natural language.
2. Agent returns short plan and proposed changes summary.
3. UI shows block diff preview:
- New event flows.
- Modified blocks.
- Removed blocks.
4. UI shows validation results.
5. User chooses:
- Apply
- Regenerate
- Cancel
6. On apply, record history snapshot and support one-click undo.

## 12. Security and Execution Policy
- Model output is data, never executable authority.
- Runtime code execution remains existing block-generated path only.
- No direct `eval`/`Function` from model text.
- Enforce server-side schema validation for any remote LLM result.
- Redact unnecessary project data from model context.

## 13. Model Provider Strategy
- Provider-agnostic adapter interface (`LLMProvider`).
- Default support for OpenRouter and direct providers.
- Require strict JSON/function-call output mode.
- Pin tested model versions for edit reliability.
- Add fallback provider for degraded tool-call quality.

## 14. Observability
Log per request:
- Prompt class (read/explain/edit).
- Scope size (blocks count).
- Model + latency + token usage.
- Validation failures by category.
- Apply/undo outcomes.

Metrics:
- First-pass validation success rate.
- Accepted suggestion rate.
- Mean time to apply.
- Post-apply rollback rate.

## 15. Testing Strategy
### Unit
- Semantic op schema validation.
- Compiler expansion of each semantic op.
- Deterministic ordering and ID generation.

### Integration
- End-to-end: intent -> ops -> candidate -> validation -> apply.
- Reference-heavy scenarios (scene rename, deleted variable, missing sound).
- Component instance propagation behavior.

### Regression
- Golden fixtures of XML before/after edits.
- Round-trip stability checks for unchanged programs.
- Replay of known failure cases.

### Existing Harness Reuse
Leverage current block/codegen execution scripts for sanity checks:
- `/Users/kihaahn/code/0040-pochacoding/scripts/test-blocks.ts`
- `/Users/kihaahn/code/0040-pochacoding/scripts/test-execution.ts`

## 16. Rollout Plan
### Phase 1: Read-Only Assistant
- Explain blocks, summarize logic, detect likely issues.
- No write/apply path.

### Phase 2: Safe Write MVP (Single Object)
- Semantic ops + deterministic compiler + preview + validation.
- Explicit confirm required for apply.

### Phase 3: Multi-Target and Hardening
- Component-aware edits.
- Better repair loop.
- Telemetry-driven improvements.

### Phase 4: Optional Advanced Modes
- Optional constrained JS editor profile (not arbitrary JS).
- Optional MCP exposure for portability across clients.

## 17. Acceptance Criteria
- >=95% first-pass validation success on common edit intents.
- <=2% post-apply rollback rate after stabilization.
- Median edit proposal latency <3s (excluding user think time).
- Zero direct model-to-store writes in architecture.

## 18. Open Questions
- Where should orchestration run first: frontend worker vs backend service?
- What is max allowed candidate block delta per single apply?
- Should high-risk edits require extra confirmation (delete subtree, component-wide edits)?
- Should we support auto-repair loop count >1 or keep single retry for predictability?

## 19. Implementation Checklist
- [ ] Define `LLMProvider` interface and OpenRouter implementation.
- [ ] Add capability registry generated from Blockly block metadata.
- [ ] Implement semantic op JSON schema and validator.
- [ ] Implement deterministic compiler to workspace mutations.
- [ ] Implement candidate diff generator.
- [ ] Integrate validation pipeline with existing play validation.
- [ ] Add preview/apply/rollback UI flow.
- [ ] Add telemetry and metrics dashboard.
- [ ] Add regression fixtures and CI gates.

