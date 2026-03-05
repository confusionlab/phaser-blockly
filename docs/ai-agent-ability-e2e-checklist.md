# AI Agent Ability E2E Checklist

Last updated: 2026-03-05
Target project for live checks: `AI Test`
Runtime target: Electron desktop (`codex_oauth`, no OpenRouter spend)

## Scope

This checklist tracks real end-to-end verification of AI agent abilities in the desktop runtime.
Each item includes a short note from the latest fully passing run.

Latest full-pass run: `2026-03-05T15:39:45.538Z` (`38/38` passed)

## Preflight

- [x] Electron desktop launches with desktop bridge (`window.desktopAssistant`) available.
  - Notes: Confirmed in run phases `electron_launched` and assistant turn execution.
- [x] Clerk session is active in desktop runtime.
  - Notes: Wait gate now requires runtime user id before any case runs.
- [x] Codex OAuth status is ready for signed-in user (`hasCodexToken=true`, `codexAvailable=true`).
  - Notes: Wait gate logs `phase:codex_ready mode=codex_oauth hasToken=true available=true`.
- [x] Assistant turn transport succeeds in desktop runtime.
  - Notes: All mutation and grounding requests completed through desktop provider path.

## Project Ops

- [x] `rename_project`
  - Notes: PASS in final run (`mode=edit`).
- [x] `create_scene`
  - Notes: PASS in final run (`mode=edit`).
- [x] `rename_scene`
  - Notes: PASS in final run (`mode=edit`).
- [x] `reorder_scenes`
  - Notes: PASS in final run (`mode=edit`).
- [x] `create_object`
  - Notes: PASS in final run (`mode=edit`).
- [x] `rename_object`
  - Notes: PASS in final run (`mode=edit`).
- [x] `set_object_property`
  - Notes: PASS in final run (`mode=edit`).
- [x] `set_object_physics`
  - Notes: PASS in final run (`mode=edit`).
- [x] `set_object_collider_type`
  - Notes: PASS in final run (`mode=edit`).
- [x] `create_folder`
  - Notes: PASS in final run (`mode=edit`).
- [x] `rename_folder`
  - Notes: PASS in final run (`mode=edit`).
- [x] `move_object_to_folder`
  - Notes: PASS in final run (`mode=edit`).
- [x] `add_costume_from_image_url`
  - Notes: PASS in final run (`mode=edit`).
- [x] `add_costume_text_circle`
  - Notes: PASS in final run (`mode=edit`).
- [x] `rename_costume`
  - Notes: PASS in final run (`mode=edit`).
- [x] `reorder_costumes`
  - Notes: PASS in final run (`mode=edit`).
- [x] `set_current_costume`
  - Notes: PASS in final run (`mode=edit`).
- [x] `validate_project`
  - Notes: PASS in final run (`mode=edit`).

## Semantic Ops (Blockly Code Edits)

- [x] `create_event_flow`
  - Notes: PASS in final run (`mode=edit`).
- [x] `append_actions`
  - Notes: PASS in final run (`mode=edit`).
- [x] `replace_action`
  - Notes: PASS in final run (`mode=edit`).
- [x] `set_block_field`
  - Notes: PASS in final run (`mode=edit`) against seeded `event_key_pressed` block.
- [x] `ensure_variable`
  - Notes: PASS in final run (`mode=edit`).
- [x] `ensure_message`
  - Notes: PASS in final run (`mode=edit`).
- [x] `retarget_reference`
  - Notes: PASS in final run (`mode=edit`).
- [x] `delete_subtree`
  - Notes: PASS in final run (`mode=edit`).

## Tool-Call Grounding Abilities

- [x] `list_scenes`
  - Notes: PASS in final run (`mode=chat`).
- [x] `get_scene`
  - Notes: PASS in final run (`mode=chat`).
- [x] `list_scene_folders`
  - Notes: PASS in final run (`mode=chat`).
- [x] `list_scene_objects`
  - Notes: PASS in final run (`mode=chat`).
- [x] `get_object`
  - Notes: PASS in final run (`mode=chat`).
- [x] `list_object_costumes`
  - Notes: PASS in final run (`mode=chat`).
- [x] `list_components`
  - Notes: PASS in final run (`mode=chat`).
- [x] `get_component`
  - Notes: PASS in final run (`mode=chat`).
- [x] `list_messages`
  - Notes: PASS in final run (`mode=chat`).
- [x] `list_global_variables`
  - Notes: PASS in final run (`mode=chat`).
- [x] `search_blocks`
  - Notes: PASS in final run (`mode=chat`).
- [x] `get_block_type`
  - Notes: PASS in final run (`mode=chat`).

## Multi-Op Chain Reliability (Orchestration)

- [ ] Chained scene/object creation from natural language
  - Notes: Example prompt to track: "create scene home and add 3 objects in it". Current failure mode observed: model emits `create_object` entries without `sceneId`.
- [ ] Cross-op inference for missing IDs in same turn
  - Notes: Add inference rule for unambiguous chain cases (for example, infer `sceneId` from earlier `create_scene` in same `projectOps` list).
- [ ] Agent instruction quality for chained edit payloads
  - Notes: Strengthen prompt contract for multi-step edits (explicit requirement: object/costume/folder ops must include resolvable refs or ids).
- [ ] Structured retry/self-repair loop for schema failures
  - Notes: On `schema_validation_failed`, provide error-to-fix hints that can be used to regenerate corrected ops automatically.
- [ ] Regression coverage for multi-op conversational prompts
  - Notes: Add dedicated tests/cases beyond single-op matrix (scene + N objects, scene + folder + moves, scene + object + costume chain).

## Run Log

- 2026-03-05: Checklist initialized.
- 2026-03-05: Added full Electron harness, seeded deterministic project/block references, and result artifact output.
- 2026-03-05: Added parser alias normalization (`type`/`blockId`/`eventBlockId`/`shadow`/`eventType`) to accept model payload variants.
- 2026-03-05: Added readiness gates for runtime user id and Codex OAuth token before test execution.
- 2026-03-05: Final full run completed with `38/38` passes.
- 2026-03-06: Added multi-op chain reliability section to track orchestration-level failures and fixes.
